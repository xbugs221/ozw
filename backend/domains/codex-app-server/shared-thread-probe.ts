/**
 * 文件目的：通过真实 proxy 核实共享 daemon 是否拥有目标线程和活动轮次。
 * 业务意义：残留 Socket 或无关 daemon 不能绕过旧式活动会话的安全警告。
 */

import { spawn } from 'node:child_process';
import { createWebSocketProxyTransport } from './websocket-proxy-transport.js';

export type SharedThreadProbeResult = {
  ready: boolean;
  threadOwned: boolean;
  threadReadable: boolean;
  threadState: 'active' | 'idle' | 'unknown';
  activeTurnDetected: boolean;
  activeTurnOwned: boolean;
};

/** 把线程或轮次状态归一化为稳定字符串。 */
function readStatus(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const type = (value as Record<string, unknown>).type;
  return typeof type === 'string' ? type : '';
}

/** 只按线程和最后一轮判断活动性；更早的未完成历史不代表当前仍在运行。 */
export function classifyCodexThreadActivity(thread: unknown): 'active' | 'idle' | 'unknown' {
  if (!thread || typeof thread !== 'object' || Array.isArray(thread)) return 'unknown';
  const record = thread as Record<string, unknown>;
  const activeStatuses = new Set(['active', 'inProgress', 'running']);
  if (activeStatuses.has(readStatus(record.status))) return 'active';
  if (!Array.isArray(record.turns) || record.turns.length === 0) return 'idle';
  const latestTurn = record.turns.at(-1);
  if (!latestTurn || typeof latestTurn !== 'object' || Array.isArray(latestTurn)) return 'unknown';
  const latest = latestTurn as Record<string, unknown>;
  const latestStatus = readStatus(latest.status);
  if (activeStatuses.has(latestStatus)) return 'active';
  if (latestStatus === 'completed' || typeof latest.completedAt === 'number') return 'idle';
  return 'unknown';
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
    const threadOwned = containsThreadId(loaded, threadId);
    try {
      const result = await withTimeout(transport.request('thread/read', { threadId, includeTurns: true }));
      const thread = (result as Record<string, unknown> | null)?.thread;
      const threadReadable = Boolean(
        thread
        && typeof thread === 'object'
        && String((thread as Record<string, unknown>).id || '') === threadId,
      );
      const threadState = threadReadable ? classifyCodexThreadActivity(thread) : 'unknown';
      const activeTurnDetected = threadState === 'active';
      return {
        ready: true,
        threadOwned,
        threadReadable,
        threadState,
        activeTurnDetected,
        activeTurnOwned: threadOwned && activeTurnDetected,
      };
    } catch {
      return {
        ready: true,
        threadOwned,
        threadReadable: false,
        threadState: 'unknown',
        activeTurnDetected: false,
        activeTurnOwned: false,
      };
    }
  } catch {
    return {
      ready: false,
      threadOwned: false,
      threadReadable: false,
      threadState: 'unknown',
      activeTurnDetected: false,
      activeTurnOwned: false,
    };
  } finally {
    transport.close();
  }
}
