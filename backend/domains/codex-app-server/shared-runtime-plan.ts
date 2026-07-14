/**
 * 文件目的：规划 Codex daemon、stdio proxy 与 Unix Socket 的所有权和命令。
 * 业务意义：ozw 只拥有客户端 proxy，daemon 可独立服务网页与终端。
 */

import path from 'node:path';
import type { CodexSharedRuntimeCapabilities } from './capability-probe.js';

export type SharedCodexRuntimePlan = {
  mode: 'shared-daemon' | 'unsupported';
  endpoint: string | null;
  socketPath: string | null;
  ensureDaemonArgs: string[] | null;
  proxyArgs: string[] | null;
  privateStdioArgs: string[] | null;
  stopDaemonOnClose: false;
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
      mode: 'unsupported', endpoint: null, socketPath: null, ensureDaemonArgs: null,
      proxyArgs: null, privateStdioArgs: null, stopDaemonOnClose: false,
      ready: false, reason: 'codex-shared-runtime-capability-missing',
    };
  }
  const socketPath = input.socketPath || resolveCodexDaemonSocketPath(input.codexHome);
  return {
    mode: 'shared-daemon',
    endpoint: `unix://${socketPath}`,
    socketPath,
    ensureDaemonArgs: ['app-server', 'daemon', 'start'],
    proxyArgs: ['app-server', 'proxy', '--sock', socketPath],
    privateStdioArgs: null,
    stopDaemonOnClose: false,
    ready: input.socketReady,
    reason: input.socketReady ? null : 'daemon-start-required',
  };
}
