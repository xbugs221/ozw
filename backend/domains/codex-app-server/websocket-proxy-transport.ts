/**
 * 文件目的：通过 `codex app-server proxy` 的 stdio 原始流完成 WebSocket 握手与消息传输。
 * 业务意义：proxy 转发的是 HTTP Upgrade 和 WebSocket 帧，不能误按 JSONL 解析。
 */

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Duplex } from 'node:stream';
import WebSocket from 'ws';
import type { CodexAppServerNotification, CodexAppServerTransport, JsonRpcLineTransportOptions } from './json-rpc-line-transport.js';

type PendingRequest = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

/** 把子进程分离的 stdin/stdout 适配成 ws 客户端所需的双工 Socket。 */
function createChildProxySocket(child: ChildProcessWithoutNullStreams): Duplex {
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { child.stdin.write(chunk, callback); },
    destroy(error, callback) {
      try { child.kill('SIGTERM'); } catch { /* proxy 可能已经退出。 */ }
      callback(error || null);
    },
  });
  child.stdout.on('data', (chunk) => socket.push(chunk));
  child.stdout.on('end', () => socket.push(null));
  child.on('error', (error) => socket.destroy(error));
  Object.assign(socket, {
    connecting: false,
    setTimeout: () => socket,
    setNoDelay: () => socket,
    setKeepAlive: () => socket,
    ref: () => socket,
    unref: () => socket,
  });
  setImmediate(() => socket.emit('connect'));
  return socket;
}

/** 创建真实 WebSocket proxy transport，并完成 initialize/initialized 握手。 */
export function createWebSocketProxyTransport(
  child: ChildProcessWithoutNullStreams,
  options: JsonRpcLineTransportOptions = {},
): CodexAppServerTransport {
  const pendingRequests = new Map<string, PendingRequest>();
  const notificationHandlers: Array<(notification: CodexAppServerNotification) => void> = [];
  const socket = createChildProxySocket(child);
  const webSocket = new WebSocket('ws://localhost/rpc', {
    createConnection: () => socket as any,
    perMessageDeflate: false,
  });
  let initializedPromise: Promise<unknown> | null = null;

  child.stderr.on('data', (chunk) => console.error('[codex-app-server]', chunk.toString('utf8')));
  child.on('close', (code) => {
    const error = new Error(`Codex app-server proxy exited with code ${code}`);
    for (const pending of pendingRequests.values()) pending.reject(error);
    pendingRequests.clear();
    options.onFailure?.(error.message);
  });

  /** 等待 WebSocket Upgrade 完成。 */
  function waitForOpen(): Promise<void> {
    if (webSocket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      webSocket.once('open', resolve);
      webSocket.once('error', reject);
    });
  }

  /** 发送一个 JSON-RPC 请求并按 id 关联响应。 */
  async function sendRawRequest(method: string, params: unknown): Promise<unknown> {
    await waitForOpen();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      webSocket.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return;
        pendingRequests.delete(id);
        reject(error);
      });
    });
  }

  /** 每条 proxy 连接执行 initialize，并发送 initialized 通知确认握手。 */
  function ensureInitialized(): Promise<unknown> {
    if (!initializedPromise) {
      initializedPromise = sendRawRequest('initialize', {
        clientInfo: { name: 'ozw', title: 'OZW', version: 'v2026.06.01' },
        capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: [] },
      }).then((result) => {
        webSocket.send(JSON.stringify({ method: 'initialized', params: {} }));
        return result;
      });
    }
    return initializedPromise;
  }

  webSocket.on('message', (data) => {
    let message: Record<string, unknown>;
    try { message = JSON.parse(data.toString()) as Record<string, unknown>; } catch (error) {
      console.error('[codex-app-server] invalid WebSocket JSON-RPC message', error);
      return;
    }
    const messageId = typeof message.id === 'string' || typeof message.id === 'number' ? String(message.id) : '';
    if (messageId && pendingRequests.has(messageId)) {
      const pending = pendingRequests.get(messageId)!;
      pendingRequests.delete(messageId);
      if (message.error) pending.reject(new Error(String((message.error as Record<string, unknown>)?.message || message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method === 'string') {
      for (const handler of notificationHandlers) handler({ method: message.method, params: message.params });
    }
  });
  webSocket.on('error', (error) => options.onFailure?.(`Codex app-server WebSocket error: ${error.message}`));

  return {
    async request(method, params) {
      if (method !== 'initialize') await ensureInitialized();
      return sendRawRequest(method, params);
    },
    onNotification(handler) { notificationHandlers.push(handler); },
    close() {
      if (webSocket.readyState === WebSocket.OPEN) webSocket.close();
      else socket.destroy();
    },
  };
}
