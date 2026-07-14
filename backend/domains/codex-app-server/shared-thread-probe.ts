/**
 * 文件目的：通过真实 proxy 握手核实共享 daemon 是否拥有目标线程和活动轮次。
 * 业务意义：残留 Socket 或无关 daemon 不能绕过旧式活动会话的安全阻止。
 */

import { spawn } from 'node:child_process';
import { createWebSocketProxyTransport } from './websocket-proxy-transport.js';

export type SharedThreadProbeResult = {
  ready: boolean;
  threadOwned: boolean;
  activeTurnOwned: boolean;
};

/** 从 thread/read 响应中判断目标线程是否有仍在运行的轮次。 */
function hasActiveTurn(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasActiveTurn);
  const record = value as Record<string, unknown>;
  if (record.status === 'inProgress' || record.status === 'running') return true;
  return Object.values(record).some(hasActiveTurn);
}

/** 在 loaded/list 的嵌套响应中精确查找目标线程编号。 */
function containsThreadId(value: unknown, threadId: string): boolean {
  if (value === threadId) return true;
  if (Array.isArray(value)) return value.some((item) => containsThreadId(item, threadId));
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some((item) => containsThreadId(item, threadId));
}

/** 给只读探测设置上限，防止残留 Socket 卡住 Shell 初始化。 */
function withTimeout<T>(promise: Promise<T>, timeoutMs = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('shared thread probe timed out')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** 完成 initialize 与 thread/read，返回可用于安全接管的归属证明。 */
export async function probeSharedCodexThread(socketPath: string, threadId: string): Promise<SharedThreadProbeResult> {
  const child = spawn('codex', ['app-server', 'proxy', '--sock', socketPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  const transport = createWebSocketProxyTransport(child);
  try {
    const loaded = await withTimeout(transport.request('thread/loaded/list', {}));
    if (!containsThreadId(loaded, threadId)) {
      return { ready: true, threadOwned: false, activeTurnOwned: false };
    }
    const result = await withTimeout(transport.request('thread/read', { threadId, includeTurns: true }));
    const thread = (result as Record<string, unknown> | null)?.thread;
    const owned = Boolean(thread && typeof thread === 'object' && String((thread as Record<string, unknown>).id || '') === threadId);
    return { ready: true, threadOwned: owned, activeTurnOwned: owned && hasActiveTurn(thread) };
  } catch {
    return { ready: false, threadOwned: false, activeTurnOwned: false };
  } finally {
    transport.close();
  }
}
