/**
 * PURPOSE: Store and normalize chat WebSocket client scopes.
 * 业务目的：集中管理私有 realtime 事件的 session 归属，避免跨窗口串消息。
 */
export type ChatClientScope = { userId: string | null; projectName: string; projectPath: string; provider: string; ozwSessionId: string; providerSessionId: string; clientRequestId: string };

export function normalizeChatClientScope(scope: Record<string, any>, userId: string | null): ChatClientScope | null {
  /** 规范化浏览器声明的 chat scope 字段。 */
  const ozwSessionId = String(scope.ozwSessionId || scope.ozw_session_id || scope.sessionId || '').trim();
  const providerSessionId = String(scope.providerSessionId || scope.provider_session_id || '').trim();
  const clientRequestId = String(scope.clientRequestId || scope.client_request_id || scope.startRequestId || scope.start_request_id || '').trim();
  if (!ozwSessionId && !providerSessionId && !clientRequestId) return null;
  return { userId, projectName: String(scope.projectName || scope.project_name || '').trim(), projectPath: String(scope.projectPath || scope.project_path || scope.cwd || '').trim(), provider: String(scope.provider || '').trim(), ozwSessionId, providerSessionId, clientRequestId };
}

export function createChatClientScopeStore() {
  /** 创建按 WebSocket 对象隔离的 scope store。 */
  const scopes = new WeakMap<object, ChatClientScope[]>();
  return { get: (client: object) => scopes.get(client) || [], set: (client: object, next: ChatClientScope[]) => scopes.set(client, next.slice(-20)), clear: (client: object) => scopes.delete(client) };
}
