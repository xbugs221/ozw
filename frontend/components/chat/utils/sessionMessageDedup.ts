/**
 * PURPOSE: Deduplicate raw session transcript rows by backend JSONL identity.
 */

export interface SessionMessage {
  type?: string;
  messageKey?: string;
  sessionId?: string;
  __lineNumber?: number;
  __provider?: string;
  content?: unknown;
  timestamp?: unknown;
  message?: {
    role?: string;
    content?: unknown;
  };
  [key: string]: unknown;
}

/**
 * Build the stable transcript identity used by pagination and refresh merges.
 */
export function getSessionMessageIdentity(message: SessionMessage | null | undefined): string | null {
  if (!message || typeof message !== 'object') {
    return null;
  }

  if (typeof message.messageKey === 'string' && message.messageKey) {
    return message.messageKey;
  }

  if (Number.isFinite(Number(message.__lineNumber))) {
    const provider = typeof message.__provider === 'string' ? message.__provider : 'session';
    const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
    return `${provider}:${sessionId}:line:${Number(message.__lineNumber)}`;
  }

  return null;
}

interface UserTurnParts {
  normalizedContent: string;
  timestamp: number;
}

interface AssistantTextParts {
  content: string;
  normalizedContent: string;
  timestamp: number | null;
}

const MIN_ASSISTANT_OVERLAY_COVERAGE_LENGTH = 12;
const MAX_ASSISTANT_OVERLAY_COVERAGE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Extract normalized user turn parts for duplicate detection.
 */
function getUserTurnParts(message: SessionMessage): UserTurnParts | null {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const isUserMessage = message.type === 'user' || (message.message as Record<string, unknown> | undefined)?.role === 'user';
  if (!isUserMessage) {
    return null;
  }

  let rawContent: unknown = message.content;
  if (typeof (message.message as Record<string, unknown> | undefined)?.content === 'string') {
    rawContent = (message.message as Record<string, unknown>)?.content;
  } else if (Array.isArray((message.message as Record<string, unknown> | undefined)?.content)) {
    rawContent = ((message.message as Record<string, unknown>)?.content as Array<Record<string, unknown>>)
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
  }

  if (typeof rawContent !== 'string') {
    return null;
  }

  const normalizedContent = rawContent.replace(/\s+/g, ' ').trim();
  if (!normalizedContent) {
    return null;
  }

  const timestamp = new Date(message.timestamp as string | number | Date).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return { normalizedContent, timestamp };
}

/**
 * Build a same-turn user key for Codex records that echo one prompt twice.
 */
function getUserTurnKey(message: SessionMessage): string | null {
  const userTurn = getUserTurnParts(message);
  if (!userTurn) {
    return null;
  }
  return `${userTurn.timestamp}:${userTurn.normalizedContent}`;
}

/**
 * Read plain assistant text from raw provider transcript rows.
 */
function getAssistantTextParts(message: SessionMessage): AssistantTextParts | null {
  /**
   * PURPOSE: `afterLine` refreshes can return active overlay assistant rows
   * whose provider key differs from the already loaded JSONL line key.
   */
  const isAssistantMessage = message.type === 'assistant'
    || (message.type === 'message' && message.message?.role === 'assistant');
  if (!isAssistantMessage) {
    return null;
  }

  let rawContent: unknown = message.content;
  if (typeof message.message?.content === 'string') {
    rawContent = message.message.content;
  } else if (Array.isArray(message.message?.content)) {
    rawContent = message.message.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
          return (part as Record<string, unknown>).text as string;
        }
        return '';
      })
      .join('\n');
  }

  if (typeof rawContent !== 'string') {
    return null;
  }
  const normalizedContent = rawContent.replace(/\s+/g, ' ').trim();
  if (normalizedContent.length < MIN_ASSISTANT_OVERLAY_COVERAGE_LENGTH) {
    return null;
  }

  const timestamp = new Date(message.timestamp as string | number | Date).getTime();
  return {
    content: rawContent,
    normalizedContent,
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
  };
}

/**
 * Determine whether a raw message key came from an authoritative JSONL line.
 */
function isProviderLineIdentity(message: SessionMessage): boolean {
  /**
   * PURPOSE: Only cross-dedupe live overlay keys against line keys; two line
   * keys with the same text can still be legitimate repeated assistant turns.
   */
  return typeof message.messageKey === 'string' && /(?:^|:)line:\d+(?::|$)/.test(message.messageKey);
}

/**
 * Check whether two raw assistant rows are near enough to be one overlay echo.
 */
function isAssistantOverlayCoverageCandidate(existingMessage: SessionMessage, incomingMessage: SessionMessage): boolean {
  /**
   * PURPOSE: Bound text-based cross-key coverage to the live overlay case.
   */
  if (isProviderLineIdentity(existingMessage) === isProviderLineIdentity(incomingMessage)) {
    return false;
  }

  const existingParts = getAssistantTextParts(existingMessage);
  const incomingParts = getAssistantTextParts(incomingMessage);
  if (!existingParts || !incomingParts) {
    return false;
  }
  if (existingParts.timestamp !== null && incomingParts.timestamp !== null) {
    return Math.abs(existingParts.timestamp - incomingParts.timestamp) <= MAX_ASSISTANT_OVERLAY_COVERAGE_WINDOW_MS;
  }
  return true;
}

/**
 * Merge newer live text into an existing line row while preserving its cursor.
 */
function mergeAssistantContentIntoLineMessage(lineMessage: SessionMessage, contentSource: SessionMessage): SessionMessage {
  /**
   * PURPOSE: Keep the loaded JSONL line identity for future afterLine cursors
   * while showing the active overlay's longer in-progress text.
   */
  const sourceParts = getAssistantTextParts(contentSource);
  if (!sourceParts?.content) {
    return lineMessage;
  }
  return {
    ...lineMessage,
    timestamp: contentSource.timestamp ?? lineMessage.timestamp,
    message: {
      ...(lineMessage.message || {}),
      role: 'assistant',
      content: sourceParts.content,
    },
  };
}

/**
 * Find the latest raw user row that bounds the active assistant turn.
 */
function findLatestRawUserIndex(messages: SessionMessage[]): number {
  /**
   * PURPOSE: Text-based live/history coverage should not cross into older
   * turns that happened to contain the same assistant sentence.
   */
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === 'user' || message?.message?.role === 'user') {
      return index;
    }
  }
  return -1;
}

/**
 * Find an existing assistant row covered by an incoming line/live counterpart.
 */
function findAssistantOverlayCoverage(existingRows: SessionMessage[], incomingMessage: SessionMessage): {
  index: number;
  action: 'skip-incoming' | 'replace-existing' | 'merge-into-line';
} | null {
  /**
   * PURPOSE: Incremental cN refreshes combine newly persisted JSONL rows with a
   * full active overlay; this prevents cross-response duplicates.
   */
  const incomingParts = getAssistantTextParts(incomingMessage);
  if (!incomingParts) {
    return null;
  }

  const lowerBound = findLatestRawUserIndex(existingRows);
  for (let index = existingRows.length - 1; index > lowerBound; index -= 1) {
    const existingMessage = existingRows[index];
    if (!isAssistantOverlayCoverageCandidate(existingMessage, incomingMessage)) {
      continue;
    }
    const existingParts = getAssistantTextParts(existingMessage);
    if (!existingParts) {
      continue;
    }

    const existingText = existingParts.normalizedContent;
    const incomingText = incomingParts.normalizedContent;
    const existingIsLine = isProviderLineIdentity(existingMessage);
    const incomingIsLine = isProviderLineIdentity(incomingMessage);

    if (existingText === incomingText || existingText.startsWith(incomingText) || existingText.includes(incomingText)) {
      return {
        index,
        action: incomingIsLine && !existingIsLine ? 'replace-existing' : 'skip-incoming',
      };
    }

    if (incomingText.startsWith(existingText)) {
      return {
        index,
        action: existingIsLine && !incomingIsLine ? 'merge-into-line' : 'replace-existing',
      };
    }
  }

  return null;
}

/**
 * Detect Codex duplicate prompt echoes whose JSONL timestamps differ slightly.
 */
function isRecentDuplicateUserTurn(userTurn: UserTurnParts | null, recentUserTurnTimestamps: Map<string, number>): boolean {
  if (!userTurn) {
    return false;
  }

  const recentTimestamp = recentUserTurnTimestamps.get(userTurn.normalizedContent) ?? 0;
  return Number.isFinite(recentTimestamp)
    && Math.abs(userTurn.timestamp - recentTimestamp) <= 1000;
}

/**
 * Remember the latest timestamp for a normalized user turn text.
 */
function rememberUserTurn(userTurn: UserTurnParts | null, recentUserTurnTimestamps: Map<string, number>): void {
  if (userTurn) {
    recentUserTurnTimestamps.set(userTurn.normalizedContent, userTurn.timestamp);
  }
}

/**
 * Remove repeated raw transcript rows before conversion into UI messages.
 */
export function dedupeSessionMessagesByIdentity(messages: SessionMessage[]): SessionMessage[] {
  const seen = new Set<string>();
  const seenUserTurns = new Set<string>();
  const recentUserTurnTimestamps = new Map<string, number>();
  const dedupedMessages: SessionMessage[] = [];

  (Array.isArray(messages) ? messages : []).forEach((message) => {
    const identity = getSessionMessageIdentity(message);
    const userTurn = getUserTurnParts(message);
    const userTurnKey = getUserTurnKey(message);
    if (identity) {
      if (seen.has(identity)) {
        return;
      }
      seen.add(identity);
    }
    if (userTurnKey) {
      if (seenUserTurns.has(userTurnKey)) {
        return;
      }
      seenUserTurns.add(userTurnKey);
    }
    if (isRecentDuplicateUserTurn(userTurn, recentUserTurnTimestamps)) {
      return;
    }
    rememberUserTurn(userTurn, recentUserTurnTimestamps);

    dedupedMessages.push(message);
  });

  return dedupedMessages;
}

/**
 * Keep only incoming raw transcript rows that are not already loaded.
 */
export function getUniqueIncomingSessionMessages(
  existingMessages: SessionMessage[],
  incomingMessages: SessionMessage[],
): SessionMessage[] {
  const existingRows = Array.isArray(existingMessages) ? existingMessages : [];
  const existingIdentities = new Set(existingRows.map(getSessionMessageIdentity).filter(Boolean) as string[]);
  const existingUserTurns = new Set(existingRows.map(getUserTurnKey).filter(Boolean) as string[]);
  const recentUserTurnTimestamps = new Map<string, number>();
  existingRows.map(getUserTurnParts).filter(Boolean).forEach((userTurn) => {
    if (userTurn) rememberUserTurn(userTurn, recentUserTurnTimestamps);
  });

  return (Array.isArray(incomingMessages) ? incomingMessages : []).filter((message) => {
    const identity = getSessionMessageIdentity(message);
    const userTurn = getUserTurnParts(message);
    const userTurnKey = getUserTurnKey(message);
    if (
      (identity && existingIdentities.has(identity))
      || (userTurnKey && existingUserTurns.has(userTurnKey))
      || isRecentDuplicateUserTurn(userTurn, recentUserTurnTimestamps)
    ) {
      return false;
    }
    if (identity) existingIdentities.add(identity);
    if (userTurnKey) existingUserTurns.add(userTurnKey);
    rememberUserTurn(userTurn, recentUserTurnTimestamps);
    return true;
  });
}

/**
 * Merge cursor refresh rows while keeping replacements at their original
 * transcript position and appending only genuinely new identities.
 */
export function mergeSessionMessagesByIdentityPreservingOrder(
  existingMessages: SessionMessage[],
  incomingMessages: SessionMessage[],
): SessionMessage[] {
  const existingRows = Array.isArray(existingMessages) ? existingMessages : [];
  const incomingRows = Array.isArray(incomingMessages) ? incomingMessages : [];
  if (incomingRows.length === 0) {
    return existingRows;
  }

  const firstIncomingByIdentity = new Map<string, SessionMessage>();
  for (const message of incomingRows) {
    const identity = getSessionMessageIdentity(message);
    if (identity && !firstIncomingByIdentity.has(identity)) {
      firstIncomingByIdentity.set(identity, message);
    }
  }

  const replacedIdentities = new Set<string>();
  const existingIdentities = new Set<string>();
  const mergedRows = existingRows.map((message) => {
    const identity = getSessionMessageIdentity(message);
    if (identity) {
      existingIdentities.add(identity);
      const replacement = firstIncomingByIdentity.get(identity);
      if (replacement) {
        replacedIdentities.add(identity);
        return replacement;
      }
    }
    return message;
  });

  for (const message of incomingRows) {
    const identity = getSessionMessageIdentity(message);
    if (identity && (existingIdentities.has(identity) || replacedIdentities.has(identity))) {
      continue;
    }
    const coverage = findAssistantOverlayCoverage(mergedRows, message);
    if (coverage) {
      if (coverage.action === 'replace-existing') {
        mergedRows[coverage.index] = message;
      } else if (coverage.action === 'merge-into-line') {
        mergedRows[coverage.index] = mergeAssistantContentIntoLineMessage(mergedRows[coverage.index], message);
      }
      continue;
    }
    mergedRows.push(message);
  }

  return dedupeSessionMessagesByIdentity(mergedRows);
}
