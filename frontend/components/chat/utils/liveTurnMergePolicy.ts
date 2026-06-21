/**
 * PURPOSE: Share live-turn merge decisions between session hydration and
 * transcript merging so live assistant rows remain visible before JSONL replay.
 */
import type { ChatMessage } from '../types/types';

const LIVE_ASSISTANT_SOURCES = new Set([
  'codex-live',
  'pi-live',
  'codex-realtime',
  'claude-realtime',
]);

/**
 * Detect local user rows accepted by the send path but not yet replaced by the
 * authoritative persisted transcript row.
 */
export function shouldPreserveAcceptedOptimisticUser(message: ChatMessage): boolean {
  return message.type === 'user'
    && message.deliveryStatus === 'persisted'
    && typeof message.messageKey === 'string'
    && message.messageKey.startsWith('optimistic:');
}

/**
 * Decide whether a local row should survive an empty or lagging persisted
 * refresh for the same session.
 */
export function shouldPreserveLiveTurnDuringEmptyReload(message: ChatMessage): boolean {
  if (message.type === 'user') {
    return Boolean(message.deliveryStatus);
  }

  return Boolean(
    message.isStreaming ||
    message.isInteractivePrompt ||
    LIVE_ASSISTANT_SOURCES.has(String(message.source || '')),
  );
}

/**
 * Decide whether a live assistant/tool row can render as part of an accepted
 * turn while provider JSONL has not replayed the final row yet.
 */
export function canRenderLiveRowForAcceptedTurn(message: ChatMessage): boolean {
  return message.type === 'assistant'
    && LIVE_ASSISTANT_SOURCES.has(String(message.source || ''));
}

/**
 * Detect provider-native live rows that should survive draft-session promotion.
 */
export function isNativeLiveTurnMessage(message: ChatMessage): boolean {
  return message.source === 'codex-live' || message.source === 'pi-live' || message.source === 'codex-realtime';
}

/**
 * Decide whether the follow-latest action should avoid pulling JSONL tail rows
 * because the active provider turn is already represented by WS live overlay.
 */
export function shouldDeferFollowLatestRefresh(input: {
  messages: ChatMessage[];
  isRealtimeConnected: boolean;
  isTurnRunning: boolean;
}): boolean {
  /**
   * While a native provider turn is still running, WS owns the visible current
   * turn. JSONL refreshes can still happen from external updates or completion
   * paths, but the follow button itself should only move the viewport.
   */
  return input.isRealtimeConnected
    && input.isTurnRunning
    && input.messages.some(isNativeLiveTurnMessage);
}
