/**
 * PURPOSE: Normalize Pi queue_update realtime events into route-session UI state.
 */

export interface PiQueueState {
  sessionId: string;
  providerSessionId: string;
  steering: string[];
  followUp: string[];
}

interface PiQueueMessageLike {
  sessionId?: unknown;
  ozwSessionId?: unknown;
  ozw_session_id?: unknown;
  steering?: unknown;
  followUp?: unknown;
}

const textValue = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export const normalizePiQueueItems = (value: unknown): string[] => {
  /**
   * Keep only SDK queue message text values that the composer can count safely.
   */
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

export const resolvePiQueueUiSessionId = (message: PiQueueMessageLike): string => {
  /**
   * Prefer ozw route identity so cN chat pages can own provider-session queue events.
   */
  return textValue(message.ozwSessionId) || textValue(message.ozw_session_id) || textValue(message.sessionId);
};

export const buildPiQueueState = (message: PiQueueMessageLike): PiQueueState | null => {
  /**
   * Convert a backend session-queue-state payload into active-route UI state.
   */
  const sessionId = resolvePiQueueUiSessionId(message);
  if (!sessionId) {
    return null;
  }
  return {
    sessionId,
    providerSessionId: textValue(message.sessionId),
    steering: normalizePiQueueItems(message.steering),
    followUp: normalizePiQueueItems(message.followUp),
  };
};

export const isPiQueueForActiveSession = (
  state: PiQueueState | null,
  currentSessionId?: string | null,
  selectedSessionId?: string | null,
): state is PiQueueState => {
  /**
   * Match queue state against the visible route session, not the provider id.
   */
  const activeSessionId = currentSessionId || selectedSessionId || null;
  return Boolean(activeSessionId && state?.sessionId === activeSessionId);
};
