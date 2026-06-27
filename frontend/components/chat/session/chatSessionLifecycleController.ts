/**
 * PURPOSE: Keep chat session lifecycle calculations outside the React hook.
 * 业务目的：集中处理加载计划、加载结果和可见消息窗口，降低会话切换丢消息风险。
 */
import type { ChatMessage } from '../types/types';
import { getIntrinsicMessageKey } from '../utils/messageKeys';

export function buildSessionLoadPlan(input: { loadMore?: boolean; offset?: number; pageSize?: number; total?: number }) {
  /** 计算一次 session messages 请求应使用的分页参数。 */
  const loadMore = input.loadMore === true;
  const offset = loadMore ? Math.max(0, input.offset || 0) : 0;
  const limit = Math.max(1, input.pageSize || 50);
  return { loadMore, offset, limit, hasKnownTotal: typeof input.total === 'number' && input.total >= 0 };
}

export function applySessionLoadResult<TMessage>(previous: TMessage[], result: { messages?: TMessage[]; total?: number; nextRawLineOffset?: number }, loadMore = false) {
  /** 合并 session 加载结果，保留服务端 total 和下一次 raw offset。 */
  const incoming = Array.isArray(result.messages) ? result.messages : [];
  const messages = loadMore ? [...previous, ...incoming] : incoming;
  return { messages, total: typeof result.total === 'number' ? result.total : messages.length, nextOffset: result.nextRawLineOffset ?? messages.length };
}

function getVisibleWindowMessageKey<TMessage>(message: TMessage, index: number): string {
  /** 用和运行时冻结尾部一致的 key 规则定位窗口结束点。 */
  return getIntrinsicMessageKey(message as ChatMessage) || `message-position-${index}`;
}

export function buildVisibleMessageWindow<TMessage>(messages: TMessage[], visibleCount: number, frozenTailKey: string | null = null): TMessage[] {
  /** 返回聊天窗口当前应渲染的尾部消息集合。 */
  const count = Number.isFinite(visibleCount) ? Math.max(0, visibleCount) : messages.length;
  const frozenTailIndex = frozenTailKey
    ? messages.findIndex((message, index) => getVisibleWindowMessageKey(message, index) === frozenTailKey)
    : -1;
  const end = frozenTailIndex >= 0 ? frozenTailIndex + 1 : messages.length;
  return messages.slice(Math.max(0, end - count), end);
}
