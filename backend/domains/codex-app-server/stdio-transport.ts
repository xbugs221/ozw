/**
 * 文件目的：启动共享 Codex daemon 的 stdio proxy，并交给通用 JSON-RPC 行传输。
 * 业务意义：ozw 只持有 proxy 子进程，独立 daemon 在 ozw 退出后继续承载活动轮次。
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { CODEX_APPROVAL_POLICY, CODEX_SANDBOX_MODE } from '../../constants/config.js';
import { normalizeCodexApprovalPolicy, normalizeCodexSandboxMode } from '../../codex-permission-policy.js';
import { probeCodexSharedRuntimeCapabilities } from './capability-probe.js';
import {
  decideCodexDaemonRestart,
  readCodexDaemonNetworkState,
  resolveCodexDaemonNetworkPolicy,
  writeCodexDaemonNetworkState,
  type CodexDaemonNetworkPolicy,
} from './daemon-network-policy.js';
import {
  createJsonRpcLineTransport,
  type CodexAppServerTransport,
  type JsonRpcLineTransportOptions,
} from './json-rpc-line-transport.js';
import { resolveSharedCodexRuntimePlan } from './shared-runtime-plan.js';
import { createWebSocketProxyTransport } from './websocket-proxy-transport.js';

export type { CodexAppServerNotification, CodexAppServerTransport } from './json-rpc-line-transport.js';
export type StdioTransportOptions = JsonRpcLineTransportOptions;

type ProductionTransportLaunch = {
  args: string[];
  env: NodeJS.ProcessEnv;
  mode: 'private' | 'shared';
  codexHome: string;
  daemonWasReady: boolean;
  networkPolicy: CodexDaemonNetworkPolicy | null;
};

/** 返回默认 daemon 控制 Socket 路径。 */
function getCodexDaemonSocketPath(): string {
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
  return path.join(codexHome, 'app-server-control', 'app-server-control.sock');
}

/** 构建连接独立 daemon 的 stdio proxy 参数。 */
export function buildCodexAppServerCliArgs(socketPath = getCodexDaemonSocketPath()): string[] {
  return ['app-server', 'proxy', '--sock', socketPath];
}

/** 构建显式启用时的旧版私有 stdio 兼容参数。 */
function buildPrivateStdioCompatibilityArgs(): string[] {
  return [
    '-c', `sandbox_mode=${normalizeCodexSandboxMode(CODEX_SANDBOX_MODE)}`,
    '-c', `approval_policy=${normalizeCodexApprovalPolicy(CODEX_APPROVAL_POLICY)}`,
    'app-server', '--listen', 'stdio://',
  ];
}

/** 确保独立 daemon 可用并返回 proxy 参数；能力不足时仅允许显式兼容模式。 */
function prepareProductionTransport(): ProductionTransportLaunch {
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
  const socketPath = getCodexDaemonSocketPath();
  const plan = resolveSharedCodexRuntimePlan({
    codexHome,
    capabilities: probeCodexSharedRuntimeCapabilities(),
    socketReady: existsSync(socketPath),
    socketPath,
  });
  if (plan.mode === 'unsupported') {
    if (process.env.OZW_CODEX_ALLOW_PRIVATE_STDIO === '1') {
      return {
        args: buildPrivateStdioCompatibilityArgs(), env: process.env, mode: 'private', codexHome,
        daemonWasReady: false, networkPolicy: null,
      };
    }
    throw new Error('Codex CLI 缺少 daemon/proxy/Unix Socket/remote TUI 能力，请升级或显式启用私有 stdio 兼容模式');
  }

  const networkPolicy = resolveCodexDaemonNetworkPolicy({
    mode: process.env.OZW_CODEX_PROXY_MODE === 'off' ? 'off' : 'inherit',
    env: process.env,
  });
  if (!plan.ready && plan.ensureDaemonArgs) {
    const start = spawnSync('codex', plan.ensureDaemonArgs, {
      env: networkPolicy.daemonEnv as NodeJS.ProcessEnv,
      encoding: 'utf8',
      timeout: 15000,
    });
    if (start.error || start.status !== 0) {
      const detail = String(start.stderr || start.stdout || start.error?.message || '').trim();
      throw new Error(`Codex daemon 启动失败${detail ? `：${detail}` : ''}`);
    }
    writeCodexDaemonNetworkState(codexHome, {
      appliedFingerprint: networkPolicy.fingerprint,
      pendingFingerprint: null,
    });
  }
  return {
    args: plan.proxyArgs || buildCodexAppServerCliArgs(socketPath),
    env: process.env,
    mode: 'shared',
    codexHome,
    daemonWasReady: plan.ready,
    networkPolicy,
  };
}

/** 启动一条连接共享 daemon 的 proxy transport。 */
function spawnSharedProxy(launch: ProductionTransportLaunch, options: JsonRpcLineTransportOptions): CodexAppServerTransport {
  const child = spawn('codex', launch.args, { stdio: ['pipe', 'pipe', 'pipe'], env: launch.env });
  return createWebSocketProxyTransport(child, options);
}

/** 从 loaded/list 或 thread/read 响应中收集已加载线程编号。 */
function collectLoadedThreadIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') ids.add(item);
      else collectLoadedThreadIds(item, ids);
    }
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string') ids.add(record.id);
    for (const item of Object.values(record)) collectLoadedThreadIds(item, ids);
  }
  return ids;
}

/** 判断 thread/read 响应是否包含活动轮次。 */
function responseHasActiveTurn(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(responseHasActiveTurn);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.status === 'active' || record.status === 'inProgress' || record.status === 'running') return true;
  return Object.values(record).some(responseHasActiveTurn);
}

/** 通过 daemon 内存线程清单统计真实活动轮次，而非只看 ozw 本地会话。 */
async function readDaemonActiveTurnCount(transport: CodexAppServerTransport): Promise<number> {
  const loaded = await transport.request('thread/loaded/list', {});
  let count = 0;
  for (const threadId of collectLoadedThreadIds(loaded)) {
    const thread = await transport.request('thread/read', { threadId, includeTurns: true });
    if (responseHasActiveTurn(thread)) count += 1;
  }
  return count;
}

/** 在首次业务请求前比较真实已应用网络状态，并保护 daemon 活动轮次。 */
async function coordinateExistingDaemonNetwork(launch: ProductionTransportLaunch): Promise<void> {
  if (!launch.daemonWasReady || !launch.networkPolicy) return;
  const current = readCodexDaemonNetworkState(launch.codexHome);
  if (current?.appliedFingerprint === launch.networkPolicy.fingerprint) return;

  const probe = spawnSharedProxy(launch, {});
  let activeTurnCount = 1;
  try {
    activeTurnCount = await readDaemonActiveTurnCount(probe);
  } catch {
    activeTurnCount = 1;
  } finally {
    probe.close();
  }
  const decision = decideCodexDaemonRestart({
    currentNetworkFingerprint: current?.appliedFingerprint || 'unknown',
    targetNetworkFingerprint: launch.networkPolicy.fingerprint,
    activeTurnCount,
  });
  if (!decision.restartNow) {
    writeCodexDaemonNetworkState(launch.codexHome, {
      appliedFingerprint: current?.appliedFingerprint || 'unknown',
      pendingFingerprint: launch.networkPolicy.fingerprint,
    });
    return;
  }

  const restart = spawnSync('codex', ['app-server', 'daemon', 'restart'], {
    env: launch.networkPolicy.daemonEnv as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: 15000,
  });
  if (restart.error || restart.status !== 0) {
    const detail = String(restart.stderr || restart.stdout || restart.error?.message || '').trim();
    throw new Error(`Codex daemon 网络配置重启失败${detail ? `：${detail}` : ''}`);
  }
  writeCodexDaemonNetworkState(launch.codexHome, {
    appliedFingerprint: launch.networkPolicy.fingerprint,
    pendingFingerprint: null,
  });
}

/** 创建生产 proxy transport；关闭 transport 只终止 proxy，不停止 daemon。 */
export function createStdioAppServerTransport(options: StdioTransportOptions = {}): CodexAppServerTransport {
  const launch = prepareProductionTransport();
  if (launch.mode === 'private') {
    const child = spawn('codex', launch.args, { stdio: ['pipe', 'pipe', 'pipe'], env: launch.env });
    return createJsonRpcLineTransport(child, options);
  }

  const notificationHandlers: Array<(notification: Parameters<Parameters<CodexAppServerTransport['onNotification']>[0]>[0]) => void> = [];
  let transportPromise: Promise<CodexAppServerTransport> | null = null;
  let liveTransport: CodexAppServerTransport | null = null;
  let closed = false;
  /** 延迟建立最终 proxy，使网络漂移决策先于任何业务请求完成。 */
  const getTransport = () => {
    if (!transportPromise) {
      transportPromise = coordinateExistingDaemonNetwork(launch).then(() => {
        if (closed) throw new Error('Codex app-server transport already closed');
        const transport = spawnSharedProxy(launch, options);
        for (const handler of notificationHandlers) transport.onNotification(handler);
        liveTransport = transport;
        return transport;
      });
    }
    return transportPromise;
  };
  return {
    async request(method, params) {
      return (await getTransport()).request(method, params);
    },
    onNotification(handler) {
      notificationHandlers.push(handler);
      liveTransport?.onNotification(handler);
    },
    close() {
      closed = true;
      void transportPromise?.then((transport) => transport.close());
    },
  };
}
