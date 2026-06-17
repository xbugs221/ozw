/**
 * PURPOSE: Route realtime chat event names into stable UI actions.
 * 业务目的：集中维护 session/realtime 事件分类，避免 hook 直接散落协议字符串。
 */
export type ChatRealtimeRoute = 'session' | 'stream' | 'permission' | 'status' | 'unknown';

export function routeChatRealtimeEvent(message: { type?: string; [key: string]: unknown } | null | undefined): ChatRealtimeRoute {
  /** 根据后端事件类型判断它应由哪个聊天控制器处理。 */
  const type = String(message?.type || '');
  if (/stream|content|delta/i.test(type)) return 'stream';
  if (/permission/i.test(type)) return 'permission';
  if (/session|created|reloaded/i.test(type)) return 'session';
  if (/complete|failed|aborted|processing|status/i.test(type)) return 'status';
  return 'unknown';
}

export function applyRealtimeSessionEvent<TSession extends { id?: string } | null>(
  currentSession: TSession,
  event: { sessionId?: string | null; actualSessionId?: string | null },
): { sessionId: string | null; matchesCurrentSession: boolean } {
  /** 归一化 realtime 事件中的 session id，并判断是否属于当前会话。 */
  const sessionId = event.actualSessionId || event.sessionId || null;
  return { sessionId, matchesCurrentSession: Boolean(sessionId && currentSession?.id === sessionId) };
}
