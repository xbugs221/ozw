/**
 * 文件目的：汇总 ozw 连接系统 Codex 守护进程所需的客户端能力与 Socket 状态。
 * 业务意义：只报告连通性，不读取、配置或管理独立服务的进程与网络状态。
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  probeCodexSharedRuntimeCapabilities,
  type CodexSharedRuntimeCapabilities,
} from './capability-probe.js';
import { resolveSharedCodexRuntimePlan } from './shared-runtime-plan.js';

/** 异步构建客户端连通性快照，不阻塞事件循环或调用 daemon 管理命令。 */
export async function getCodexSharedRuntimeDiagnostics(): Promise<Record<string, unknown>> {
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
  const socketPath = path.join(codexHome, 'app-server-control', 'app-server-control.sock');
  let capabilities: CodexSharedRuntimeCapabilities;
  try {
    capabilities = await probeCodexSharedRuntimeCapabilities();
  } catch (error) {
    /** 探测失败不缓存，诊断返回可读错误并允许下次请求重新尝试。 */
    return {
      mode: 'unsupported',
      ready: false,
      endpoint: null,
      socketPath,
      capabilities: { proxy: false, unixSocket: false, remoteTui: false },
      reason: 'codex-client-capability-probe-failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const plan = resolveSharedCodexRuntimePlan({ codexHome, capabilities, socketReady: existsSync(socketPath), socketPath });
  return {
    mode: plan.mode,
    ready: plan.ready,
    endpoint: plan.endpoint,
    socketPath,
    capabilities,
    reason: plan.reason,
  };
}
