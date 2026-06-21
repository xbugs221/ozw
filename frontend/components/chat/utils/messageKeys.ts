/**
 * PURPOSE: Build stable UI row identities for chat messages without confusing
 * request/turn identity with individual transcript row identity.
 */
import type { ChatMessage } from '../types/types';

const toMessageKeyPart = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

export const getIntrinsicMessageKey = (message: ChatMessage): string | null => {
  /**
   * User optimistic/persisted rows use clientRequestId as their row identity.
   * Assistant/tool rows can share one clientRequestId across several visible
   * rows in the same turn, so prefer provider row/tool identities there.
   */
  const candidates = message.type === 'user'
    ? [
        message.clientRequestId,
        message.messageKey,
        message.id,
        message.messageId,
        message.blobId,
        message.rowid,
        message.sequence,
      ]
    : [
        message.messageKey,
        message.id,
        message.messageId,
        message.toolId,
        message.toolCallId,
        message.blobId,
        message.rowid,
        message.sequence,
      ];

  for (const candidate of candidates) {
    const keyPart = toMessageKeyPart(candidate);
    if (keyPart) {
      return `message-${message.type}-${keyPart}`;
    }
  }

  const timestamp = new Date(message.timestamp).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const contentPreview = typeof message.content === 'string' ? message.content.slice(0, 48) : '';
  const toolName = typeof message.toolName === 'string' ? message.toolName : '';
  return `message-${message.type}-${timestamp}-${toolName}-${contentPreview}`;
};
