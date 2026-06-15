/**
 * File purpose: define provider runtime event types and builders shared by
 * Codex app-server and Pi SDK adapters.
 */

export type Provider = 'codex' | 'pi';

export type RuntimeEvent =
  | { type: 'session-created'; sessionId: string; provider: Provider; clientRequestId?: string | null }
  | { type: 'session-status'; sessionId: string; provider: Provider; isProcessing: boolean; turnId?: string; turnStartedAt?: string }
  | { type: 'message-accepted'; sessionId: string; provider: Provider; clientRequestId?: string | null }
  | { type: 'message-rejected'; sessionId: string; provider: Provider; reason: string; clientRequestId?: string | null }
  | { type: 'session-queue-state'; provider: Provider; sessionId: string; steering: string[]; followUp: string[] }
  | { type: 'codex-response'; data: unknown; sessionId: string }
  | { type: 'pi-response'; data: unknown; sessionId: string }
  | { type: 'codex-complete'; sessionId: string; actualSessionId: string }
  | { type: 'pi-complete'; sessionId: string; actualSessionId: string }
  | { type: 'codex-error'; error: string; sessionId: string }
  | { type: 'pi-error'; error: string; sessionId: string }
  | { type: 'token-budget'; data: unknown; sessionId: string }
  | { type: 'session-aborted'; sessionId: string; provider: Provider; success: boolean }
  | { type: 'session-model-state-updated'; provider: Provider; sessionId: string; state: Record<string, unknown> };

/**
 * Build the provider session-created event.
 */
export function toProviderSessionCreatedEvent(input: {
  provider: Provider;
  sessionId: string;
  clientRequestId?: string | null;
}): RuntimeEvent {
  return {
    type: 'session-created',
    provider: input.provider,
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId || null,
  };
}

/**
 * Build the accepted-turn event after provider preflight succeeds.
 */
export function toProviderMessageAcceptedEvent(input: {
  provider: Provider;
  sessionId: string;
  clientRequestId?: string | null;
}): RuntimeEvent {
  return {
    type: 'message-accepted',
    provider: input.provider,
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId || null,
  };
}

/**
 * Build the rejected-turn event after provider preflight fails.
 */
export function toProviderMessageRejectedEvent(input: {
  provider: Provider;
  sessionId: string;
  reason: string;
  clientRequestId?: string | null;
}): RuntimeEvent {
  return {
    type: 'message-rejected',
    provider: input.provider,
    sessionId: input.sessionId,
    reason: input.reason,
    clientRequestId: input.clientRequestId || null,
  };
}

/**
 * Build the frontend session-status event from provider runtime state.
 */
export function toProviderSessionStatusEvent(input: {
  provider: Provider;
  sessionId: string;
  isProcessing: boolean;
  turnId?: string;
  turnStartedAt?: string | null;
}): RuntimeEvent {
  return {
    type: 'session-status',
    provider: input.provider,
    sessionId: input.sessionId,
    isProcessing: input.isProcessing,
    turnId: input.turnId,
    turnStartedAt: input.turnStartedAt || undefined,
  };
}

/**
 * Build a provider queue state event for steering and follow-up buffers.
 */
export function toProviderSessionQueueStateEvent(input: {
  provider: Provider;
  sessionId: string;
  steering?: string[];
  followUp?: string[];
}): RuntimeEvent {
  return {
    type: 'session-queue-state',
    provider: input.provider,
    sessionId: input.sessionId,
    steering: input.steering || [],
    followUp: input.followUp || [],
  };
}

/**
 * Build a provider response event from normalized adapter payload.
 */
export function toProviderRuntimeResponseEvent(input: {
  provider: Provider;
  sessionId: string;
  data: unknown;
}): RuntimeEvent {
  return input.provider === 'codex'
    ? { type: 'codex-response', sessionId: input.sessionId, data: input.data }
    : { type: 'pi-response', sessionId: input.sessionId, data: input.data };
}

/**
 * Build a provider completion event.
 */
export function toProviderRuntimeCompleteEvent(input: {
  provider: Provider;
  sessionId: string;
  actualSessionId: string;
}): RuntimeEvent {
  return input.provider === 'codex'
    ? { type: 'codex-complete', sessionId: input.sessionId, actualSessionId: input.actualSessionId }
    : { type: 'pi-complete', sessionId: input.sessionId, actualSessionId: input.actualSessionId };
}

/**
 * Build the provider-specific frontend error event without leaking adapter
 * internals into websocket callers.
 */
export function toProviderRuntimeErrorEvent(input: {
  provider: Provider;
  sessionId: string;
  error: unknown;
}): RuntimeEvent {
  const message = input.error instanceof Error
    ? input.error.message
    : String(input.error || `${input.provider} runtime error`);
  return input.provider === 'codex'
    ? { type: 'codex-error', sessionId: input.sessionId, error: message }
    : { type: 'pi-error', sessionId: input.sessionId, error: message };
}

/**
 * Build a provider abort result event.
 */
export function toProviderSessionAbortedEvent(input: {
  provider: Provider;
  sessionId: string;
  success: boolean;
}): RuntimeEvent {
  return {
    type: 'session-aborted',
    provider: input.provider,
    sessionId: input.sessionId,
    success: input.success,
  };
}
