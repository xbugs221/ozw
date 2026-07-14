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
