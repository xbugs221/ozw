/**
 * 文件目的：验证渲染入口读取 tmux 实际聚焦 window，并映射到完整 Provider 会话。
 * 业务意义：切换同项目 window 后，记录视图不能继续复用 URL 中的旧 cN 会话。
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import pty from 'node-pty';
import { createTmuxTerminalRuntime } from '../../backend/server/terminal-tmux-runtime.ts';
import { resolveCurrentTmuxSession } from '../../backend/server/current-tmux-session.ts';

const execFileAsync = promisify(execFile);

test('解析 attached client 当前聚焦 window，而不是第一个 route window', async (t) => {
  if (process.platform === 'win32') {
    t.skip('tmux is POSIX-only');
    return;
  }
  try {
    await execFileAsync('tmux', ['-V']);
  } catch {
    t.skip('tmux is not installed');
    return;
  }

  const projectPath = await mkdtemp(path.join(tmpdir(), 'ozw-tmux-focus-'));
  const codexRuntime = createTmuxTerminalRuntime(`${projectPath}_codex_route:c1`);
  const piRuntime = createTmuxTerminalRuntime(`${projectPath}_pi_route:c2`);
  let terminal: pty.IPty | null = null;
  try {
    await execFileAsync('tmux', [
      'new-session', '-d', '-s', codexRuntime.sessionName, '-n', codexRuntime.windowName,
      'bash', '-lc', `cd ${JSON.stringify(projectPath)}; exec bash`,
    ]);
    await execFileAsync('tmux', [
      'new-window', '-d', '-t', codexRuntime.sessionName, '-n', piRuntime.windowName,
      'bash', '-lc', `cd ${JSON.stringify(projectPath)}; exec bash`,
    ]);
    terminal = pty.spawn('bash', ['-lc', `tmux attach-session -t ${codexRuntime.sessionName}:${codexRuntime.windowName}`], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: projectPath,
      env: process.env,
    });
    await new Promise((resolve) => setTimeout(resolve, 180));
    await execFileAsync('tmux', ['select-window', '-t', `${codexRuntime.sessionName}:${piRuntime.windowName}`]);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const resolution = await resolveCurrentTmuxSession(projectPath, {
      getCodexSessions: async () => [{ id: 'codex-session', routeIndex: 1, projectPath, title: 'c1' }],
      getPiSessions: async () => [{ id: 'pi-session', routeIndex: 2, projectPath, title: 'c2' }],
      getClaudeSessions: async () => [],
    });

    assert.equal(resolution.status, 'resolved');
    assert.equal(resolution.provider, 'pi');
    assert.equal(resolution.routeSessionId, 'c2');
    assert.equal(resolution.session?.id, 'pi-session');
    assert.ok(['attached-client', 'active-pane'].includes(resolution.evidence?.source || ''));
    assert.equal(resolution.evidence?.windowName, piRuntime.windowName);
  } finally {
    terminal?.kill();
    await execFileAsync('tmux', ['kill-session', '-t', codexRuntime.sessionName]).catch(() => undefined);
    await rm(projectPath, { recursive: true, force: true });
  }
});

test('tmux 存在但当前 pane 无法映射时返回 unresolved，不伪造旧 route', async () => {
  const projectPath = '/tmp/ozw-unresolved-project';
  const resolution = await resolveCurrentTmuxSession(projectPath, {
    getCodexSessions: async () => [],
    getPiSessions: async () => [],
    getClaudeSessions: async () => [],
    execFile: async () => ({ stdout: 'unrelated-session\n', stderr: '' }) as any,
  });

  assert.equal(resolution.status, 'no-tmux');
  assert.equal(resolution.session, null);
});
