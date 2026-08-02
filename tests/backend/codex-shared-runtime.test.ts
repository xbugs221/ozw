/**
 * 文件目的：回归连接独立 Codex 系统服务所需的客户端能力与安全接管。
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  clearCodexCapabilityProbeCacheForTest,
  parseCodexSharedRuntimeCapabilities,
  probeCodexSharedRuntimeCapabilities,
} from '../../backend/domains/codex-app-server/capability-probe.ts';
import { resolveSharedCodexRuntimePlan } from '../../backend/domains/codex-app-server/shared-runtime-plan.ts';
import { resolveCodexTerminalAttachPlan } from '../../backend/server/codex-terminal-attach-plan.ts';
import { CodexAppServerSessionManager } from '../../backend/domains/codex-app-server/session-manager.ts';

/** 创建可延迟或失败的假 Codex 命令，用真实子进程验证异步探测行为。 */
async function createFakeCapabilityCommand(): Promise<{
  command: string;
  directory: string;
  failureMarker: string;
  logPath: string;
}> {
  /** 假命令把每次 help 调用写入日志，并通过环境变量控制延迟。 */
  const directory = await mkdtemp(path.join(tmpdir(), 'ozw-codex-probe-'));
  const command = path.join(directory, 'fake-codex.mjs');
  const failureMarker = path.join(directory, 'fail');
  const logPath = path.join(directory, 'calls.log');
  await writeFile(command, `#!/usr/bin/env node
import { appendFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.PROBE_LOG, JSON.stringify(args) + '\\n');
setTimeout(() => {
  if (process.env.PROBE_FAILURE_MARKER && existsSync(process.env.PROBE_FAILURE_MARKER)) {
    process.stderr.write('controlled probe failure');
    process.exit(9);
  }
  if (args[0] === 'app-server') {
    process.stdout.write('Usage: codex app-server proxy --sock <PATH> Unix domain socket');
  } else {
    process.stdout.write('Usage: codex --remote unix://PATH');
  }
}, Number(process.env.PROBE_DELAY_MS || 0));
`, { mode: 0o755 });
  return { command, directory, failureMarker, logPath };
}

/** 读取假命令调用次数，空日志按零次处理。 */
async function countProbeCalls(logPath: string): Promise<number> {
  /** 每行对应一次真实 execFile 调用。 */
  const content = await readFile(logPath, 'utf8').catch(() => '');
  return content.trim() ? content.trim().split('\n').length : 0;
}

test('能力探测依据 help 契约而不是版本号', () => {
  /** 模拟支持共享运行时的 CLI 帮助文本。 */
  const capabilities = parseCodexSharedRuntimeCapabilities({
    proxyHelp: 'Usage: codex app-server proxy\n--sock <SOCKET_PATH> Unix domain socket',
    rootHelp: '--remote <ADDR> Accepted forms: unix://PATH',
  });
  assert.deepEqual(capabilities, { proxy: true, unixSocket: true, remoteTui: true });
});

test('异步能力探测并发去重、缓存成功结果且不阻塞事件循环', async (t) => {
  /** 两个并发调用应只启动 proxy/root 两个 help 子进程。 */
  const fixture = await createFakeCapabilityCommand();
  t.after(async () => {
    clearCodexCapabilityProbeCacheForTest(fixture.command);
    await rm(fixture.directory, { recursive: true, force: true });
  });
  const options = {
    ttlMs: 60_000,
    timeoutMs: 1000,
    env: {
      ...process.env,
      PROBE_DELAY_MS: '100',
      PROBE_LOG: fixture.logPath,
    },
  };

  let timerObserved = false;
  const first = probeCodexSharedRuntimeCapabilities(fixture.command, options);
  const second = probeCodexSharedRuntimeCapabilities(fixture.command, options);
  await new Promise<void>((resolve) => setTimeout(() => {
    timerObserved = true;
    resolve();
  }, 10));
  assert.equal(timerObserved, true, 'event loop timer must run while help commands are pending');

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult, { proxy: true, unixSocket: true, remoteTui: true });
  assert.deepEqual(secondResult, firstResult);
  assert.equal(await countProbeCalls(fixture.logPath), 2);

  await probeCodexSharedRuntimeCapabilities(fixture.command, options);
  assert.equal(await countProbeCalls(fixture.logPath), 2, 'successful result must be served from cache');
});

test('失败的能力探测不缓存并允许下一次重试', async (t) => {
  /** 首次受控失败后移除标记，第二次必须重新执行两个 help 命令并成功。 */
  const fixture = await createFakeCapabilityCommand();
  t.after(async () => {
    clearCodexCapabilityProbeCacheForTest(fixture.command);
    await rm(fixture.directory, { recursive: true, force: true });
  });
  await writeFile(fixture.failureMarker, 'fail');
  const options = {
    ttlMs: 60_000,
    timeoutMs: 1000,
    env: {
      ...process.env,
      PROBE_FAILURE_MARKER: fixture.failureMarker,
      PROBE_LOG: fixture.logPath,
    },
  };

  await assert.rejects(
    probeCodexSharedRuntimeCapabilities(fixture.command, options),
    /Codex capability probe failed/,
  );
  assert.equal(await countProbeCalls(fixture.logPath), 2);

  await unlink(fixture.failureMarker);
  const recovered = await probeCodexSharedRuntimeCapabilities(fixture.command, options);
  assert.deepEqual(recovered, { proxy: true, unixSocket: true, remoteTui: true });
  assert.equal(await countProbeCalls(fixture.logPath), 4, 'failed result must not suppress retry');
});

test('能力不足不会隐式返回私有 stdio 运行时', () => {
  /** 验证降级必须由调用方显式授权，连接计划本身保持安全。 */
  const plan = resolveSharedCodexRuntimePlan({
    codexHome: '/tmp/codex-home',
    capabilities: { proxy: false, unixSocket: true, remoteTui: true },
    socketReady: false,
  });
  assert.equal(plan.mode, 'unsupported');
});

test('未知外部会话不会被宣称无损接管', () => {
  /** 独立服务不可连接时，终端接管保持保守降级。 */
  const attach = resolveCodexTerminalAttachPlan({
    providerSessionId: 'thread-unknown',
    managedTmuxExists: false,
    sharedRuntime: { ready: false, endpoint: null },
    externalSessionState: 'unknown',
  });
  assert.equal(attach.action, 'blocked');
  assert.equal(attach.mayInterruptActiveTurn, false);
});

test('daemon 存在不等于目标旧式活动线程属于共享运行时', () => {
  /** 目标线程没有 loaded/active 归属证明时必须阻止远端接管。 */
  const attach = resolveCodexTerminalAttachPlan({
    providerSessionId: 'legacy-active',
    managedTmuxExists: false,
    sharedRuntime: {
      ready: true,
      endpoint: 'unix:///tmp/live.sock',
      threadOwned: false,
      activeTurnOwned: false,
    },
    externalSessionState: 'running',
  });
  assert.equal(attach.action, 'blocked');
  assert.equal(attach.commandArgs, null);
});

test('daemon 可读但未加载的空闲历史线程迁入共享运行时', () => {
  /** 历史线程已确认没有活动轮次时，应通过 remote TUI 进入共享 daemon，而不是误报活动。 */
  const attach = resolveCodexTerminalAttachPlan({
    providerSessionId: 'legacy-idle-thread',
    managedTmuxExists: false,
    sharedRuntime: {
      ready: true,
      endpoint: 'unix:///tmp/live.sock',
      threadOwned: false,
      threadReadable: true,
      threadState: 'idle',
      activeTurnDetected: false,
      activeTurnOwned: false,
    },
    externalSessionState: 'unknown',
  });
  assert.equal(attach.action, 'remote-tui');
  assert.deepEqual(attach.commandArgs, ['--remote', 'unix:///tmp/live.sock', 'resume', 'legacy-idle-thread']);
  assert.equal(attach.reason, 'historical-idle-thread-migrated');
});

test('daemon 可读但未加载的活动历史线程仍安全阻止', () => {
  /** 可读只证明历史存在；检测到活动轮次但不归共享 daemon 时不得自动 resume。 */
  const attach = resolveCodexTerminalAttachPlan({
    providerSessionId: 'legacy-active-thread',
    managedTmuxExists: false,
    sharedRuntime: {
      ready: true,
      endpoint: 'unix:///tmp/live.sock',
      threadOwned: false,
      threadReadable: true,
      threadState: 'active',
      activeTurnDetected: true,
      activeTurnOwned: false,
    },
    externalSessionState: 'unknown',
  });
  assert.equal(attach.action, 'blocked');
  assert.equal(attach.reason, 'external-active-session-not-shared');
  assert.equal(attach.commandArgs, null);
});

test('用户明确确认后可由同一卡片建立新式共享会话', () => {
  /** 强制接管保留旧进程，并由相同 cN 路由承载新的共享线程。 */
  const attach = resolveCodexTerminalAttachPlan({
    providerSessionId: 'legacy-active-thread',
    managedTmuxExists: false,
    forceHandoff: true,
    sharedRuntime: {
      ready: true,
      endpoint: 'unix:///tmp/live.sock',
      threadOwned: false,
      threadReadable: true,
      threadState: 'active',
      activeTurnDetected: true,
      activeTurnOwned: false,
    },
    externalSessionState: 'running',
  });
  assert.equal(attach.action, 'new-shared-tui');
  assert.equal(attach.commandArgs, null);
  assert.equal(attach.reason, 'user-forced-legacy-handoff');
  assert.equal(attach.mayInterruptActiveTurn, false);
});

test('共享 daemon 不可用时强制接管仍保持阻止', () => {
  /** 没有共享端点时不得退回普通 codex resume 冒充新式会话。 */
  const attach = resolveCodexTerminalAttachPlan({
    providerSessionId: 'legacy-active-thread',
    managedTmuxExists: false,
    forceHandoff: true,
    sharedRuntime: { ready: false, endpoint: null },
    externalSessionState: 'running',
  });
  assert.equal(attach.action, 'blocked');
  assert.equal(attach.commandArgs, null);
});

test('daemon 可读但最后轮次未收敛时按未知状态阻止', () => {
  /** 私有运行时可能被 daemon 映射成 interrupted 且无完成时间，此时不得猜成空闲。 */
  const attach = resolveCodexTerminalAttachPlan({
    providerSessionId: 'legacy-unsettled-thread',
    managedTmuxExists: false,
    sharedRuntime: {
      ready: true,
      endpoint: 'unix:///tmp/live.sock',
      threadOwned: false,
      threadReadable: true,
      threadState: 'unknown',
      activeTurnDetected: false,
      activeTurnOwned: false,
    },
    externalSessionState: 'unknown',
  });
  assert.equal(attach.action, 'blocked');
  assert.equal(attach.reason, 'shared-thread-state-unavailable');
});

test('共享 daemon 已认领的线程在刷新状态未知时仍可安全复连', () => {
  /** 浏览器刷新会丢失瞬态处理状态，daemon 的线程归属才是后端真值。 */
  const attach = resolveCodexTerminalAttachPlan({
    providerSessionId: 'shared-idle-thread',
    managedTmuxExists: false,
    sharedRuntime: {
      ready: true,
      endpoint: 'unix:///tmp/live.sock',
      threadOwned: true,
      activeTurnOwned: false,
    },
    externalSessionState: 'unknown',
  });
  assert.equal(attach.action, 'remote-tui');
  assert.deepEqual(attach.commandArgs, ['--remote', 'unix:///tmp/live.sock', 'resume', 'shared-idle-thread']);
});

test('proxy 断开保留活动轮次并允许重新订阅', () => {
  /** 验证客户端连接失败不会伪装成 daemon turn 失败。 */
  const events: Array<Record<string, unknown>> = [];
  const manager = new CodexAppServerSessionManager();
  const session = manager.getOrCreateSession('c1', '/tmp/project', {
    send: (event) => events.push(event as Record<string, unknown>),
  });
  session.providerThreadId = 'thread-live';
  session.activeTurnId = 'turn-live';
  session.status = 'running';
  session.notificationSubscribed = true;

  manager.markTransportDisconnected('proxy closed');

  assert.equal(session.status, 'running');
  assert.equal(session.activeTurnId, 'turn-live');
  assert.equal(session.notificationSubscribed, false);
  assert.equal(events[0]?.type, 'codex-connection-lost');
  assert.equal(events[0]?.activeTurnPreserved, true);
});
