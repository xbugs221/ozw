/**
 * PURPOSE: Own chat submit request identity and duplicate submit window rules.
 */

export const CHAT_SUBMIT_DEDUP_WINDOW_MS = 1500;

export type ComposerSubmitPhase = 'idle' | 'uploading' | 'dispatching' | 'cooldown';

export interface ActiveComposerSubmit {
  requestId: string;
  startedAt: number;
}

/**
 * Create a client request id for optimistic user message ownership.
 */
export function createComposerClientRequestId(): string {
  return `chatreq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Decide whether a submit is still within the duplicate protection window.
 */
export function isDuplicateComposerSubmit(active: ActiveComposerSubmit | null, now: number): boolean {
  return Boolean(active && now - active.startedAt < CHAT_SUBMIT_DEDUP_WINDOW_MS);
}
