/**
 * 文件目的：验证浏览器终端生成的 tmux 会话名始终符合 tmux 限制。
 * 业务意义：项目路径含版本号或特殊字符时，终端仍能创建、复连和终止。
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { handleShellConnection } from '../../backend/server/shell-websocket.ts';
import {
  createTmuxSessionName,
  createTmuxTerminalRuntime,
  createTmuxWindowName,
} from '../../backend/server/terminal-tmux-runtime.ts';

const execFileAsync = promisify(execFile);

test('项目路径中的小数点会被归一化', () => {
  /**
   * 版本号目录很常见，但 tmux 明确禁止 session 名含小数点。
   */
  const rawKey = '/home/zzl/projects/ald_proj/atom-number-1.9_codex_route:c1';
  assert.match(createTmuxSessionName(rawKey), /^ozw_ald_proj_atom-number-1_9_[a-f0-9]{8}$/);
  assert.equal(createTmuxWindowName(rawKey), 'codex_c1');
});

test('同项目复用 session，不同会话使用独立 window', () => {
  /**
   * 项目身份决定 session，provider 和 cN 路由共同决定 window。
   */
  const codex = createTmuxTerminalRuntime('/home/zzl/projects/ozw_codex_route:c1');
  const pi = createTmuxTerminalRuntime('/home/zzl/projects/ozw_pi_route:c2');

  assert.equal(codex.sessionName, pi.sessionName);
  assert.equal(codex.windowName, 'codex_c1');
  assert.equal(pi.windowName, 'pi_c2');
  assert.notEqual(codex.target, pi.target);
  assert.deepEqual(codex.terminateTerminal(), ['tmux', 'kill-window', '-t', codex.target]);
  assert.deepEqual(
    codex.terminateTerminal(codex.legacySessionNames[0]),
    ['tmux', 'kill-session', '-t', codex.legacySessionNames[0]],
  );
});

test('tmux 会话名只保留安全白名单字符', () => {
  /**
   * 冒号、空白、Unicode、括号及 shell 符号应走同一兜底规则。
   */
  const sessionName = createTmuxSessionName(
    '/home/zzl/projects/特殊 项目:v2/[draft]$x_codex_route:c8',
  );

  assert.match(sessionName, /^[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(sessionName, /[.:]/);
});

test('同名项目路径和特殊会话标识不会产生 tmux 冲突', () => {
  /**
   * 可读名称相同时仍保留全路径/原始会话身份的哈希区分。
   */
  const left = createTmuxTerminalRuntime('/srv/team-a/projects/ozw_codex_provider:a:b');
  const right = createTmuxTerminalRuntime('/srv/team-b/projects/ozw_codex_provider:a.b');

  assert.notEqual(left.sessionName, right.sessionName);
  assert.notEqual(left.windowName, right.windowName);
  assert.ok(left.sessionName.length <= 80);
  assert.ok(left.windowName.length <= 48);
});

test('断开且静默的 window 在宽限期后自动回收', async (t) => {
  /**
   * 使用隔离 tmux 会话和缩短宽限期，验证真实回收命令而非字符串契约。
   */
  if (process.platform === 'win32') {
    t.skip('tmux lifecycle is POSIX-only');
    return;
  }
  try {
    await execFileAsync('tmux', ['-V']);
  } catch {
    t.skip('tmux is not installed');
    return;
  }

  const projectPath = await mkdtemp(path.join(tmpdir(), 'ozw-tmux-lifecycle-'));
  const rawKey = `${projectPath}_plain-shell_route:c9`;
  const runtime = createTmuxTerminalRuntime(rawKey);
  const handlers = new Map<string, (...args: any[]) => any>();
  const ptySessionsMap = new Map();
  const fakePty = {
    pid: 99,
    write() { /** No input is needed for the lifecycle scenario. */ },
    resize() { /** No resize is needed for the lifecycle scenario. */ },
    kill() { /** Killing the relay must leave cleanup to the tmux window timer. */ },
    onData() { /** The isolated tmux window intentionally remains silent. */ },
    onExit() { /** The fake relay does not emit an exit during this scenario. */ },
  };
  const socket = {
    readyState: 1,
    on(event: string, handler: (...args: any[]) => any) {
      /** Expose WebSocket callbacks so the test can drive init and close. */
      handlers.set(event, handler);
    },
    send() { /** Visible protocol output is irrelevant to tmux cleanup. */ },
  };

  try {
    const createArgs = runtime.createSession('sleep 10');
    await execFileAsync(createArgs[0], createArgs.slice(1));
    handleShellConnection({
      ptySessionsMap,
      PTY_SESSION_TIMEOUT: 40,
      SHELL_URL_PARSE_BUFFER_LIMIT: 1024,
      stripAnsiSequences: (value: string) => value,
      normalizeDetectedUrl: () => null,
      extractUrlsFromText: () => [],
      shouldAutoOpenUrlFromOutput: () => false,
      os: { platform: () => 'linux', homedir: () => projectPath },
      WebSocket: { OPEN: 1 },
      loadNodePtyRuntime: async () => ({ spawn: () => fakePty }),
    }, socket as any);
    await handlers.get('message')?.(JSON.stringify({
      type: 'init',
      provider: 'plain-shell',
      projectPath,
      routeSessionId: 'c9',
    }));
    await handlers.get('close')?.();
    await new Promise((resolve) => setTimeout(resolve, 180));
    await assert.rejects(execFileAsync('tmux', ['has-session', '-t', runtime.target]));
  } finally {
    await execFileAsync('tmux', ['kill-session', '-t', runtime.sessionName]).catch(() => undefined);
    await rm(projectPath, { recursive: true, force: true });
  }
});
