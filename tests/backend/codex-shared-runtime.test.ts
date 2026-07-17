/**
 * 文件目的：回归 Codex 共享运行时的能力探测、安全降级与代理重启决策。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCodexSharedRuntimeCapabilities } from '../../backend/domains/codex-app-server/capability-probe.ts';
import {
  decideCodexDaemonRestart,
  resolveCodexDaemonNetworkPolicy,
} from '../../backend/domains/codex-app-server/daemon-network-policy.ts';
import { resolveSharedCodexRuntimePlan } from '../../backend/domains/codex-app-server/shared-runtime-plan.ts';
import { resolveCodexTerminalAttachPlan } from '../../backend/server/codex-terminal-attach-plan.ts';
import { CodexAppServerSessionManager } from '../../backend/domains/codex-app-server/session-manager.ts';

test('能力探测依据 help 契约而不是版本号', () => {
  /** 模拟支持共享运行时的 CLI 帮助文本。 */
  const capabilities = parseCodexSharedRuntimeCapabilities({
    daemonHelp: 'Usage: codex app-server daemon <COMMAND>\nCommands: start stop',
    proxyHelp: 'Usage: codex app-server proxy\n--sock <SOCKET_PATH> Unix domain socket',
    rootHelp: '--remote <ADDR> Accepted forms: unix://PATH',
  });
  assert.deepEqual(capabilities, { daemon: true, proxy: true, unixSocket: true, remoteTui: true });
});

test('能力不足不会隐式返回私有 stdio 运行时', () => {
  /** 验证降级必须由调用方显式授权，连接计划本身保持安全。 */
  const plan = resolveSharedCodexRuntimePlan({
    codexHome: '/tmp/codex-home',
    capabilities: { daemon: true, proxy: false, unixSocket: true, remoteTui: true },
    socketReady: false,
  });
  assert.equal(plan.mode, 'unsupported');
  assert.equal(plan.privateStdioArgs, null);
});

test('空闲 daemon 可应用网络变化，未知外部会话不会被宣称无损接管', () => {
  /** 同时覆盖安全重启与保守终端降级。 */
  assert.deepEqual(decideCodexDaemonRestart({
    currentNetworkFingerprint: 'before',
    targetNetworkFingerprint: 'after',
    activeTurnCount: 0,
  }), { action: 'restart-now', restartNow: true });

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

test('代理凭据参与单向指纹但不会进入诊断', () => {
  /** 同一代理主机的凭据轮换必须触发漂移，同时保持用户可见信息脱敏。 */
  const before = resolveCodexDaemonNetworkPolicy({
    mode: 'inherit', env: { HTTPS_PROXY: 'http://alice:old@proxy.example:7890' },
  });
  const after = resolveCodexDaemonNetworkPolicy({
    mode: 'inherit', env: { HTTPS_PROXY: 'http://alice:new@proxy.example:7890' },
  });
  assert.notEqual(before.fingerprint, after.fingerprint);
  assert.doesNotMatch(JSON.stringify(after.diagnostics), /alice|new/);
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
