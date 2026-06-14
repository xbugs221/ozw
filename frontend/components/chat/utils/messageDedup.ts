/**
 * PURPOSE: Collapse accidental adjacent duplicate transcript messages that can
 * appear when local cache and restored session history overlap during refresh.
 */

import type { ChatMessage } from '../types/types';

const ADJACENT_DUPLICATE_WINDOW_MS = 5000;

/**
 * Normalize freeform text so whitespace-only differences do not block deduping.
 */
function normalizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Convert a timestamp-like value into epoch milliseconds when possible.
 */
function toTimestampMs(value: unknown): number | null {
  const timestamp = new Date(value as string | number | Date).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Build a stable attachment identity so attachment messages only dedupe exact echoes.
 */
function getAttachmentSignature(message: ChatMessage): string {
  const attachments = [
    ...(Array.isArray(message.attachments) ? message.attachments : []),
    ...(Array.isArray(message.images) ? message.images : []),
  ];

  if (attachments.length === 0) {
    return '';
  }

  return attachments
    .map((attachment) => {
      if (!attachment || typeof attachment !== 'object') {
        return normalizeText(String(attachment));
      }
      const record = attachment as unknown as Record<string, unknown>;
      return normalizeText(
        record.absolutePath
        || record.path
        || record.relativePath
        || record.url
        || record.name
        || record.id
        || JSON.stringify(attachment),
      );
    })
    .sort()
    .join('|');
}

/**
 * Collect durable send identities that separate real repeat sends from echoes.
 */
function getReliableSendIdentityValues(message: ChatMessage): string[] {
  return [
    message.clientRequestId,
    message.requestId,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

/**
 * Check whether both rows can be proven to represent the same send.
 */
function hasSharedReliableSendIdentity(previousMessage: ChatMessage, nextMessage: ChatMessage): boolean {
  const previousIdentities = getReliableSendIdentityValues(previousMessage);
  const nextIdentities = getReliableSendIdentityValues(nextMessage);
  if (previousIdentities.length === 0 || nextIdentities.length === 0) {
    return false;
  }

  const nextIdentitySet = new Set(nextIdentities);
  return previousIdentities.some((identity) => nextIdentitySet.has(identity));
}

/**
 * Check whether stable send identities prove two rows are different sends.
 */
function hasConflictingReliableSendIdentity(previousMessage: ChatMessage, nextMessage: ChatMessage): boolean {
  const identityKeys = ['clientRequestId', 'requestId'] as const;
  return identityKeys.some((identityKey) => {
    const previousIdentity = previousMessage[identityKey];
    const nextIdentity = nextMessage[identityKey];
    return typeof previousIdentity === 'string'
      && previousIdentity.length > 0
      && typeof nextIdentity === 'string'
      && nextIdentity.length > 0
      && previousIdentity !== nextIdentity;
  });
}

/**
 * Treat two persisted provider rows with different read-model keys as real turns.
 */
function hasConflictingPersistedMessageKey(previousMessage: ChatMessage, nextMessage: ChatMessage): boolean {
  return previousMessage.deliveryStatus === 'persisted'
    && nextMessage.deliveryStatus === 'persisted'
    && typeof previousMessage.messageKey === 'string'
    && previousMessage.messageKey.length > 0
    && typeof nextMessage.messageKey === 'string'
    && nextMessage.messageKey.length > 0
    && previousMessage.messageKey !== nextMessage.messageKey;
}

/**
 * Restrict deduping to transcript entries that do not represent tool/runtime UI.
 */
function isPlainTranscriptMessage(message: ChatMessage): boolean {
  if (!message || (message.type !== 'user' && message.type !== 'assistant')) {
    return false;
  }

  return !message.isToolUse
    && !message.isStreaming
    && !message.isInteractivePrompt
    && !message.isThinking
    && !message.isTaskNotification;
}

/**
 * Decide whether two adjacent transcript messages represent the same payload.
 */
function isAdjacentDuplicate(previousMessage: ChatMessage, nextMessage: ChatMessage): boolean {
  if (!isPlainTranscriptMessage(previousMessage) || !isPlainTranscriptMessage(nextMessage)) {
    return false;
  }

  if (previousMessage.type !== nextMessage.type) {
    return false;
  }

  if (hasSharedReliableSendIdentity(previousMessage, nextMessage)) {
    return true;
  }

  if (hasConflictingReliableSendIdentity(previousMessage, nextMessage)) {
    return false;
  }

  if (hasConflictingPersistedMessageKey(previousMessage, nextMessage)) {
    return false;
  }

  if (normalizeText(previousMessage.content) !== normalizeText(nextMessage.content)) {
    return false;
  }

  if (normalizeText(previousMessage.reasoning) !== normalizeText(nextMessage.reasoning)) {
    return false;
  }

  if (getAttachmentSignature(previousMessage) !== getAttachmentSignature(nextMessage)) {
    return false;
  }

  const previousTimestamp = toTimestampMs(previousMessage.timestamp);
  const nextTimestamp = toTimestampMs(nextMessage.timestamp);

  if (previousTimestamp === null || nextTimestamp === null) {
    return true;
  }

  return Math.abs(nextTimestamp - previousTimestamp) <= ADJACENT_DUPLICATE_WINDOW_MS;
}

/**
 * Build a same-turn user key for non-adjacent realtime duplicates.
 */
function getUserTurnKey(message: ChatMessage): string | null {
  if (!isPlainTranscriptMessage(message) || message.type !== 'user') {
    return null;
  }

  const timestamp = toTimestampMs(message.timestamp);
  if (timestamp === null) {
    return null;
  }

  const content = normalizeText(message.content);
  if (!content) {
    return null;
  }

  const reasoning = normalizeText(message.reasoning);
  const attachmentSignature = getAttachmentSignature(message);
  return `${timestamp}:${content}:${reasoning}:${attachmentSignature}`;
}

/**
 * Rank delivery states so duplicate local rows keep the most complete status.
 */
function getDeliveryStatusRank(status: string | undefined): number {
  switch (status) {
    case 'persisted':
      return 4;
    case 'sent':
      return 3;
    case 'pending':
      return 2;
    case 'failed':
      return 1;
    default:
      return 0;
  }
}

/**
 * Preserve the stronger user delivery status when dropping a duplicate row.
 */
function mergeDuplicateMessage(previousMessage: ChatMessage, nextMessage: ChatMessage): ChatMessage {
  if (previousMessage.type !== 'user') {
    return previousMessage;
  }

  const previousRank = getDeliveryStatusRank(previousMessage.deliveryStatus);
  const nextRank = getDeliveryStatusRank(nextMessage.deliveryStatus);
  if (previousRank > 0 && nextRank === 0 && previousMessage.deliveryStatus !== 'persisted') {
    return {
      ...previousMessage,
      deliveryStatus: 'persisted',
    };
  }

  if (nextRank <= previousRank) {
    return previousMessage;
  }

  return {
    ...previousMessage,
    deliveryStatus: nextMessage.deliveryStatus,
  };
}

interface SeenUserTurnDetail {
  timestamp: number;
  content: string;
  reasoning: string;
  attachmentSignature: string;
  dedupedIndex: number;
  message: ChatMessage;
}

/**
 * Check whether a non-adjacent user row is the same send replayed in memory.
 */
function findSeenUserTurnIndex(seenUserTurns: SeenUserTurnDetail[], message: ChatMessage): number {
  if (!isPlainTranscriptMessage(message) || message.type !== 'user') {
    return -1;
  }

  const timestamp = toTimestampMs(message.timestamp);
  const content = normalizeText(message.content);
  const reasoning = normalizeText(message.reasoning);
  const attachmentSignature = getAttachmentSignature(message);
  if (timestamp === null || !content) {
    return -1;
  }

  return seenUserTurns.findIndex((seen) => (
    !hasConflictingReliableSendIdentity(seen.message, message)
    && !hasConflictingPersistedMessageKey(seen.message, message)
    && seen.content === content
    && seen.reasoning === reasoning
    && seen.attachmentSignature === attachmentSignature
    && Math.abs(timestamp - seen.timestamp) <= ADJACENT_DUPLICATE_WINDOW_MS
  ));
}

/**
 * Remove adjacent duplicate transcript entries while preserving original order.
 */
export function dedupeAdjacentChatMessages<T extends ChatMessage>(messages: T[]): T[] {
  if (!Array.isArray(messages) || messages.length < 2) {
    return Array.isArray(messages) ? messages : [];
  }

  const dedupedMessages: ChatMessage[] = [];
  const seenUserTurnDetails: SeenUserTurnDetail[] = [];

  for (const message of messages) {
    const userTurnKey = getUserTurnKey(message);
    const previousMessage = dedupedMessages[dedupedMessages.length - 1];
    if (previousMessage && isAdjacentDuplicate(previousMessage, message)) {
      dedupedMessages[dedupedMessages.length - 1] = mergeDuplicateMessage(previousMessage, message);
      continue;
    }

    const seenUserTurnIndex = findSeenUserTurnIndex(seenUserTurnDetails, message);
    if (seenUserTurnIndex >= 0) {
      const dedupedIndex = seenUserTurnDetails[seenUserTurnIndex].dedupedIndex;
      dedupedMessages[dedupedIndex] = mergeDuplicateMessage(dedupedMessages[dedupedIndex], message);
      continue;
    }

    if (userTurnKey) {
      const ts = toTimestampMs(message.timestamp);
      seenUserTurnDetails.push({
        timestamp: ts ?? 0,
        content: normalizeText(message.content),
        reasoning: normalizeText(message.reasoning),
        attachmentSignature: getAttachmentSignature(message),
        dedupedIndex: dedupedMessages.length,
        message,
      });
    }
    dedupedMessages.push(message);
  }

  return dedupedMessages as T[];
}
