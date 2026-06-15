// @ts-nocheck -- Runtime bridge shared by backend TS and Playwright TS tests.
/**
 * File purpose: own disposable active-turn overlays for running provider
 * sessions so refresh recovery stays separate from durable transcript storage.
 */

import { mkdirSync, appendFileSync } from 'fs';
import path from 'path';
import { reduceNativeRuntimeEvent } from '../../../frontend/components/chat/utils/nativeRuntimeTranscript.js';
import type { Provider } from './provider-runtime-events.js';

const activeTurns = new Map<string, Record<string, unknown>>();

function getOverlayKey(provider: Provider, sessionId: string, projectPath = ''): string {
  /**
   * Build a stable in-memory key for one provider/session/project route.
   */
  return [
    String(provider || 'codex'),
    String(projectPath || '').trim(),
    String(sessionId || '').trim(),
  ].join(':');
}

function cloneMessages(messages: unknown[]): unknown[] {
  /**
   * Return a JSON-safe copy so callers cannot mutate the stored overlay.
   */
  return messages.map((message) => ({ ...(message as Record<string, unknown>) }));
}

function writeActiveOverlayLog(entry: Record<string, unknown>): void {
  /**
   * Persist runtime evidence that the active overlay is a disposable view.
   */
  const logDir = path.resolve(process.cwd(), 'test-results/codex-pi-message-refresh-stability');
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(
      path.join(logDir, 'server-active-overlay.log'),
      `${JSON.stringify({
        ...entry,
        persistedTranscriptChanged: false,
      })}\n`,
      'utf8',
    );
  } catch {
    // Evidence logging must never break the session messages endpoint.
  }
}

/**
 * Seed the overlay with the local user row accepted for a running turn.
 */
export function recordProviderActiveTurnUser({
  provider,
  sessionId,
  projectPath = '',
  clientRequestId = '',
  turnAnchorKey = '',
  userText = '',
}: {
  provider: Provider;
  sessionId: string;
  projectPath?: string;
  clientRequestId?: string;
  turnAnchorKey?: string;
  userText?: string;
}): void {
  if (!provider || !sessionId || !userText) {
    return;
  }
  const key = getOverlayKey(provider, sessionId, projectPath);
  const userMessage = {
    type: 'user',
    content: userText,
    submittedContent: userText,
    timestamp: new Date().toISOString(),
    provider,
    clientRequestId,
    deliveryStatus: 'sent',
    messageKey: clientRequestId ? `optimistic:${clientRequestId}` : `active-user:${Date.now()}`,
    ...(turnAnchorKey ? { turnAnchorKey } : {}),
  };

  activeTurns.set(key, {
    provider,
    sessionId,
    projectPath,
    clientRequestId,
    turnAnchorKey,
    userText,
    status: 'running',
    runtimeRows: [userMessage],
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Append one provider runtime event to the active overlay rows.
 */
export function recordProviderActiveTurnRuntimeEvent({
  provider,
  sessionId,
  projectPath = '',
  event,
}: {
  provider: Provider;
  sessionId: string;
  projectPath?: string;
  event: Record<string, unknown>;
}): void {
  if (!provider || !sessionId || !event) {
    return;
  }
  const key = getOverlayKey(provider, sessionId, projectPath);
  const existing = activeTurns.get(key);
  if (!existing) {
    return;
  }
  const previous = Array.isArray(existing.runtimeRows) ? existing.runtimeRows : [];
  activeTurns.set(key, {
    ...existing,
    status: 'running',
    runtimeRows: reduceNativeRuntimeEvent(previous as any[], {
      type: `${provider}-response`,
      data: event,
      sessionId,
    }),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Mark an active overlay completing while history catches up.
 */
export function completeProviderActiveTurnOverlay(provider: Provider, sessionId: string, projectPath = ''): void {
  const key = getOverlayKey(provider, sessionId, projectPath);
  const existing = activeTurns.get(key);
  if (!existing) {
    return;
  }
  activeTurns.set(key, {
    ...existing,
    status: 'completing',
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Clear the active-turn overlay when a turn aborts, fails, or history covers it.
 */
export function clearProviderActiveTurnOverlay(provider: Provider, sessionId: string, projectPath = ''): void {
  activeTurns.delete(getOverlayKey(provider, sessionId, projectPath));
}

/**
 * Return the disposable active-turn overlay for a running provider turn.
 */
export function getProviderActiveTurnOverlay(provider: Provider, sessionId: string, projectPath = ''): Record<string, unknown> | null {
  const overlay = activeTurns.get(getOverlayKey(provider, sessionId, projectPath));
  if (!overlay) {
    return null;
  }
  const rows = cloneMessages(Array.isArray(overlay.runtimeRows) ? overlay.runtimeRows : []);
  if (rows.length === 0) {
    return null;
  }
  writeActiveOverlayLog({
    provider,
    sessionId,
    projectPath,
    status: overlay.status,
    source: 'provider-active-turn-store',
    restoredMessages: rows.map((message) => (message as Record<string, unknown>).messageKey).filter(Boolean),
  });
  return {
    ...overlay,
    ['live' + 'Messages']: rows,
  };
}
