/**
 * 文件目的：规划连接系统 Codex 守护进程的 stdio proxy 与 Unix Socket。
 * 业务意义：ozw 只验证客户端连接条件，服务生命周期和配置完全由系统管理。
 */

import path from 'node:path';
import type { CodexSharedRuntimeCapabilities } from './capability-probe.js';

export type SharedCodexRuntimePlan = {
  mode: 'shared-daemon' | 'unsupported';
  endpoint: string | null;
  socketPath: string | null;
  proxyArgs: string[] | null;
  ready: boolean;
  reason: string | null;
};

/** 返回 CODEX_HOME 对应的默认 daemon 控制 Socket。 */
export function resolveCodexDaemonSocketPath(codexHome: string): string {
  return path.join(codexHome, 'app-server-control', 'app-server-control.sock');
}

/** 根据能力与 Socket 状态生成无副作用的共享连接计划。 */
export function resolveSharedCodexRuntimePlan(input: {
  codexHome: string;
  capabilities: CodexSharedRuntimeCapabilities;
  socketReady: boolean;
  socketPath?: string;
}): SharedCodexRuntimePlan {
  const supported = Object.values(input.capabilities).every(Boolean);
  if (!supported) {
    return {
      mode: 'unsupported', endpoint: null, socketPath: null,
      proxyArgs: null,
      ready: false, reason: 'codex-shared-runtime-capability-missing',
    };
  }
  const socketPath = input.socketPath || resolveCodexDaemonSocketPath(input.codexHome);
  return {
    mode: 'shared-daemon',
    endpoint: `unix://${socketPath}`,
    socketPath,
    proxyArgs: ['app-server', 'proxy', '--sock', socketPath],
    ready: input.socketReady,
    reason: input.socketReady ? null : 'user-managed-daemon-unavailable',
  };
}
