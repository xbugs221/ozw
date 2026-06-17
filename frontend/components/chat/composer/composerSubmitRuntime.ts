/**
 * PURPOSE: Own composer submit request calculations outside the React hook.
 * 业务目的：让消息提交禁用原因、请求体和 pending user message 可单测，避免重复发送。
 */
export function resolveSubmitDisabledReason(input: { isLoading?: boolean; isProcessing?: boolean; message?: string; attachmentCount?: number }): string | null {
  /** 返回用户点击发送时应阻止提交的业务原因。 */
  if (input.isLoading) return 'loading';
  if (input.isProcessing) return 'processing';
  if (!String(input.message || '').trim() && !input.attachmentCount) return 'empty';
  return null;
}

export function buildSubmitRequest(input: { message: string; provider: string; sessionId?: string | null; projectName?: string | null; attachments?: unknown[] }) {
  /** 生成发送到后端的稳定提交请求对象。 */
  return { message: input.message, provider: input.provider, sessionId: input.sessionId || null, projectName: input.projectName || null, attachments: input.attachments || [] };
}

export function createPendingUserMessage(input: { id: string; content: string; attachments?: unknown[] }) {
  /** 创建本地乐观用户消息，等待 realtime 或持久化结果确认。 */
  return { id: input.id, type: 'user' as const, content: input.content, attachments: input.attachments || [], deliveryStatus: 'pending' as const };
}
