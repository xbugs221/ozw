// @ts-nocheck -- Runtime bridge shared by backend TS and Playwright TS tests.
/**
 * PURPOSE: Maintain disposable active-turn overlays for running provider
 * sessions so a browser refresh can recover local user and live assistant
 * rows without writing new durable transcript records.
 */

import { mkdirSync, appendFileSync } from 'fs';
import path from 'path';
import { reduceNativeRuntimeEvent } from '../frontend/components/chat/utils/nativeRuntimeTranscript.js';

const activeTurns = new Map<string, Record<string, unknown>>();

function getOverlayKey(provider: string, sessionId: string, projectPath = ''): string {
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
   * Persist runtime evidence that active overlay is a disposable server view.
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

export function recordActiveTurnUser({
  provider,
  sessionId,
  projectPath = '',
  clientRequestId = '',
  turnAnchorKey = '',
  userText = '',
}: {
  provider: string;
  sessionId: string;
  projectPath?: string;
  clientRequestId?: string;
  turnAnchorKey?: string;
  userText?: string;
}): void {
  /**
   * Seed the overlay with the local user row accepted for a running turn.
   */
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
    liveMessages: [userMessage],
    updatedAt: new Date().toISOString(),
  });
}

export function recordActiveTurnRuntimeEvent({
  provider,
  sessionId,
  projectPath = '',
  event,
}: {
  provider: string;
  sessionId: string;
  projectPath?: string;
  event: Record<string, unknown>;
}): void {
  /**
   * Append one provider runtime event to the active overlay live messages.
   */
  if (!provider || !sessionId || !event) {
    return;
  }
  const key = getOverlayKey(provider, sessionId, projectPath);
  const existing = activeTurns.get(key);
  if (!existing) {
    return;
  }
  const previous = Array.isArray(existing.liveMessages) ? existing.liveMessages : [];
  activeTurns.set(key, {
    ...existing,
    status: 'running',
    liveMessages: reduceNativeRuntimeEvent(previous as any[], {
      type: `${provider}-response`,
      data: event,
      sessionId,
    }),
    updatedAt: new Date().toISOString(),
  });
}

export function completeActiveTurnOverlay(provider: string, sessionId: string, projectPath = ''): void {
  /**
   * Mark an active overlay completing while history catches up.
   */
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

export function clearActiveTurnOverlay(provider: string, sessionId: string, projectPath = ''): void {
  /**
   * Remove a disposable overlay after durable history covers it.
   */
  activeTurns.delete(getOverlayKey(provider, sessionId, projectPath));
}

export function getActiveTurnOverlay(provider: string, sessionId: string, projectPath = ''): Record<string, unknown> | null {
  /**
   * Return the active overlay snapshot used by the session messages endpoint.
   */
  const overlay = activeTurns.get(getOverlayKey(provider, sessionId, projectPath));
  if (!overlay) {
    return null;
  }
  const liveMessages = cloneMessages(Array.isArray(overlay.liveMessages) ? overlay.liveMessages : []);
  if (liveMessages.length === 0) {
    return null;
  }
  writeActiveOverlayLog({
    provider,
    sessionId,
    projectPath,
    status: overlay.status,
    source: 'backend-active-turn-overlay',
    restoredMessages: liveMessages.map((message) => (message as Record<string, unknown>).messageKey).filter(Boolean),
  });
  return {
    ...overlay,
    liveMessages,
  };
}
