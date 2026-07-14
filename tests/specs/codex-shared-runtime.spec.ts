/**
 * 文件目的：验证 Codex 共享 daemon、无损接管及网络策略的长期业务契约。
 * 来源：2026-07-14-40-共享Codex-app-server实现无损会话接管。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

test('共享 daemon 关闭 proxy 不停止 daemon', async () => {
  /** 验证 ozw 只拥有 proxy 生命周期。 */
  const { resolveSharedCodexRuntimePlan } = await import('../../backend/domains/codex-app-server/shared-runtime-plan.ts');
  const plan = resolveSharedCodexRuntimePlan({
    codexHome: '/home/demo/.codex',
    capabilities: { daemon: true, proxy: true, unixSocket: true, remoteTui: true },
    socketReady: false,
  });
  assert.equal(plan.mode, 'shared-daemon');
  assert.equal(plan.stopDaemonOnClose, false);
  assert.equal(plan.privateStdioArgs, null);
});

test('未核实目标 thread 归属时阻止活动会话接管', async () => {
  /** 防止全局 daemon 或残留 Socket 抢占旧式活动会话。 */
  const { resolveCodexTerminalAttachPlan } = await import('../../backend/server/codex-terminal-attach-plan.ts');
  const plan = resolveCodexTerminalAttachPlan({
    providerSessionId: 'legacy-running-thread',
    managedTmuxExists: false,
    sharedRuntime: { ready: true, endpoint: 'unix:///tmp/live.sock', threadOwned: false, activeTurnOwned: false },
    externalSessionState: 'running',
  });
  assert.equal(plan.action, 'blocked');
  assert.equal(plan.commandArgs, null);
});

test('代理凭据变化产生不同指纹且诊断脱敏', async () => {
  /** 配置指纹用于漂移判断，诊断只显示脱敏端点。 */
  const { resolveCodexDaemonNetworkPolicy } = await import('../../backend/domains/codex-app-server/daemon-network-policy.ts');
  const oldPolicy = resolveCodexDaemonNetworkPolicy({ mode: 'inherit', env: { HTTPS_PROXY: 'http://alice:old@proxy.example:7890' } });
  const newPolicy = resolveCodexDaemonNetworkPolicy({ mode: 'inherit', env: { HTTPS_PROXY: 'http://alice:new@proxy.example:7890' } });
  assert.notEqual(oldPolicy.fingerprint, newPolicy.fingerprint);
  assert.doesNotMatch(JSON.stringify(newPolicy.diagnostics), /alice|new/);
});
