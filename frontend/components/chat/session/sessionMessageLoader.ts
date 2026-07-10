/**
 * PURPOSE: Own chat session message loading request shapes without mutating UI state.
 */

export const SESSION_MESSAGES_PER_PAGE = 50;

export interface SessionMessageWindow {
  limit: number | null;
  offset: number;
  afterLine: number | null;
  afterCursor: string | null;
}

/**
 * Build the default initial session message request window.
 */
export function createInitialSessionMessageWindow(): SessionMessageWindow {
  return { limit: SESSION_MESSAGES_PER_PAGE, offset: 0, afterLine: null, afterCursor: null };
}

/**
 * Build a request window for loading older messages above the current transcript.
 */
export function createOlderSessionMessageWindow(offset: number): SessionMessageWindow {
  return { limit: SESSION_MESSAGES_PER_PAGE, offset, afterLine: null, afterCursor: null };
}

/**
 * Read the provider JSONL line cursor from a persisted message key.
 */
export function getSessionMessageRawLineCursor(message: unknown): number | null {
  /**
   * Codex provider rows encode the authoritative raw line as
   * `...:line:<number>:...`; this is the only cursor that stays stable when a
   * tail page contains fewer converted UI messages than raw JSONL records.
   */
  const record = message && typeof message === 'object' ? message as Record<string, unknown> : null;
  const messageKey = typeof record?.messageKey === 'string' ? record.messageKey : '';
  const match = messageKey.match(/(?:^|:)line:(\d+)(?::|$)/);
  if (!match) {
    return null;
  }

  const cursor = Number(match[1]);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
}

/**
 * Return the newest raw JSONL line cursor represented by a message list.
 */
export function getMaxSessionMessageRawLineCursor(messages: unknown[]): number | null {
  /**
   * Older pages can be prepended later, so callers compare this value against
   * their current cursor instead of blindly replacing it.
   */
  let maxCursor: number | null = null;
  for (const message of Array.isArray(messages) ? messages : []) {
    const cursor = getSessionMessageRawLineCursor(message);
    if (cursor !== null && (maxCursor === null || cursor > maxCursor)) {
      maxCursor = cursor;
    }
  }
  return maxCursor;
}

/**
 * Resolve the append cursor from backend metadata and raw message identities.
 */
export function resolveSessionMessageRawLineCursor(
  messages: unknown[],
  nextRawLineOffset: number | null,
): number | null {
  /**
   * Backend `nextRawLineOffset` is useful metadata, while message keys protect
   * tail-page refreshes where visible rows are fewer than raw provider lines.
   */
  const messageCursor = getMaxSessionMessageRawLineCursor(messages);
  const offsetCursor = nextRawLineOffset !== null && Number.isSafeInteger(nextRawLineOffset) && nextRawLineOffset >= 0
    ? nextRawLineOffset
    : null;

  if (messageCursor === null) {
    return offsetCursor;
  }
  if (offsetCursor === null) {
    return messageCursor;
  }
  return Math.max(messageCursor, offsetCursor);
}
