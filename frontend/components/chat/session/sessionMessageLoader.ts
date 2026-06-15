/**
 * PURPOSE: Own chat session message loading request shapes without mutating UI state.
 */

export const SESSION_MESSAGES_PER_PAGE = 100;

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
