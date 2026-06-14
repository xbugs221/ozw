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
    mergedRows.push(message);
  }

  return dedupeSessionMessagesByIdentity(mergedRows);
}
