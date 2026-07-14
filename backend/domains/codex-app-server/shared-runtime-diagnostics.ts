/**
 * 文件目的：汇总共享 Codex daemon 的能力、Socket、活动轮次与脱敏网络状态。
 * 业务意义：前端可解释共享运行时是否可用，而不暴露代理凭据。
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { getActiveCodexAppServerSessions } from './runtime-facade.js';
import { probeCodexSharedRuntimeCapabilities } from './capability-probe.js';
import {
  decideCodexDaemonRestart,
  readCodexDaemonNetworkState,
  resolveCodexDaemonNetworkPolicy,
} from './daemon-network-policy.js';
import { resolveSharedCodexRuntimePlan } from './shared-runtime-plan.js';

/** 尝试读取 daemon 版本状态；不可用时返回空对象而不启动或重启 daemon。 */
function readDaemonVersionState(): Record<string, unknown> {
  const result = spawnSync('codex', ['app-server', 'daemon', 'version'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.status !== 0) {
    return { daemonError: String(result.stderr || result.stdout || 'daemon unavailable').trim() };
  }
  try {
    return JSON.parse(String(result.stdout || '{}')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 构建共享运行时诊断快照，不改变 daemon 生命周期。 */
export function getCodexSharedRuntimeDiagnostics(): Record<string, unknown> {
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
  const socketPath = path.join(codexHome, 'app-server-control', 'app-server-control.sock');
  const capabilities = probeCodexSharedRuntimeCapabilities();
  const plan = resolveSharedCodexRuntimePlan({ codexHome, capabilities, socketReady: existsSync(socketPath), socketPath });
  const networkPolicy = resolveCodexDaemonNetworkPolicy({
    mode: process.env.OZW_CODEX_PROXY_MODE === 'off' ? 'off' : 'inherit',
    env: process.env,
  });
  const daemonState = readDaemonVersionState();
  const activeSessions = getActiveCodexAppServerSessions();
  const networkState = readCodexDaemonNetworkState(codexHome);
  const networkDecision = networkState?.pendingFingerprint === networkPolicy.fingerprint
    ? { action: 'confirm-after-turn', restartNow: false }
    : decideCodexDaemonRestart({
        currentNetworkFingerprint: networkState?.appliedFingerprint || 'unknown',
        targetNetworkFingerprint: networkPolicy.fingerprint,
        activeTurnCount: activeSessions.length,
      });
  return {
    mode: plan.mode,
    ready: plan.ready,
    endpoint: plan.endpoint,
    socketPath,
    capabilities,
    daemonPid: daemonState.pid || daemonState.daemonPid || null,
    daemonVersion: daemonState.appServerVersion || daemonState.version || null,
    daemonError: daemonState.daemonError || null,
    network: {
      ...networkPolicy.diagnostics,
      appliedFingerprint: networkState?.appliedFingerprint || null,
      drift: networkState?.appliedFingerprint !== networkPolicy.fingerprint,
      restartAction: networkDecision.action,
    },
    activeTurnIds: activeSessions.map((session) => session.turnId).filter(Boolean),
    activeTurnCount: activeSessions.length,
    stopDaemonOnClose: false,
    reason: plan.reason,
  };
}
