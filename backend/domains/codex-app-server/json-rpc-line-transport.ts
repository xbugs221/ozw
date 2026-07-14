/**
 * 文件目的：在任意 stdio 子进程上实现换行分帧的 Codex JSON-RPC 客户端。
 * 业务意义：协议初始化、请求关联和通知分发不依赖 daemon proxy 或兼容进程的启动方式。
 */

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';

export type CodexAppServerNotification = { method: string; params: unknown };
export type CodexAppServerTransport = {
  request(method: string, params: unknown): Promise<unknown>;
  onNotification(handler: (notification: CodexAppServerNotification) => void): void;
  close(): void;
};
export type JsonRpcLineTransportOptions = { onFailure?: (message: string) => void };
type PendingRequest = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

/** 解析一行 JSON-RPC，格式错误只记录并丢弃该行。 */
function parseJsonRpcLine(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch (err) {
    console.error('[codex-app-server] invalid JSON-RPC line', err);
    return null;
  }
}

/** transport 失败时拒绝所有未完成请求。 */
function rejectPendingRequests(pendingRequests: Map<string, PendingRequest>, err: Error): void {
  for (const pending of pendingRequests.values()) pending.reject(err);
  pendingRequests.clear();
}

/** 在已启动的 stdio 子进程上创建带 initialize 握手的 JSON-RPC transport。 */
export function createJsonRpcLineTransport(
  child: ChildProcessWithoutNullStreams,
  options: JsonRpcLineTransportOptions = {},
): CodexAppServerTransport {
  const pendingRequests = new Map<string, PendingRequest>();
  const notificationHandlers: Array<(notification: CodexAppServerNotification) => void> = [];
  let initializedPromise: Promise<unknown> | null = null;
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    const message = parseJsonRpcLine(line);
    if (!message) return;
    if (typeof message.id === 'string' && pendingRequests.has(message.id)) {
      const pending = pendingRequests.get(message.id)!;
      pendingRequests.delete(message.id);
      if (message.error) pending.reject(new Error(String((message.error as Record<string, unknown>)?.message || message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method === 'string') {
      for (const handler of notificationHandlers) {
        try {
          handler({ method: message.method, params: message.params });
        } catch (err) {
          console.error('[codex-app-server] notification handler failed', err);
        }
      }
    }
  });
  child.stderr.on('data', (chunk) => console.error('[codex-app-server]', chunk.toString('utf8')));
  child.on('error', (err) => {
    rejectPendingRequests(pendingRequests, err);
    options.onFailure?.(`Codex app-server process error: ${err.message}`);
  });
  child.on('close', (code) => {
    const err = new Error(`Codex app-server proxy exited with code ${code}`);
    rejectPendingRequests(pendingRequests, err);
    options.onFailure?.(err.message);
  });

  /** 发送一个带唯一 id 的底层请求。 */
  function sendRawRequest(method: string, params: unknown): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      try {
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      } catch (writeErr) {
        pendingRequests.delete(id);
        reject(writeErr);
      }
    });
  }

  /** 首个业务请求前只执行一次 initialize。 */
  function ensureInitialized(): Promise<unknown> {
    if (!initializedPromise) {
      initializedPromise = sendRawRequest('initialize', {
        clientInfo: { name: 'ozw', title: 'OZW', version: 'v2026.06.01' },
        capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: [] },
      }).then((result) => {
        child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
        return result;
      });
    }
    return initializedPromise;
  }

  return {
    async request(method, params) {
      if (method !== 'initialize') await ensureInitialized();
      return sendRawRequest(method, params);
    },
    onNotification(handler) { notificationHandlers.push(handler); },
    close() {
      try {
        child.kill('SIGTERM');
      } catch (err) {
        console.error('[codex-app-server] failed to terminate proxy process', err);
      }
      rl.close();
    },
  };
}
