/**
 * Session messages HTTP handler — extracted from backend/index.ts so both the
 * Express route and integration tests call the same implementation.
 */
import { extractProjectDirectory, getManualSessionRouteRuntime, getCodexSessions, getPiSessions, getCodexSessionMessages, getPiSessionMessages } from './projects.js';
import { getNativeSessionLiveTranscript, getPiSessionCompletedSnapshot, clearPiSessionSnapshot } from './native-agent-runtime.js';
import { clearActiveTurnOverlay, getActiveTurnOverlay } from './active-turn-overlay.js';

type MessageRecord = Record<string, any>;
type ProviderName = "codex" | "pi";
type SessionMessagesRequest = { params: { projectName: string; sessionId: string }; query: Record<string, any> };
type SessionMessagesResponse = { json(data: unknown): unknown; status(code: number): SessionMessagesResponse };
type SessionMessageReader = (sessionId: string, limit?: number | null, offset?: number, afterLine?: number | null) => Promise<any>;

const CC_ROUTE_SESSION_PATTERN = /^c\d+$/;

/**
 * Convert a live snapshot ChatMessageLike (top-level `content`, `type: 'assistant'`
 * with `isThinking`/`isToolUse` flags) into the same shape as JSONL raw messages
 * so `convertSessionMessages()` on the frontend can process every element uniformly.
 */
export function normalizeLiveMessageToJsonlShape(liveMsg: MessageRecord): MessageRecord {
  // Preserve messageKey and timestamp so dedup can use stable identity
  const key = liveMsg.messageKey || '';
  const ts = liveMsg.timestamp || new Date().toISOString();
  const prov = liveMsg.provider || 'pi';

  if (liveMsg.isThinking) {
    const text = typeof liveMsg.content === 'string' ? liveMsg.content : '';
    return { type: 'thinking', timestamp: ts, provider: prov, messageKey: key, turnAnchorKey: liveMsg.turnAnchorKey || '', message: { role: 'assistant', content: text } };
  }

  if (liveMsg.isToolUse) {
    return {
      type: 'tool_use',
      timestamp: ts,
      provider: prov,
      messageKey: key,
      turnAnchorKey: liveMsg.turnAnchorKey || '',
      toolName: liveMsg.toolName || '',
      toolInput: liveMsg.toolInput !== undefined ? liveMsg.toolInput : {},
      toolCallId: liveMsg.toolCallId || liveMsg.toolId || key || '',
    };
  }

  if (liveMsg.type === 'user') {
    const text = typeof liveMsg.content === 'string' ? liveMsg.content : '';
    return {
      type: 'message',
      timestamp: ts,
      provider: prov,
      messageKey: key,
      clientRequestId: liveMsg.clientRequestId || '',
      turnAnchorKey: liveMsg.turnAnchorKey || '',
      message: { role: 'user', content: text },
    };
  }

  if (liveMsg.type === 'tool_result' || (liveMsg.toolResult && liveMsg.toolCallId)) {
    return {
      type: 'tool_result',
      timestamp: ts,
      provider: prov,
      messageKey: key,
      turnAnchorKey: liveMsg.turnAnchorKey || '',
      toolCallId: liveMsg.toolCallId || liveMsg.toolId || '',
      toolName: liveMsg.toolName || '',
      output: liveMsg.toolResult || liveMsg.content || '',
    };
  }

  // Default: assistant text message
  const text = typeof liveMsg.content === 'string' ? liveMsg.content : (liveMsg.content ? String(liveMsg.content) : '');
  return { type: 'assistant', timestamp: ts, provider: prov, messageKey: key, turnAnchorKey: liveMsg.turnAnchorKey || '', message: { role: 'assistant', content: text } };
}

export function mergeHistoryWithActiveTurnOverlay(historyMessages: MessageRecord[], activeTurnOverlay: any): MessageRecord[] {
  /**
   * Compose durable history with the backend active-turn overlay snapshot.
   */
  const liveMessages = activeTurnOverlay && Array.isArray(activeTurnOverlay.liveMessages)
    ? activeTurnOverlay.liveMessages
    : [];
  if (liveMessages.length === 0) {
    return historyMessages;
  }
  const composed = mergeAndDedupMessagesWithCoverage(historyMessages, liveMessages);
  if (activeTurnOverlay?.status === 'completing' && composed.uncoveredCount === 0) {
    clearActiveTurnOverlay(
      activeTurnOverlay.provider || '',
      activeTurnOverlay.sessionId || '',
      activeTurnOverlay.projectPath || '',
    );
  }
  return composed.messages;
}

/**
 * Build a stable dedup fingerprint that works for both JSONL raw messages
 * (content nested under `message.content`) and live snapshot messages
 * (top-level `content`).  messageKey is the strongest identity signal;
 * fall back to a content-based hash when messageKey is missing.
 */
export function makeMessageFingerprint(msg: MessageRecord): string {
  const type = msg.type || '';
  const msgKey = typeof msg.messageKey === 'string' && msg.messageKey ? msg.messageKey : '';
  const contentText =
    (typeof msg.message?.content === 'string' && msg.message.content) ||
    (typeof msg.content === 'string' && msg.content) ||
    '';
  const toolName = msg.toolName || '';
  const toolCallId = String(msg.toolCallId ?? msg.toolId ?? '');
  const toolInput = msg.toolInput !== undefined ? JSON.stringify(msg.toolInput).slice(0, 200) : '';
  const output = typeof msg.output === 'string' ? msg.output.slice(0, 200) : '';

  // messageKey is the strongest signal — if two messages share a messageKey
  // they are the same logical event regardless of content.
  if (msgKey) {
    return `key:${msgKey}`;
  }
  return `${type}::${contentText.slice(0, 200)}::${toolName}::${toolCallId}::${toolInput}::${output}`;
}

function normalizeComparableText(value: unknown): string {
  /**
   * Normalize message/tool text for active overlay coverage checks.
   */
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { command?: unknown }).command === 'string') {
    return (value as { command: string }).command.replace(/\s+/g, ' ').trim();
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value).replace(/\s+/g, ' ').trim();
  }
}

function getRawMessageText(msg: MessageRecord): string {
  /**
   * Extract user/assistant/thinking text from raw session-message shapes.
   */
  const content = msg?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (
      typeof part === 'string'
        ? part
        : (typeof part?.text === 'string' ? part.text : '')
    )).join('');
  }
  return typeof msg?.content === 'string' ? msg.content : '';
}

function findOverlayCoverageIndex(liveMsg: MessageRecord, historyMessages: MessageRecord[]): number {
  /**
   * Return the durable history index that covers one active overlay row.
   */
  const liveType = liveMsg?.type || '';
  const liveText = normalizeComparableText(getRawMessageText(liveMsg));

  return historyMessages.findIndex((historyMsg) => {
    const historyType = historyMsg?.type || '';
    if (liveType === 'message') {
      const liveRole = liveMsg?.message?.role;
      const historyRole = historyMsg?.message?.role;
      return liveRole === historyRole
        && liveRole === 'user'
        && liveText
        && liveText === normalizeComparableText(getRawMessageText(historyMsg));
    }
    if (liveType === 'thinking') {
      return historyType === 'thinking'
        && liveText
        && liveText === normalizeComparableText(getRawMessageText(historyMsg));
    }
    if (liveType === 'tool_use') {
      if (historyType !== 'tool_use') return false;
      const liveToolId = normalizeComparableText(liveMsg.toolCallId || liveMsg.toolId);
      const historyToolId = normalizeComparableText(historyMsg.toolCallId || historyMsg.toolId);
      const sameToolId = Boolean(liveToolId && historyToolId && liveToolId === historyToolId);
      const sameToolPayload = normalizeComparableText(liveMsg.toolName) === normalizeComparableText(historyMsg.toolName)
        && normalizeComparableText(liveMsg.toolInput) === normalizeComparableText(historyMsg.toolInput);
      return sameToolId || sameToolPayload;
    }
    if (liveType === 'tool_result') {
      return historyType === 'tool_result'
        && normalizeComparableText(liveMsg.toolCallId || liveMsg.toolId) === normalizeComparableText(historyMsg.toolCallId || historyMsg.toolId);
    }
    if (liveType === 'assistant') {
      const historyRole = historyMsg?.message?.role;
      return (historyType === 'assistant' || (historyType === 'message' && historyRole === 'assistant'))
        && liveText
        && liveText === normalizeComparableText(getRawMessageText(historyMsg));
    }
    return false;
  });
}

function getTurnAnchorCandidateKeys(msg: MessageRecord): string[] {
  /**
   * Return stable keys that can be used as active overlay insertion anchors.
   */
  return [
    msg?.messageKey,
    msg?.clientRequestId,
    msg?.requestId,
  ].filter((value) => typeof value === 'string' && value);
}

function findTurnAnchorIndex(messages: MessageRecord[], turnAnchorKey: string): number {
  /**
   * Find the durable row that anchors an uncovered active overlay message.
   */
  if (!turnAnchorKey) {
    return -1;
  }
  return messages.findIndex((message) => getTurnAnchorCandidateKeys(message).includes(turnAnchorKey));
}

function isRawUserMessage(message: MessageRecord): boolean {
  /**
   * Check raw JSONL/live-normalized user rows across provider shapes.
   */
  return message?.type === 'user'
    || (message?.type === 'message' && message?.message?.role === 'user');
}

function getAnchoredTurnInsertIndex(messages: MessageRecord[], anchorIndex: number): number {
  /**
   * Insert after the full anchored turn so a follow-up does not split the
   * prior user row from its assistant/tool rows.
   */
  let insertIndex = anchorIndex + 1;
  while (insertIndex < messages.length && !isRawUserMessage(messages[insertIndex])) {
    insertIndex += 1;
  }
  return insertIndex;
}

/**
 * Merge JSONL history with live snapshot, deduplicating by stable fingerprint.
 * JSONL messages represent completed turns; live snapshot represents the current
 * running turn.  Messages are normalized to the JSONL wire shape before returning
 * so the frontend `convertSessionMessages()` transformer can process them uniformly.
 */
export function mergeAndDedupMessages(jsonlMessages: MessageRecord[], liveMessages: MessageRecord[]): MessageRecord[] {
  return mergeAndDedupMessagesWithCoverage(jsonlMessages, liveMessages).messages;
}

export function mergeAndDedupMessagesWithCoverage(jsonlMessages: MessageRecord[], liveMessages: MessageRecord[]): { messages: MessageRecord[]; uncoveredCount: number; totalOverlayCount: number } {
  const seen = new Set<string>();
  const result: MessageRecord[] = [];

  const normalizedLive = liveMessages.map(normalizeLiveMessageToJsonlShape);
  let uncoveredCount = 0;

  // JSONL first (stable history), then normalized live snapshot (current running turn)
  for (const msg of jsonlMessages) {
    const key = makeMessageFingerprint(msg);
    if (!key || !seen.has(key)) {
      if (key) seen.add(key);
      result.push(msg);
    }
  }

  let overlayInsertIndex = -1;
  for (const msg of normalizedLive) {
    const coveredIndex = findOverlayCoverageIndex(msg, result);
    if (coveredIndex >= 0) {
      overlayInsertIndex = Math.max(overlayInsertIndex, coveredIndex + 1);
      continue;
    }

    const key = makeMessageFingerprint(msg);
    if (!key || !seen.has(key)) {
      if (key) seen.add(key);
      uncoveredCount += 1;
      const anchorIndex = overlayInsertIndex < 0
        ? findTurnAnchorIndex(result, msg.turnAnchorKey)
        : -1;
      const insertIndex = overlayInsertIndex >= 0
        ? overlayInsertIndex
        : (anchorIndex >= 0 ? getAnchoredTurnInsertIndex(result, anchorIndex) : -1);
      if (insertIndex >= 0 && insertIndex <= result.length) {
        result.splice(insertIndex, 0, msg);
        overlayInsertIndex = insertIndex + 1;
      } else {
        result.push(msg);
      }
    }
  }

  return { messages: result, uncoveredCount, totalOverlayCount: normalizedLive.length };
}

function isCbwRouteSessionId(sessionId: unknown): boolean {
    return typeof sessionId === 'string' && CC_ROUTE_SESSION_PATTERN.test(sessionId.trim());
}

/**
 * Handle GET /api/projects/:projectName/sessions/:sessionId/messages
 *
 * Resolves the provider from the query string (or guesses from session indexes),
 * then reads messages from native provider stores (Codex JSONL, Pi JSONL).
 * cN route sessions read via their bound provider session id; no co conversation
 * fallback is used.
 */
export async function handleGetSessionMessages(req: SessionMessagesRequest, res: SessionMessagesResponse) {
    try {
        const { projectName, sessionId } = req.params;
        const { limit, offset, provider, afterLine, afterCursor, projectPath: queryProjectPath } = req.query;

        // Parse limit and offset if provided
        const parsedLimit = limit ? parseInt(limit, 10) : null;
        const parsedOffset = offset ? parseInt(offset, 10) : 0;
        const parsedAfterLine = afterLine != null ? parseInt(afterLine, 10) : null;

        let resolvedProvider: ProviderName | null = provider === 'codex' ? 'codex' : provider === 'pi' ? 'pi' : null;
        let projectPath = '';
        const readCodexMessages = getCodexSessionMessages as SessionMessageReader;
        const readPiMessages = getPiSessionMessages as SessionMessageReader;

        if (isCbwRouteSessionId(sessionId)) {
            // cN route sessions no longer read from co conversation data.
            // They rely exclusively on the native provider session bound via
            // the manual session route runtime. If no provider session has been
            // bound yet, return empty messages.
            projectPath = typeof queryProjectPath === 'string' && queryProjectPath.trim()
                ? queryProjectPath.trim()
                : await extractProjectDirectory(projectName);
            const runtimeContext = await getManualSessionRouteRuntime(
                projectName,
                projectPath,
                sessionId,
            );

            const cNProvider: ProviderName = runtimeContext?.provider === 'pi'
                ? 'pi'
                : runtimeContext?.provider === 'codex'
                    ? 'codex'
                    : (resolvedProvider || 'codex');

            // Running provider sessions: merge JSONL history with the live
            // transcript snapshot so completed turns (from disk) and the
            // current running turn (from snapshot) are both visible after a
            // page refresh or follow-latest refresh.
            const liveSnapshot = getNativeSessionLiveTranscript(cNProvider, sessionId, projectPath);
            if (liveSnapshot !== null && liveSnapshot.length > 0) {
                const providerSessionIdForMerge = runtimeContext?.providerSessionId || '';
                if (providerSessionIdForMerge) {
                    try {
                        const jsonlResult = cNProvider === 'codex'
                            ? await readCodexMessages(providerSessionIdForMerge, parsedLimit, parsedOffset, parsedAfterLine)
                            : await readPiMessages(providerSessionIdForMerge, parsedLimit, parsedOffset, parsedAfterLine);
                        const jsonlMessages = (jsonlResult && typeof jsonlResult === 'object') ? (jsonlResult.messages || []) : [];
                        if (jsonlMessages.length > 0) {
                            if (cNProvider === 'pi') {
                                clearPiSessionSnapshot(sessionId, projectPath);
                            }
                            const runtimeMerged = mergeAndDedupMessages(jsonlMessages, liveSnapshot);
                            const activeOverlay = getActiveTurnOverlay(cNProvider, sessionId, projectPath);
                            const merged = mergeHistoryWithActiveTurnOverlay(runtimeMerged, activeOverlay);
                            return res.json({ messages: merged, total: merged.length, hasMore: false, source: activeOverlay ? 'history+active-turn-overlay' : 'merged-jsonl+live' });
                        }
                    } catch {
                        // JSONL not available yet — fall back to live snapshot alone.
                    }
                }
                const activeOverlay = getActiveTurnOverlay(cNProvider, sessionId, projectPath);
                const liveMessages = activeOverlay
                    ? mergeHistoryWithActiveTurnOverlay(liveSnapshot.map(normalizeLiveMessageToJsonlShape), activeOverlay)
                    : liveSnapshot.map(normalizeLiveMessageToJsonlShape);
                return res.json({ messages: liveMessages, total: liveMessages.length, hasMore: false, source: activeOverlay ? 'history+active-turn-overlay' : 'live-snapshot' });
            }

            const providerSessionId = runtimeContext?.providerSessionId || '';
            if (!providerSessionId) {
                // For completed Pi sessions without a providerSessionId yet, try the
                // snapshot bridge — the JSONL may not be flushed before pi-complete.
                const snapshot = getPiSessionCompletedSnapshot(sessionId, projectPath);
                if (snapshot && snapshot.length > 0) {
                    return res.json({ messages: snapshot.map(normalizeLiveMessageToJsonlShape), total: snapshot.length, hasMore: false, source: 'live-snapshot-bridge' });
                }
                return res.json({ messages: [], total: 0, hasMore: false });
            }

            const nativeResult = cNProvider === 'codex'
                ? await readCodexMessages(providerSessionId, parsedLimit, parsedOffset, parsedAfterLine)
                : await readPiMessages(providerSessionId, parsedLimit, parsedOffset, parsedAfterLine);

            // After a successful JSONL read, clear the snapshot bridge so
            // subsequent requests always get the full JSONL history.
            if (cNProvider === 'pi' && nativeResult && typeof nativeResult === 'object') {
                const messages = nativeResult.messages;
                if (Array.isArray(messages) && messages.length > 0) {
                    clearPiSessionSnapshot(sessionId, projectPath);
                } else {
                    // JSONL is not yet ready — fall back to the snapshot bridge.
                    const snapshot = getPiSessionCompletedSnapshot(sessionId, projectPath);
                    if (snapshot && snapshot.length > 0) {
                        return res.json({ messages: snapshot.map(normalizeLiveMessageToJsonlShape), total: snapshot.length, hasMore: false, source: 'live-snapshot-bridge' });
                    }
                }
            }

            const activeOverlay = getActiveTurnOverlay(cNProvider, sessionId, projectPath);
            if (activeOverlay) {
                const nativeMessages = nativeResult && typeof nativeResult === 'object'
                    ? (Array.isArray(nativeResult.messages) ? nativeResult.messages : [])
                    : (Array.isArray(nativeResult) ? nativeResult : []);
                const merged = mergeHistoryWithActiveTurnOverlay(nativeMessages, activeOverlay);
                return res.json({ ...(nativeResult && typeof nativeResult === 'object' ? nativeResult : {}), messages: merged, total: merged.length, hasMore: false, source: 'history+active-turn-overlay' });
            }
            return res.json(nativeResult && typeof nativeResult === 'object' ? nativeResult : { messages: Array.isArray(nativeResult) ? nativeResult : [] });
        }

        if (!resolvedProvider) {
            try {
                projectPath = projectPath || await extractProjectDirectory(projectName);
                const codexSessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
                if (codexSessions.some((session) => session.id === sessionId)) {
                    resolvedProvider = 'codex';
                } else {
                    const piSessions = await getPiSessions(projectPath);
                    resolvedProvider = piSessions.some((session) => session.id === sessionId) ? 'pi' : 'codex';
                }
            } catch (providerDetectionError) {
                console.warn(
                    `Unable to detect provider for session ${sessionId} in project ${projectName}:`,
                    (providerDetectionError as { message?: string }).message,
                );
                resolvedProvider = 'codex';
            }
        }

        // Non-cN Codex sessions always read from native Codex JSONL.
        // Pi sessions now read from native Pi SDK session storage;
        // the co read model is no longer used for manual chat message retrieval.
        let result;
        if (resolvedProvider === 'codex') {
            result = await readCodexMessages(sessionId, parsedLimit, parsedOffset, parsedAfterLine);
        } else {
            result = await readPiMessages(sessionId, parsedLimit, parsedOffset, parsedAfterLine);
        }

        // Handle both old and new response formats
        if (Array.isArray(result)) {
            res.json({ messages: result });
        } else {
            res.json(result);
        }
    } catch (error) {
        res.status(500).json({ error: (error as { message?: string }).message });
    }
}
