/**
 * File purpose: own provider live transcript snapshots independently from
 * active-turn overlay state.
 */

import { reduceNativeRuntimeEvent, type ChatMessageLike } from '../../../shared/provider-runtime-transcript.js';
import type { Provider } from './provider-runtime-events.js';

type LiveTranscriptRecord = {
  provider: Provider;
  sessionId: string;
  projectPath: string;
  status: 'running' | 'completed';
  messages: ChatMessageLike[];
};

const runningSnapshots = new Map<string, LiveTranscriptRecord>();
const completedSnapshots = new Map<string, LiveTranscriptRecord>();

function getSnapshotKey(provider: Provider, sessionId: string, projectPath = ''): string {
  /**
   * Build a stable in-memory key for one provider/session/project route.
   */
  return [
    provider,
    String(projectPath || '').trim(),
    String(sessionId || '').trim(),
  ].join(':');
}

function cloneMessages(messages: ChatMessageLike[]): ChatMessageLike[] {
  /**
   * Return a shallow copy of transcript rows for caller isolation.
   */
  return messages.map((message) => ({ ...message }));
}

/**
 * Replace the running live transcript snapshot for a provider turn.
 */
export function setProviderLiveTranscriptSnapshot(provider: Provider, sessionId: string, projectPath: string, messages: ChatMessageLike[]): void {
  runningSnapshots.set(getSnapshotKey(provider, sessionId, projectPath), {
    provider,
    sessionId,
    projectPath,
    status: 'running',
    messages: cloneMessages(messages),
  });
}

/**
 * Append a normalized provider runtime event to the running live transcript.
 */
export function recordProviderLiveTranscriptEvent(provider: Provider, sessionId: string, projectPath: string, event: Record<string, unknown>): ChatMessageLike[] {
  const key = getSnapshotKey(provider, sessionId, projectPath);
  const existing = runningSnapshots.get(key);
  const previous = existing?.messages || [];
  const messages = reduceNativeRuntimeEvent(previous, {
    type: `${provider}-response`,
    data: event,
    sessionId,
  }) as ChatMessageLike[];
  setProviderLiveTranscriptSnapshot(provider, sessionId, projectPath, messages);
  return cloneMessages(messages);
}

/**
 * Return the in-progress provider transcript snapshot for refresh recovery.
 */
export function getProviderLiveTranscriptSnapshot(provider: Provider, sessionId: string, projectPath = ''): ChatMessageLike[] | null {
  const snapshot = runningSnapshots.get(getSnapshotKey(provider, sessionId, projectPath));
  if (!snapshot || snapshot.messages.length === 0) {
    return null;
  }
  return cloneMessages(snapshot.messages);
}

/**
 * Preserve the running transcript after completion while provider JSONL catches up.
 */
export function completeProviderLiveTranscriptSnapshot(provider: Provider, sessionId: string, projectPath = ''): void {
  const key = getSnapshotKey(provider, sessionId, projectPath);
  const snapshot = runningSnapshots.get(key);
  if (!snapshot || snapshot.messages.length === 0) {
    runningSnapshots.delete(key);
    return;
  }
  completedSnapshots.set(key, {
    ...snapshot,
    status: 'completed',
    messages: cloneMessages(snapshot.messages),
  });
  runningSnapshots.delete(key);
}

/**
 * Drop an in-progress snapshot when a turn fails or is aborted.
 */
export function discardProviderLiveTranscriptSnapshot(provider: Provider, sessionId: string, projectPath = ''): void {
  runningSnapshots.delete(getSnapshotKey(provider, sessionId, projectPath));
}

/**
 * Return the completed-turn bridge snapshot while provider JSONL catches up.
 */
export function getProviderCompletedTranscriptSnapshot(sessionId: string, projectPath = ''): ChatMessageLike[] | null {
  const snapshot = completedSnapshots.get(getSnapshotKey('pi', sessionId, projectPath));
  if (!snapshot || snapshot.messages.length === 0) {
    return null;
  }
  return cloneMessages(snapshot.messages);
}

/**
 * Clear the completed-turn bridge snapshot after durable JSONL is readable.
 */
export function clearProviderLiveTranscriptSnapshot(sessionId: string, projectPath = ''): void {
  completedSnapshots.delete(getSnapshotKey('pi', sessionId, projectPath));
}
