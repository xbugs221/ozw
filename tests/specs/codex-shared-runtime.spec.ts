/**
 * 文件目的：验证独立 Codex 系统服务的客户端连接与无损接管契约。
 * 来源：2026-07-14-40-共享Codex-app-server实现无损会话接管。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

test('ozw 只规划连接独立服务所需的客户端 proxy', async () => {
  /** 连接计划不包含服务启动、停止或私有运行时降级。 */
  const { resolveSharedCodexRuntimePlan } = await import('../../backend/domains/codex-app-server/shared-runtime-plan.ts');
  const plan = resolveSharedCodexRuntimePlan({
    codexHome: '/home/demo/.codex',
    capabilities: { proxy: true, unixSocket: true, remoteTui: true },
    socketReady: false,
  });
  assert.equal(plan.mode, 'shared-daemon');
  assert.deepEqual(plan.proxyArgs?.slice(0, 3), ['app-server', 'proxy', '--sock']);
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
