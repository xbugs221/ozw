/**
 * 文件目的：连接用户自管 Codex daemon 的 stdio proxy，并交给通用 JSON-RPC 行传输。
 * 业务意义：ozw 只持有 proxy 子进程，不改变独立 daemon 的生命周期或配置。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { probeCodexSharedRuntimeCapabilities } from './capability-probe.js';
import {
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

/** 验证用户自管 daemon 可连接并返回 proxy 参数。 */
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
    throw new Error('Codex CLI 缺少 daemon/proxy/Unix Socket/remote TUI 能力，请升级 Codex 并由用户启动 daemon');
  }

  if (!plan.ready) {
    throw new Error(`Codex app-server daemon 不可连接（${plan.socketPath}），请由用户启动或维修 daemon`);
  }
  return {
    args: plan.proxyArgs || buildCodexAppServerCliArgs(socketPath),
    env: process.env,
  };
}

/** 启动一条连接共享 daemon 的 proxy transport。 */
function spawnSharedProxy(launch: ProductionTransportLaunch, options: JsonRpcLineTransportOptions): CodexAppServerTransport {
  const child = spawn('codex', launch.args, { stdio: ['pipe', 'pipe', 'pipe'], env: launch.env });
  return createWebSocketProxyTransport(child, options);
}

/** 创建生产 proxy transport；关闭 transport 只终止 proxy，不停止 daemon。 */
export function createStdioAppServerTransport(options: StdioTransportOptions = {}): CodexAppServerTransport {
  const launch = prepareProductionTransport();
  const notificationHandlers: Array<(notification: Parameters<Parameters<CodexAppServerTransport['onNotification']>[0]>[0]) => void> = [];
  let transportPromise: Promise<CodexAppServerTransport> | null = null;
  let liveTransport: CodexAppServerTransport | null = null;
  let closed = false;
  /** 延迟建立最终 proxy，使网络漂移决策先于任何业务请求完成。 */
  const getTransport = () => {
    if (!transportPromise) {
      transportPromise = Promise.resolve().then(() => {
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
