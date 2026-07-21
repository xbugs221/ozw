/**
 * PURPOSE: Typed provider transcript reader for Codex, Pi, and Claude JSONL session
 * headers and message payloads.
 */
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';

import { normalizeCodexFunctionCall } from '../../../shared/codex-message-normalizer.js';
import { normalizeProjectPath, type LooseRecord } from './project-config-read-model.js';

type JsonlCursor = {
  lineCount: number;
  byteSize: number;
};

type JsonlReadResult = {
  records: Array<{ record: LooseRecord; lineNumber: number }>;
  totalLines: number;
};

type CodexRecordContext = {
  goalCompletionTurnIds: Set<string>;
};

const jsonlCursorCache = new Map<string, JsonlCursor>();
const claudeSessionFileCache = new Map<string, string>();
const CLAUDE_HISTORY_READ_CHUNK_BYTES = 64 * 1024;
const CLAUDE_HISTORY_MAX_READ_BYTES = 256 * 1024;
const CLAUDE_HISTORY_MAX_ROW_BYTES = 192 * 1024;
const CLAUDE_HISTORY_MAX_TEXT_BYTES = 64 * 1024;
const CLAUDE_HISTORY_CURSOR_PART_BASE = 1_000_000;
const CLAUDE_HISTORY_OVERSIZED_STATE_BASE = 500_000;
const CLAUDE_HISTORY_DEFAULT_LIMIT = 50;
const CLAUDE_HISTORY_MAX_LIMIT = 500;
let lastClaudeHistoryReadStats = {
  filePath: '',
  bytesRead: 0,
  parsedLines: 0,
  reachedStart: false,
  usedIndexedPath: false,
};

/**
 * Derive the stable Codex session id used by project routes from transcript path.
 */
function deriveCodexThreadFromJsonlPath(filePath = ''): { thread: string; sessionFileName: string } {
  const sessionFileName = path.basename(String(filePath || ''));
  const rolloutMatch = sessionFileName.match(
    /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/,
  );
  const fallbackThread = sessionFileName.endsWith('.jsonl')
    ? sessionFileName.slice(0, -'.jsonl'.length)
    : sessionFileName;
  return {
    thread: rolloutMatch?.[1] || fallbackThread,
    sessionFileName,
  };
}

/**
 * Read the first JSONL record used to derive provider session headers.
 */
export async function readJsonlFirstRecord(filePath = ''): Promise<LooseRecord | null> {
  for await (const record of readJsonlRecords(filePath)) {
    return record;
  }
  return null;
}

/**
 * Parse Codex transcript metadata into the normalized session header shape.
 */
export async function parseCodexSessionHeader(filePath = ''): Promise<LooseRecord | null> {
  let firstTimestamp = '';
  let lastTimestamp = '';
  let cwd = '';
  let model = '';
  let messageCount = 0;
  let firstUserMessage = '';
  let sourceSessionId = '';
  let origin = '';
  let hasSessionMeta = false;
  for await (const record of readJsonlRecords(filePath)) {
    if (typeof record.timestamp === 'string') {
      firstTimestamp ||= record.timestamp;
      lastTimestamp = record.timestamp;
    }
    if (record.type === 'session_meta' && record.payload) {
      hasSessionMeta = true;
      cwd = String(record.payload.cwd || cwd || '');
      model = String(record.payload.model || record.payload.model_provider || model || '');
      const subagentParentThreadId = getCodexSubagentParentThreadId(record.payload);
      sourceSessionId ||= subagentParentThreadId || String(record.payload.id || '');
      if (subagentParentThreadId) {
        origin = 'workflow';
      }
    }
    if (!cwd && typeof record.cwd === 'string') {
      cwd = record.cwd;
    }
    if (record.type === 'event_msg' && record.payload?.type === 'user_message') {
      const content = cleanCodexUserContent(stringifyMessageContent(record.payload.message));
      if (content && !isCodexInternalUserContent(content)) {
        messageCount += 1;
        firstUserMessage ||= content;
      }
    }
    if (record.type === 'response_item' && record.payload?.type === 'message') {
      messageCount += 1;
    }
  }
  if (!cwd) {
    return null;
  }
  const { thread, sessionFileName } = deriveCodexThreadFromJsonlPath(filePath);
  const firstUserTitle = firstUserMessage ? summarizeText(firstUserMessage) : '';
  const firstUserRouteTitle = firstUserMessage ? summarizeText(firstUserMessage, 20, false) : '';
  const fallbackTitle = firstUserTitle || 'Codex Session';
  const stat = await fs.stat(filePath).catch(() => null);
  return {
    id: thread,
    provider: 'codex',
    cwd,
    projectPath: cwd,
    model,
    createdAt: firstTimestamp || lastTimestamp || new Date().toISOString(),
    lastActivity: lastTimestamp || firstTimestamp || new Date().toISOString(),
    updated_at: lastTimestamp || firstTimestamp || new Date().toISOString(),
    summary: hasSessionMeta ? 'Codex Session' : fallbackTitle,
    title: fallbackTitle,
    routeTitle: firstUserRouteTitle || fallbackTitle,
    messageCount,
    messageCountKnown: true,
    filePath,
    fileMtimeMs: stat?.mtimeMs || 0,
    sessionFileName,
    sourceSessionId,
    origin: origin || undefined,
    thread,
  };
}

/**
 * Read the authoritative parent id from a Codex subagent session source.
 */
function getCodexSubagentParentThreadId(payload: LooseRecord): string {
  /**
   * PURPOSE: Provider child threads are internal sessions even when oz flow
   * state has not enumerated them, so classification must not depend on titles.
   */
  const threadSpawn = payload?.source?.subagent?.thread_spawn;
  const isSubagent = payload?.thread_source === 'subagent'
    || (threadSpawn && typeof threadSpawn === 'object');
  if (!isSubagent) {
    return '';
  }
  return String(
    threadSpawn?.parent_thread_id
    || payload?.parent_thread_id
    || payload?.forked_from_id
    || '',
  ).trim();
}

/**
 * Parse Pi transcript metadata into the normalized session header shape.
 */
export async function parsePiSessionHeader(filePath = ''): Promise<LooseRecord | null> {
  let firstRecord: LooseRecord | null = null;
  let lastTimestamp = '';
  let messageCount = 0;
  let firstUserMessage = '';
  for await (const record of readJsonlRecords(filePath)) {
    firstRecord ||= record;
    if (typeof record.timestamp === 'string') {
      lastTimestamp = record.timestamp;
    }
    if (record.type === 'message') {
      messageCount += 1;
      if (!firstUserMessage && record.message?.role === 'user') {
        firstUserMessage = stringifyMessageContent(record.message?.content);
      }
    }
  }
  if (!firstRecord || firstRecord.type !== 'session' || messageCount <= 0) {
    return null;
  }
  const cwd = String(firstRecord.cwd || '').trim();
  if (!cwd) {
    return null;
  }
  const sessionFileName = path.basename(filePath);
  const id = String(firstRecord.id || sessionFileName.replace(/\.jsonl$/, ''));
  const timestamp = String(firstRecord.timestamp || lastTimestamp || new Date().toISOString());
  const activityTimestamp = lastTimestamp || timestamp;
  const stat = await fs.stat(filePath).catch(() => null);
  return {
    id,
    provider: 'pi',
    cwd,
    projectPath: cwd,
    createdAt: timestamp,
    lastActivity: activityTimestamp,
    updated_at: activityTimestamp,
    summary: firstRecord.title || (firstUserMessage ? summarizeText(firstUserMessage, 20, false) : 'Pi Session'),
    title: firstRecord.title || (firstUserMessage ? summarizeText(firstUserMessage, 20, false) : 'Pi Session'),
    messageCount,
    messageCountKnown: true,
    filePath,
    fileMtimeMs: stat?.mtimeMs || 0,
    sessionFileName,
  };
}

/** Parse the first usable Claude record for lightweight project discovery. */
export async function parseClaudeSessionHeader(filePath = ''): Promise<LooseRecord | null> {
  let first: LooseRecord | null = null;
  for await (const record of readJsonlRecords(filePath)) {
    if (record.cwd && record.sessionId) { first = record; break; }
  }
  if (!first) return null;
  const stat = await fs.stat(filePath).catch(() => null);
  const timestamp = String(first.timestamp || (stat ? new Date(stat.mtimeMs).toISOString() : new Date().toISOString()));
  const lastActivity = stat ? new Date(stat.mtimeMs).toISOString() : timestamp;
  const sessionId = String(first.sessionId);
  const firstContent = typeof first.message?.content === 'string' ? first.message.content : '';
  const title = firstContent.trim().slice(0, 80) || 'Claude Session';
  return { id: sessionId, provider: 'claude', __provider: 'claude', sourceSessionId: sessionId, cwd: String(first.cwd), projectPath: String(first.cwd), createdAt: timestamp, lastActivity, updated_at: lastActivity, summary: title, title, routeTitle: title, messageCount: null, messageCountKnown: false, filePath, fileMtimeMs: stat?.mtimeMs || 0, sessionFileName: path.basename(filePath) };
}


/**
 * Read Codex transcript messages with cursor and pagination semantics.
 */
export async function getCodexSessionMessages(
  sessionId: unknown = '',
  limit: unknown = null,
  offset: unknown = 0,
  afterLine: unknown = null,
): Promise<LooseRecord> {
  const filePath = await findCodexSessionFile(String(sessionId || ''));
  if (!filePath) {
    return { messages: [], total: 0, hasMore: false, offset: 0, limit, nextMessageOffset: 0, nextRawLineOffset: 0 };
  }
  const messages: LooseRecord[] = [];
  const userEchoKeys = new Set<string>();
  const transcript = await readJsonlRecordsForMessages(filePath, afterLine);
  const codexContext = buildCodexRecordContext(transcript.records);
  for (const { record, lineNumber } of transcript.records) {
    for (const message of codexRecordToMessages(record, String(sessionId), lineNumber, codexContext)) {
      if (message.type === 'user') {
        const content = String(message.message?.content || '').trim();
        if (content && userEchoKeys.has(content)) {
          continue;
        }
        if (content) {
          userEchoKeys.add(content);
        }
      }
      if (message.type === 'assistant' && collapseAdjacentCodexAssistantDuplicate(messages, message)) {
        continue;
      }
      messages.push(message);
    }
  }
  return paginateMessages(messages, limit, offset, transcript.totalLines);
}

/**
 * Read Pi transcript messages with cursor and pagination semantics.
 */
export async function getPiSessionMessages(
  sessionId: unknown = '',
  limit: unknown = null,
  offset: unknown = 0,
  afterLine: unknown = null,
): Promise<LooseRecord> {
  const filePath = await findPiSessionFile(String(sessionId || ''));
  if (!filePath) {
    return { messages: [], total: 0, hasMore: false, offset: 0, limit, nextMessageOffset: 0, nextRawLineOffset: 0 };
  }
  const messages: LooseRecord[] = [];
  const transcript = await readJsonlRecordsForMessages(filePath, afterLine);
  for (const { record, lineNumber } of transcript.records) {
    messages.push(...piRecordToMessages(record, String(sessionId), lineNumber));
  }
  return paginateMessages(messages, limit, offset, transcript.totalLines);
}

/** Read Claude history only for an explicit messages request. */
export async function getClaudeSessionMessages(
  sessionId: unknown = '',
  limit: unknown = null,
  offset: unknown = 0,
  afterLine: unknown = null,
  historySnapshotRawLineOffset: unknown = null,
  indexedFilePath: unknown = '',
  afterCursor: unknown = '',
): Promise<LooseRecord> {
  /** Freeze historical pages at a byte boundary so page reads can start at EOF. */
  const normalizedSessionId = String(sessionId || '');
  const normalizedIndexedPath = String(indexedFilePath || '');
  const filePath = await findClaudeSessionFile(normalizedSessionId, normalizedIndexedPath);
  if (!filePath) return { messages: [], total: 0, hasMore: false, offset: 0, limit, nextMessageOffset: 0, nextRawLineOffset: 0, historySnapshotRawLineOffset: 0 };
  const afterByte = normalizeAfterLine(afterLine);
  const decodedCursor = decodeClaudeAppendCursor(afterCursor);
  if (afterByte !== null || decodedCursor !== null) {
    const result = await readClaudeMessagesAfterCursor(
      filePath,
      normalizedSessionId,
      limit,
      decodedCursor || { byteOffset: afterByte || 0, partIndex: 0 },
    );
    lastClaudeHistoryReadStats = {
      filePath,
      bytesRead: result.bytesRead,
      parsedLines: result.parsedLines,
      reachedStart: false,
      usedIndexedPath: Boolean(normalizedIndexedPath && path.resolve(normalizedIndexedPath) === path.resolve(filePath)),
    };
    return result.page;
  }
  const stat = await fs.stat(filePath);
  const requestedSnapshotBoundary = Number(historySnapshotRawLineOffset);
  const hasSnapshotBoundary = historySnapshotRawLineOffset !== null
    && historySnapshotRawLineOffset !== undefined
    && historySnapshotRawLineOffset !== ''
    && Number.isSafeInteger(requestedSnapshotBoundary)
    && requestedSnapshotBoundary >= 0;
  const snapshotByteOffset = hasSnapshotBoundary ? Math.min(stat.size, requestedSnapshotBoundary) : stat.size;
  const result = await readClaudeHistoryWindow(filePath, normalizedSessionId, limit, offset, snapshotByteOffset);
  lastClaudeHistoryReadStats = {
    filePath,
    bytesRead: result.bytesRead,
    parsedLines: result.parsedLines,
    reachedStart: result.reachedStart,
    usedIndexedPath: Boolean(normalizedIndexedPath && path.resolve(normalizedIndexedPath) === path.resolve(filePath)),
  };
  return result.page;
}

/**
 * List all Codex transcript files under the current HOME.
 */
export async function listCodexSessionFiles(): Promise<string[]> {
  return listJsonlFiles(path.join(os.homedir(), '.codex', 'sessions'));
}

/**
 * List all Pi transcript files under the current HOME.
 */
export async function listPiSessionFiles(): Promise<string[]> {
  return listJsonlFiles(path.join(os.homedir(), '.pi', 'agent', 'sessions'));
}

/** List Claude project JSONL files for the background indexer. */
export async function listClaudeSessionFiles(): Promise<string[]> {
  return listJsonlFiles(path.join(os.homedir(), '.claude', 'projects'));
}

/**
 * Locate one Codex transcript by id or filename.
 */
export async function findCodexSessionFile(sessionId: string): Promise<string | null> {
  return findSessionFile(await listCodexSessionFiles(), sessionId);
}

/**
 * Locate one Pi transcript by id or filename.
 */
export async function findPiSessionFile(sessionId: string): Promise<string | null> {
  return findSessionFile(await listPiSessionFiles(), sessionId);
}

/** Find a Claude transcript by provider session id. */
export async function findClaudeSessionFile(sessionId: string, indexedFilePath = ''): Promise<string | null> {
  /** Only trust persistent-index/cache paths; request handling must never scan HOME. */
  const candidates = [indexedFilePath, claudeSessionFileCache.get(sessionId) || ''].filter(Boolean);
  for (const candidate of candidates) {
    const exists = await fs.stat(candidate).then((entry) => entry.isFile()).catch(() => false);
    if (exists) {
      claudeSessionFileCache.set(sessionId, candidate);
      return candidate;
    }
  }
  return null;
}

/** Bound visible Claude text while making omission explicit to the renderer. */
function truncateClaudeText(value: unknown): string {
  /** Slice by bytes so multi-byte text cannot bypass the response budget. */
  const text = String(value || '');
  const bytes = Buffer.from(text);
  if (bytes.length <= CLAUDE_HISTORY_MAX_TEXT_BYTES) return text;
  return `${bytes.subarray(0, CLAUDE_HISTORY_MAX_TEXT_BYTES).toString('utf8')}\n[内容过长，已截断]`;
}

/** Represent an oversized JSONL row without retaining or returning its payload. */
function createClaudeOversizedRowMessage(sessionId: string, byteOffset: number): LooseRecord {
  /** Keep the response useful and bounded when a provider emits a pathological row. */
  return {
    type: 'assistant', provider: 'claude', truncated: true,
    messageKey: `claude:${sessionId}:byte:${byteOffset}:oversized`,
    message: { role: 'assistant', content: '[单条 Claude 历史记录过大，内容已省略]' },
  };
}

type ClaudeOversizedReverseState = {
  depth: number;
  mode: number;
  stringMatch: number;
  expectsKey: number;
  pendingValue: number;
  recordType: number;
  sidechain: number;
};

type ClaudeOversizedForwardState = {
  depth: number;
  mode: number;
  stringMatch: number;
  phase: number;
  currentKey: number;
  recordType: number;
  sidechain: number;
};

const CLAUDE_STATE_STRING_INVALID = 17;
const CLAUDE_STATE_VALUE_NONE = 0;
const CLAUDE_STATE_VALUE_USER = 1;
const CLAUDE_STATE_VALUE_ASSISTANT = 2;
const CLAUDE_STATE_VALUE_TRUE = 3;
const CLAUDE_STATE_VALUE_OTHER = 4;
const CLAUDE_STATE_TYPE_UNSEEN = 0;
const CLAUDE_STATE_TYPE_USER = 1;
const CLAUDE_STATE_TYPE_ASSISTANT = 2;
const CLAUDE_STATE_TYPE_OTHER = 3;
const CLAUDE_STATE_SIDECHAIN_UNSEEN = 0;
const CLAUDE_STATE_SIDECHAIN_OTHER = 1;
const CLAUDE_STATE_SIDECHAIN_TRUE = 2;

/** Pack a bounded JSON classifier into the opaque cursor's row-part field. */
function packClaudeOversizedState(values: number[], radices: number[]): number {
  /** Mixed-radix storage keeps cross-request state below the numeric cursor budget. */
  let packed = 0;
  let multiplier = 1;
  for (let index = 0; index < values.length; index += 1) {
    packed += values[index] * multiplier;
    multiplier *= radices[index];
  }
  return CLAUDE_HISTORY_OVERSIZED_STATE_BASE + packed;
}

/** Restore mixed-radix classifier fields from an opaque row-part cursor. */
function unpackClaudeOversizedState(partIndex: number, radices: number[]): number[] {
  /** Invalid state is decoded conservatively by each directional classifier. */
  let packed = Math.max(0, partIndex - CLAUDE_HISTORY_OVERSIZED_STATE_BASE);
  return radices.map((radix) => {
    const value = packed % radix;
    packed = Math.floor(packed / radix);
    return value;
  });
}

/** Identify a row-part value reserved for an in-progress oversized classifier. */
function isClaudeOversizedStatePart(partIndex: number): boolean {
  /** Ordinary message-part indexes remain below the reserved half of the range. */
  return partIndex >= CLAUDE_HISTORY_OVERSIZED_STATE_BASE;
}

/** Advance an exact key or chat-role string matcher one ASCII byte. */
function advanceClaudeOversizedStringMatch(match: number, byte: number, key: boolean, reverse: boolean): number {
  /** Only type, isSidechain, user and assistant can affect placeholder visibility. */
  if (match === CLAUDE_STATE_STRING_INVALID) return match;
  const character = String.fromCharCode(byte);
  const targets = key
    ? (reverse ? ['epyt', 'niahcediSsi'] : ['type', 'isSidechain'])
    : (reverse ? ['tnatsissa', 'resu'] : ['assistant', 'user']);
  const firstLength = targets[0].length;
  let targetIndex = -1;
  let matchedLength = 0;
  if (match === 0) {
    targetIndex = targets.findIndex((target) => target[0] === character);
    matchedLength = 1;
  } else if (match <= firstLength) {
    targetIndex = 0;
    matchedLength = match + 1;
  } else {
    targetIndex = 1;
    matchedLength = match - firstLength + 1;
  }
  const target = targets[targetIndex];
  if (!target || matchedLength > target.length || target[matchedLength - 1] !== character) {
    return CLAUDE_STATE_STRING_INVALID;
  }
  return targetIndex === 0 ? matchedLength : firstLength + matchedLength;
}

/** Convert a completed exact string match into a key or visible record value. */
function classifyClaudeOversizedString(match: number, key: boolean): number {
  /** Exact completion prevents prefixes and escaped lookalikes from being accepted. */
  if (key) {
    if (match === 4) return 1;
    if (match === 15) return 2;
    return 0;
  }
  if (match === 9) return CLAUDE_STATE_VALUE_ASSISTANT;
  if (match === 13) return CLAUDE_STATE_VALUE_USER;
  return CLAUDE_STATE_VALUE_OTHER;
}

/** Encode the reverse top-level JSON classifier used by history pagination. */
function encodeClaudeOversizedReverseState(state: ClaudeOversizedReverseState): number {
  /** The largest valid packed state stays below the one-million row-part base. */
  return packClaudeOversizedState(
    [state.depth, state.mode, state.stringMatch, state.expectsKey, state.pendingValue, state.recordType, state.sidechain],
    [16, 10, 18, 2, 5, 4, 3],
  );
}

/** Decode a reverse classifier cursor into its bounded structural state. */
function decodeClaudeOversizedReverseState(partIndex: number): ClaudeOversizedReverseState {
  /** Each field has a fixed radix so chunk boundaries cannot erase JSON context. */
  const [depth, mode, stringMatch, expectsKey, pendingValue, recordType, sidechain] = unpackClaudeOversizedState(
    partIndex,
    [16, 10, 18, 2, 5, 4, 3],
  );
  return { depth, mode, stringMatch, expectsKey, pendingValue, recordType, sidechain };
}

/** Pair one reverse-scanned top-level key with its already scanned value. */
function applyClaudeOversizedReversePair(state: ClaudeOversizedReverseState, key: number): void {
  /** Reverse order sees the value before the key; duplicate JSON keys keep the last value. */
  if (key === 1 && state.recordType === CLAUDE_STATE_TYPE_UNSEEN) {
    state.recordType = state.pendingValue === CLAUDE_STATE_VALUE_USER
      ? CLAUDE_STATE_TYPE_USER
      : state.pendingValue === CLAUDE_STATE_VALUE_ASSISTANT
        ? CLAUDE_STATE_TYPE_ASSISTANT
        : CLAUDE_STATE_TYPE_OTHER;
  }
  if (key === 2 && state.sidechain === CLAUDE_STATE_SIDECHAIN_UNSEEN) {
    state.sidechain = state.pendingValue === CLAUDE_STATE_VALUE_TRUE
      ? CLAUDE_STATE_SIDECHAIN_TRUE
      : CLAUDE_STATE_SIDECHAIN_OTHER;
  }
  state.pendingValue = CLAUDE_STATE_VALUE_NONE;
  state.expectsKey = 0;
}

/** Reverse-scan a bounded row fragment while preserving top-level JSON structure. */
function scanClaudeOversizedReverse(state: ClaudeOversizedReverseState, fragment: Buffer): void {
  /** Strings and nesting are tracked across chunks so nested metadata cannot mimic top-level fields. */
  for (let index = fragment.length - 1; index >= 0; index -= 1) {
    const byte = fragment[index];
    let revisit = true;
    while (revisit) {
      revisit = false;
      if (state.mode >= 2 && state.mode <= 4) {
        if (byte === 0x5c) {
          state.stringMatch = CLAUDE_STATE_STRING_INVALID;
          state.mode = state.mode === 2 ? 3 : state.mode === 3 ? 4 : 3;
          continue;
        }
        if (state.mode === 3) {
          state.mode = 1;
          state.stringMatch = CLAUDE_STATE_STRING_INVALID;
          revisit = true;
          continue;
        }
        const key = state.expectsKey === 1;
        const classified = classifyClaudeOversizedString(state.stringMatch, key);
        if (state.depth === 1) {
          if (key) applyClaudeOversizedReversePair(state, classified);
          else state.pendingValue = classified;
        }
        state.mode = 0;
        state.stringMatch = 0;
        revisit = true;
        continue;
      }
      if (state.mode === 1) {
        if (byte === 0x22) state.mode = 2;
        else if (byte === 0x5c) state.stringMatch = CLAUDE_STATE_STRING_INVALID;
        else if (state.depth === 1) {
          state.stringMatch = advanceClaudeOversizedStringMatch(state.stringMatch, byte, state.expectsKey === 1, true);
        }
        continue;
      }
      if (state.mode >= 5) {
        const tokenByte = (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a)
          || (byte >= 0x61 && byte <= 0x7a) || byte === 0x2b || byte === 0x2d || byte === 0x2e;
        if (tokenByte) {
          const expected = state.mode === 5 ? 0x75 : state.mode === 6 ? 0x72 : state.mode === 7 ? 0x74 : -1;
          state.mode = byte === expected ? state.mode + 1 : 9;
          continue;
        }
        state.pendingValue = state.mode === 8 ? CLAUDE_STATE_VALUE_TRUE : CLAUDE_STATE_VALUE_OTHER;
        state.mode = 0;
        revisit = true;
        continue;
      }
      if (byte === 0x22) {
        state.mode = 1;
        state.stringMatch = 0;
      } else if (byte === 0x7d || byte === 0x5d) {
        if (state.depth >= 15) state.sidechain = CLAUDE_STATE_SIDECHAIN_TRUE;
        else state.depth += 1;
      } else if (byte === 0x7b || byte === 0x5b) {
        if (state.depth > 0) state.depth -= 1;
        if (state.depth === 1) state.pendingValue = CLAUDE_STATE_VALUE_OTHER;
      } else if (state.depth === 1 && byte === 0x3a && state.pendingValue !== CLAUDE_STATE_VALUE_NONE) {
        state.expectsKey = 1;
      } else if (state.depth === 1 && state.expectsKey === 0 && byte === 0x65) {
        state.mode = 5;
      }
    }
  }
}

/** Encode the forward top-level JSON classifier used by append pagination. */
function encodeClaudeOversizedForwardState(state: ClaudeOversizedForwardState): number {
  /** Forward and reverse cursors share the reserved range but are decoded only in their own API path. */
  return packClaudeOversizedState(
    [state.depth, state.mode, state.stringMatch, state.phase, state.currentKey, state.recordType, state.sidechain],
    [16, 8, 18, 4, 3, 4, 3],
  );
}

/** Decode a forward classifier cursor into its bounded structural state. */
function decodeClaudeOversizedForwardState(partIndex: number): ClaudeOversizedForwardState {
  /** Cursor-carried state makes field order and chunk alignment irrelevant. */
  const [depth, mode, stringMatch, phase, currentKey, recordType, sidechain] = unpackClaudeOversizedState(
    partIndex,
    [16, 8, 18, 4, 3, 4, 3],
  );
  return { depth, mode, stringMatch, phase, currentKey, recordType, sidechain };
}

/** Finalize a forward scalar before its delimiter is processed structurally. */
function finalizeClaudeOversizedForwardScalar(state: ClaudeOversizedForwardState): void {
  /** Only a complete top-level true assigned to isSidechain hides an otherwise visible row. */
  if (state.currentKey === 2) {
    state.sidechain = state.mode === 6 ? CLAUDE_STATE_SIDECHAIN_TRUE : CLAUDE_STATE_SIDECHAIN_OTHER;
  }
  if (state.currentKey === 1) {
    state.recordType = CLAUDE_STATE_TYPE_OTHER;
  }
  state.currentKey = 0;
  state.phase = 3;
  state.mode = 0;
}

/** Forward-scan a bounded row fragment while preserving top-level JSON structure. */
function scanClaudeOversizedForward(state: ClaudeOversizedForwardState, fragment: Buffer): void {
  /** The scanner retains only structural state and exact visibility fields, never oversized content. */
  for (let index = 0; index < fragment.length; index += 1) {
    const byte = fragment[index];
    let revisit = true;
    while (revisit) {
      revisit = false;
      if (state.mode === 1 || state.mode === 2) {
        if (state.mode === 2) {
          state.mode = 1;
          state.stringMatch = CLAUDE_STATE_STRING_INVALID;
        } else if (byte === 0x5c) {
          state.mode = 2;
          state.stringMatch = CLAUDE_STATE_STRING_INVALID;
        } else if (byte === 0x22) {
          if (state.depth === 1 && state.phase === 0) {
            state.currentKey = classifyClaudeOversizedString(state.stringMatch, true);
            state.phase = 1;
          } else if (state.depth === 1 && state.phase === 2) {
            if (state.currentKey === 1) {
              const value = classifyClaudeOversizedString(state.stringMatch, false);
              state.recordType = value === CLAUDE_STATE_VALUE_USER
                ? CLAUDE_STATE_TYPE_USER
                : value === CLAUDE_STATE_VALUE_ASSISTANT
                  ? CLAUDE_STATE_TYPE_ASSISTANT
                  : CLAUDE_STATE_TYPE_OTHER;
            }
            if (state.currentKey === 2) {
              state.sidechain = CLAUDE_STATE_SIDECHAIN_OTHER;
            }
            state.currentKey = 0;
            state.phase = 3;
          }
          state.mode = 0;
          state.stringMatch = 0;
        } else if (state.depth === 1 && (state.phase === 0 || (state.phase === 2 && state.currentKey === 1))) {
          state.stringMatch = advanceClaudeOversizedStringMatch(state.stringMatch, byte, state.phase === 0, false);
        }
        continue;
      }
      if (state.mode >= 3) {
        const tokenByte = (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a)
          || (byte >= 0x61 && byte <= 0x7a) || byte === 0x2b || byte === 0x2d || byte === 0x2e;
        if (tokenByte) {
          const expected = state.mode === 3 ? 0x72 : state.mode === 4 ? 0x75 : state.mode === 5 ? 0x65 : -1;
          state.mode = byte === expected ? state.mode + 1 : 7;
          continue;
        }
        finalizeClaudeOversizedForwardScalar(state);
        revisit = true;
        continue;
      }
      if (byte === 0x22) {
        state.mode = 1;
        state.stringMatch = 0;
      } else if (byte === 0x7b || byte === 0x5b) {
        if (state.depth >= 15) state.sidechain = CLAUDE_STATE_SIDECHAIN_TRUE;
        else state.depth += 1;
        if (state.depth === 1) state.phase = 0;
        else if (state.depth === 2 && state.phase === 2) {
          state.currentKey = 0;
          state.phase = 3;
        }
      } else if (byte === 0x7d || byte === 0x5d) {
        if (state.depth > 0) state.depth -= 1;
      } else if (state.depth === 1 && byte === 0x3a && state.phase === 1) {
        state.phase = 2;
      } else if (state.depth === 1 && byte === 0x2c && state.phase === 3) {
        state.phase = 0;
      } else if (state.depth === 1 && state.phase === 2 && byte === 0x74) {
        state.mode = 3;
      }
    }
  }
}

/** Decide visibility only after a complete oversized top-level object was scanned. */
function isClaudeOversizedStateVisible(state: { recordType: number; sidechain: number }): boolean {
  /** Incomplete JSON, unknown types and confirmed sidechains stay hidden by default. */
  const structural = state as { depth?: number; mode?: number };
  return structural.depth === 0 && structural.mode === 0
    && state.sidechain !== CLAUDE_STATE_SIDECHAIN_TRUE
    && (state.recordType === CLAUDE_STATE_TYPE_USER || state.recordType === CLAUDE_STATE_TYPE_ASSISTANT);
}

/** Normalize Claude user, assistant, thinking, tool and result blocks. */
function claudeRecordToMessages(record: LooseRecord, sessionId: string, lineNumber: number): LooseRecord[] {
  if (record.type === 'file-history-snapshot' || record.isSidechain) return [];
  const content = record.message?.content;
  const parts = Array.isArray(content) ? content : [{ type: 'text', text: content }];
  return (parts as any[]).flatMap((part: any, index: number): LooseRecord[] => {
    if (!part) return [];
    const type = part.type === 'thinking' ? 'thinking' : part.type === 'tool_use' ? 'tool_use' : part.type === 'tool_result' ? 'tool_result' : record.type === 'user' ? 'user' : 'assistant';
    const key = `claude:${sessionId}:line:${lineNumber}:${index}`;
    if (type === 'tool_use') return [{ type, provider: 'claude', timestamp: record.timestamp, messageKey: `${key}:tool`, toolName: part.name, toolInput: part.input, toolCallId: part.id }];
    if (type === 'tool_result') return [{ type, provider: 'claude', timestamp: record.timestamp, messageKey: `${key}:result`, toolCallId: part.tool_use_id, output: truncateClaudeText(stringifyMessageContent(part.content)) }];
    const text = truncateClaudeText(typeof part === 'string' ? part : String(part.text || part.thinking || (typeof content === 'string' ? content : '') || ''));
    return text ? [{ type, provider: 'claude', timestamp: record.timestamp, messageKey: `${key}:msg`, message: { role: type === 'thinking' ? 'assistant' : type, content: text } }] : [];
  });
}

/**
 * Read one Claude history page backwards from a stable file-size snapshot.
 */
async function readClaudeHistoryWindow(
  filePath: string,
  sessionId: string,
  limit: unknown,
  offset: unknown,
  snapshotByteOffset: number,
): Promise<{ page: LooseRecord; bytesRead: number; parsedLines: number; reachedStart: boolean }> {
  /** Decode an opaque monotonic token into a reverse byte boundary and row part. */
  const normalizedOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const requestedLimit = limit === null || limit === undefined
    ? CLAUDE_HISTORY_DEFAULT_LIMIT
    : Math.max(0, Math.floor(Number(limit) || 0));
  const normalizedLimit = Math.min(CLAUDE_HISTORY_MAX_LIMIT, requestedLimit);
  if (normalizedLimit === 0) {
    /** A zero-sized page is terminal and must never synthesize delayed placeholders. */
    return {
      page: {
        messages: [], total: 0, hasMore: false, offset: Math.max(0, Math.floor(Number(offset) || 0)), limit: 0,
        nextMessageOffset: Math.max(0, Math.floor(Number(offset) || 0)),
        nextRawLineOffset: snapshotByteOffset,
        historySnapshotRawLineOffset: snapshotByteOffset,
        appendCursor: encodeClaudeAppendCursor(snapshotByteOffset, 0),
      },
      bytesRead: 0,
      parsedLines: 0,
      reachedStart: true,
    };
  }
  const selectedNewestFirst: LooseRecord[] = [];
  let visibleSeen = 0;
  let parsedLines = 0;
  let bytesRead = 0;
  const decoded = decodeClaudeHistoryOffset(normalizedOffset, snapshotByteOffset);
  let cursor = decoded.byteOffset;
  let pendingPartSkip = decoded.partIndex;
  let nextBoundary = cursor;
  let nextPartIndex = pendingPartSkip;
  let carry = Buffer.alloc(0);
  let reachedStart = cursor === 0;
  let pageBoundaryLocked = false;
  let visibleAfterPageBoundary = 0;
  const handle = await fs.open(filePath, 'r');
  try {
    if (isClaudeOversizedStatePart(pendingPartSkip)) {
      /** Continue reverse structural classification until this physical row reaches its prefix. */
      const oversizedState = decodeClaudeOversizedReverseState(pendingPartSkip);
      while (cursor > 0 && bytesRead < CLAUDE_HISTORY_MAX_READ_BYTES) {
        const start = Math.max(0, cursor - CLAUDE_HISTORY_READ_CHUNK_BYTES);
        const chunk = Buffer.alloc(cursor - start);
        const { bytesRead: currentRead } = await handle.read(chunk, 0, chunk.length, start);
        bytesRead += currentRead;
        const previousNewline = chunk.subarray(0, currentRead).lastIndexOf(0x0a);
        if (previousNewline >= 0) {
          scanClaudeOversizedReverse(oversizedState, chunk.subarray(previousNewline + 1, currentRead));
          nextBoundary = start + previousNewline + 1;
          nextPartIndex = 0;
          pendingPartSkip = 0;
          cursor = nextBoundary;
          if (isClaudeOversizedStateVisible(oversizedState) && selectedNewestFirst.length < normalizedLimit) {
            selectedNewestFirst.push(createClaudeOversizedRowMessage(sessionId, nextBoundary));
            visibleSeen += 1;
            pageBoundaryLocked = selectedNewestFirst.length >= normalizedLimit;
          }
          break;
        }
        scanClaudeOversizedReverse(oversizedState, chunk.subarray(0, currentRead));
        if (start === 0) {
          nextBoundary = 0;
          nextPartIndex = 0;
          pendingPartSkip = 0;
          cursor = 0;
          if (isClaudeOversizedStateVisible(oversizedState) && selectedNewestFirst.length < normalizedLimit) {
            selectedNewestFirst.push(createClaudeOversizedRowMessage(sessionId, 0));
            visibleSeen += 1;
          }
          break;
        }
        cursor = start;
        nextBoundary = start;
        nextPartIndex = encodeClaudeOversizedReverseState(oversizedState);
      }
      reachedStart = nextBoundary === 0;
    }
    while (!pageBoundaryLocked && cursor > 0 && bytesRead < CLAUDE_HISTORY_MAX_READ_BYTES) {
      if (isClaudeOversizedStatePart(nextPartIndex)) break;
      const start = Math.max(0, cursor - CLAUDE_HISTORY_READ_CHUNK_BYTES);
      const chunk = Buffer.alloc(cursor - start);
      const { bytesRead: currentRead } = await handle.read(chunk, 0, chunk.length, start);
      bytesRead += currentRead;
      const data = Buffer.concat([chunk.subarray(0, currentRead), carry]);
      if (data.length >= CLAUDE_HISTORY_MAX_ROW_BYTES && (data.indexOf(0x0a) < 0 || data.indexOf(0x0a) >= CLAUDE_HISTORY_MAX_ROW_BYTES)) {
        /** Begin a cursor-carried reverse classifier before skipping the remaining physical row. */
        const oversizedState: ClaudeOversizedReverseState = {
          depth: 0, mode: 0, stringMatch: 0, expectsKey: 0, pendingValue: 0, recordType: 0, sidechain: 0,
        };
        scanClaudeOversizedReverse(oversizedState, data);
        nextBoundary = start;
        nextPartIndex = encodeClaudeOversizedReverseState(oversizedState);
        cursor = start;
        break;
      }
      const firstNewline = data.indexOf(0x0a);
      const completeStart = start === 0 ? 0 : firstNewline >= 0 ? firstNewline + 1 : data.length;
      let lineEnd = data.length;
      while (lineEnd > completeStart) {
        const lineBoundaryIndex = lineEnd;
        const previousNewline = data.lastIndexOf(0x0a, lineEnd - 1);
        const lineStart = Math.max(completeStart, previousNewline + 1);
        const lineBuffer = data.subarray(lineStart, lineEnd);
        lineEnd = previousNewline;
        if (!lineBuffer.toString('utf8').trim()) continue;
        parsedLines += 1;
        try {
          const record = JSON.parse(lineBuffer.toString('utf8'));
          if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
          const absoluteByteOffset = start + lineStart;
          const lineMessages = claudeRecordToMessages(record, sessionId, absoluteByteOffset);
          visibleSeen += lineMessages.length;
          if (pageBoundaryLocked) visibleAfterPageBoundary += lineMessages.length;
          if (!pageBoundaryLocked && lineMessages.length > 0) {
            const newestFirst = [...lineMessages].reverse();
            const skip = Math.min(pendingPartSkip, newestFirst.length);
            pendingPartSkip = 0;
            const available = newestFirst.slice(skip);
            const remaining = Math.max(0, normalizedLimit - selectedNewestFirst.length);
            const delivered = available.slice(0, remaining);
            selectedNewestFirst.push(...delivered);
            const absoluteLineBoundary = start + lineBoundaryIndex + (data[lineBoundaryIndex] === 0x0a ? 1 : 0);
            if (delivered.length < available.length) {
              nextBoundary = absoluteLineBoundary;
              nextPartIndex = skip + delivered.length;
              pageBoundaryLocked = true;
            } else {
              nextBoundary = absoluteByteOffset;
              nextPartIndex = 0;
              if (selectedNewestFirst.length >= normalizedLimit) pageBoundaryLocked = true;
            }
          }
        } catch {
          // Ignore malformed append-only rows without expanding the read window.
        }
      }
      if (!pageBoundaryLocked) {
        /** Filtered, malformed and empty complete rows still advance the opaque scan cursor. */
        nextBoundary = start + completeStart;
        nextPartIndex = 0;
      }
      carry = start > 0 && firstNewline >= 0 ? data.subarray(0, firstNewline) : start > 0 ? data : Buffer.alloc(0);
      cursor = start;
      reachedStart = cursor === 0;
      if (pageBoundaryLocked) break;
    }
  } finally {
    await handle.close();
  }
  if (reachedStart && nextPartIndex === 0 && visibleAfterPageBoundary === 0) {
    /** Invisible metadata before the oldest visible message must not create an empty extra page. */
    nextBoundary = 0;
  }
  const messages = selectedNewestFirst.reverse();
  const hasMore = nextBoundary > 0 || nextPartIndex > 0;
  const total = reachedStart ? visibleSeen : messages.length + (hasMore ? 1 : 0);
  const nextOffset = encodeClaudeHistoryOffset(snapshotByteOffset, nextBoundary, nextPartIndex);
  return {
    page: {
      messages,
      total,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
      nextMessageOffset: nextOffset,
      nextRawLineOffset: snapshotByteOffset,
      historySnapshotRawLineOffset: snapshotByteOffset,
      appendCursor: encodeClaudeAppendCursor(snapshotByteOffset, 0),
    },
    bytesRead,
    parsedLines,
    reachedStart,
  };
}

/** Encode reverse byte progress and in-row progress as one monotonic numeric token. */
function encodeClaudeHistoryOffset(snapshotByteOffset: number, byteOffset: number, partIndex: number): number {
  /** Keep legacy numeric offset plumbing while making the value an opaque cursor. */
  const scannedBytes = Math.max(0, snapshotByteOffset - byteOffset);
  return scannedBytes * CLAUDE_HISTORY_CURSOR_PART_BASE + Math.max(0, partIndex) + 1;
}

/** Decode a validated reverse history token; zero always means the snapshot tail. */
function decodeClaudeHistoryOffset(value: number, snapshotByteOffset: number): { byteOffset: number; partIndex: number } {
  /** Invalid or foreign offsets safely restart at the frozen snapshot boundary. */
  if (!Number.isSafeInteger(value) || value <= 0) return { byteOffset: snapshotByteOffset, partIndex: 0 };
  const raw = value - 1;
  const scannedBytes = Math.floor(raw / CLAUDE_HISTORY_CURSOR_PART_BASE);
  const partIndex = raw % CLAUDE_HISTORY_CURSOR_PART_BASE;
  if (scannedBytes > snapshotByteOffset) return { byteOffset: snapshotByteOffset, partIndex: 0 };
  return { byteOffset: snapshotByteOffset - scannedBytes, partIndex };
}

/**
 * Encode the byte and in-record part position used by Claude incremental reads.
 */
function encodeClaudeAppendCursor(byteOffset: number, partIndex: number): string {
  /** Keep the cursor opaque to callers while remaining easy to validate. */
  return `claude-byte:${byteOffset}:part:${partIndex}`;
}

/** Decode a validated Claude byte-and-part append cursor. */
function decodeClaudeAppendCursor(value: unknown): { byteOffset: number; partIndex: number } | null {
  /** Reject foreign or malformed cursors instead of guessing their meaning. */
  const match = String(value || '').match(/^claude-byte:(\d+):part:(\d+)$/);
  if (!match) return null;
  const byteOffset = Number(match[1]);
  const partIndex = Number(match[2]);
  return Number.isSafeInteger(byteOffset) && Number.isSafeInteger(partIndex)
    ? { byteOffset, partIndex }
    : null;
}

/**
 * Stream Claude rows after a byte-and-part cursor until the response limit.
 */
async function readClaudeMessagesAfterCursor(
  filePath: string,
  sessionId: string,
  limit: unknown,
  cursor: { byteOffset: number; partIndex: number },
): Promise<{ page: LooseRecord; bytesRead: number; parsedLines: number }> {
  /** Stop at the last delivered part so unread messages remain reachable. */
  const stat = await fs.stat(filePath);
  const startByte = Math.min(stat.size, cursor.byteOffset);
  const normalizedLimit = limit === null || limit === undefined
    ? CLAUDE_HISTORY_DEFAULT_LIMIT
    : Math.min(CLAUDE_HISTORY_MAX_LIMIT, Math.max(0, Math.floor(Number(limit) || 0)));
  if (normalizedLimit === 0) {
    /** Incremental zero-sized pages use the same terminal contract as history pages. */
    return {
      page: {
        messages: [], total: 0, hasMore: false, offset: 0, limit: 0, nextMessageOffset: 0,
        nextRawLineOffset: startByte,
        historySnapshotRawLineOffset: stat.size,
        appendCursor: encodeClaudeAppendCursor(startByte, cursor.partIndex),
      },
      bytesRead: 0,
      parsedLines: 0,
    };
  }
  const messages: LooseRecord[] = [];
  let bytesRead = 0;
  let parsedLines = 0;
  let readPosition = startByte;
  let carry = Buffer.alloc(0);
  let carryStart = startByte;
  let nextByteOffset = startByte;
  let nextPartIndex = cursor.partIndex;
  const handle = await fs.open(filePath, 'r');
  try {
    if (isClaudeOversizedStatePart(nextPartIndex)) {
      /** Continue classifying one oversized physical row before deciding placeholder visibility. */
      const oversizedState = decodeClaudeOversizedForwardState(nextPartIndex);
      while (readPosition < stat.size && bytesRead < CLAUDE_HISTORY_MAX_READ_BYTES) {
        const readLength = Math.min(CLAUDE_HISTORY_READ_CHUNK_BYTES, stat.size - readPosition);
        const chunk = Buffer.alloc(readLength);
        const { bytesRead: currentRead } = await handle.read(chunk, 0, readLength, readPosition);
        if (currentRead <= 0) break;
        bytesRead += currentRead;
        const newlineIndex = chunk.subarray(0, currentRead).indexOf(0x0a);
        if (newlineIndex >= 0) {
          scanClaudeOversizedForward(oversizedState, chunk.subarray(0, newlineIndex));
          nextByteOffset = readPosition + newlineIndex + 1;
          nextPartIndex = 0;
          readPosition = nextByteOffset;
          if (isClaudeOversizedStateVisible(oversizedState) && messages.length < normalizedLimit) {
            messages.push(createClaudeOversizedRowMessage(sessionId, nextByteOffset));
          }
          break;
        }
        scanClaudeOversizedForward(oversizedState, chunk.subarray(0, currentRead));
        readPosition += currentRead;
        nextByteOffset = readPosition;
        nextPartIndex = encodeClaudeOversizedForwardState(oversizedState);
      }
      if (readPosition >= stat.size && isClaudeOversizedStatePart(nextPartIndex)) {
        /** An unterminated oversized append is classified once at this frozen EOF. */
        if (isClaudeOversizedStateVisible(oversizedState) && messages.length < normalizedLimit) {
          messages.push(createClaudeOversizedRowMessage(sessionId, readPosition));
        }
        nextPartIndex = 0;
      }
    }
    while (!isClaudeOversizedStatePart(nextPartIndex) && readPosition < stat.size && messages.length < normalizedLimit && bytesRead < CLAUDE_HISTORY_MAX_READ_BYTES) {
      const readLength = Math.min(CLAUDE_HISTORY_READ_CHUNK_BYTES, stat.size - readPosition);
      const chunk = Buffer.alloc(readLength);
      const { bytesRead: currentRead } = await handle.read(chunk, 0, readLength, readPosition);
      if (currentRead <= 0) break;
      bytesRead += currentRead;
      readPosition += currentRead;
      const data = Buffer.concat([carry, chunk.subarray(0, currentRead)]);
      if (data.length >= CLAUDE_HISTORY_MAX_ROW_BYTES && (data.indexOf(0x0a) < 0 || data.indexOf(0x0a) >= CLAUDE_HISTORY_MAX_ROW_BYTES)) {
        const oversizedState: ClaudeOversizedForwardState = {
          depth: 0, mode: 0, stringMatch: 0, phase: 0, currentKey: 0, recordType: 0, sidechain: 0,
        };
        const oversizedNewline = data.indexOf(0x0a);
        if (oversizedNewline >= 0) {
          scanClaudeOversizedForward(oversizedState, data.subarray(0, oversizedNewline));
          if (isClaudeOversizedStateVisible(oversizedState) && messages.length < normalizedLimit) {
            messages.push(createClaudeOversizedRowMessage(sessionId, carryStart));
          }
          nextByteOffset = carryStart + oversizedNewline + 1;
          nextPartIndex = 0;
        } else {
          scanClaudeOversizedForward(oversizedState, data);
          nextByteOffset = readPosition;
          nextPartIndex = encodeClaudeOversizedForwardState(oversizedState);
        }
        break;
      }
      let lineStartInBuffer = 0;
      while (messages.length < normalizedLimit) {
        const newlineIndex = data.indexOf(0x0a, lineStartInBuffer);
        if (newlineIndex < 0) break;
        const lineStartByte = carryStart + lineStartInBuffer;
        const lineEndByte = carryStart + newlineIndex + 1;
        const lineBuffer = data.subarray(lineStartInBuffer, newlineIndex);
        lineStartInBuffer = newlineIndex + 1;
        nextByteOffset = lineEndByte;
        nextPartIndex = 0;
        if (!lineBuffer.toString('utf8').trim()) continue;
        parsedLines += 1;
        try {
          const record = JSON.parse(lineBuffer.toString('utf8'));
          if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
          const lineMessages = claudeRecordToMessages(record, sessionId, lineStartByte);
          const firstPart = lineStartByte === startByte ? cursor.partIndex : 0;
          for (let partIndex = firstPart; partIndex < lineMessages.length; partIndex += 1) {
            if (messages.length >= normalizedLimit) {
              nextByteOffset = lineStartByte;
              nextPartIndex = partIndex;
              break;
            }
            messages.push(lineMessages[partIndex]);
            if (partIndex + 1 < lineMessages.length) {
              nextByteOffset = lineStartByte;
              nextPartIndex = partIndex + 1;
            } else {
              nextByteOffset = lineEndByte;
              nextPartIndex = 0;
            }
          }
        } catch {
          // Malformed complete rows are skipped while the byte cursor advances.
        }
      }
      carry = data.subarray(lineStartInBuffer);
      carryStart += lineStartInBuffer;
    }
  } finally {
    await handle.close();
  }
  const hasMore = nextPartIndex > 0 || nextByteOffset < stat.size;
  return {
    page: {
      messages,
      total: messages.length,
      hasMore,
      offset: 0,
      limit: normalizedLimit,
      nextMessageOffset: messages.length,
      nextRawLineOffset: nextByteOffset,
      historySnapshotRawLineOffset: stat.size,
      appendCursor: encodeClaudeAppendCursor(nextByteOffset, nextPartIndex),
    },
    bytesRead,
    parsedLines,
  };
}

/** Return bounded-reader diagnostics for acceptance tests. */
export function getClaudeHistoryReadStatsForTest(): typeof lastClaudeHistoryReadStats {
  /** Expose a copy so tests cannot mutate production reader state. */
  return { ...lastClaudeHistoryReadStats };
}

/**
 * Stream JSONL records from a provider transcript.
 */
async function* readJsonlRecords(filePath: string): AsyncGenerator<LooseRecord> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const record = JSON.parse(line);
        if (record && typeof record === 'object' && !Array.isArray(record)) {
          yield record;
        }
      } catch {
        // Ignore malformed transcript lines; provider histories are append-only.
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

/**
 * Read message records using raw JSONL line cursors while preserving total lines.
 */
async function readJsonlRecordsForMessages(filePath: string, afterLine: unknown = null): Promise<JsonlReadResult> {
  const cursor = normalizeAfterLine(afterLine);
  const cached = jsonlCursorCache.get(filePath);
  const stat = await fs.stat(filePath);
  if (cursor !== null && cached && cursor === cached.lineCount && stat.size >= cached.byteSize) {
    const tail = await readJsonlTail(filePath, cached.byteSize);
    const parsed = parseJsonlText(tail, cached.lineCount);
    const totalLines = cached.lineCount + parsed.lineCount;
    jsonlCursorCache.set(filePath, { lineCount: totalLines, byteSize: stat.size });
    return { records: parsed.records, totalLines };
  }

  const parsed = await readJsonlFull(filePath);
  jsonlCursorCache.set(filePath, { lineCount: parsed.totalLines, byteSize: stat.size });
  if (cursor === null || cursor <= 0) {
    return parsed;
  }
  return {
    records: parsed.records.filter(({ lineNumber }) => lineNumber > cursor),
    totalLines: parsed.totalLines,
  };
}

/**
 * Normalize afterLine into the JSONL line cursor used by the messages API.
 */
function normalizeAfterLine(afterLine: unknown): number | null {
  if (afterLine === null || afterLine === undefined || afterLine === '') {
    return null;
  }
  const value = Number(afterLine);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

/**
 * Read a whole JSONL file for initial loads and cache misses.
 */
async function readJsonlFull(filePath: string): Promise<JsonlReadResult> {
  const records: Array<{ record: LooseRecord; lineNumber: number }> = [];
  let lineNumber = 0;
  for await (const record of readJsonlRecords(filePath)) {
    lineNumber += 1;
    records.push({ record, lineNumber });
  }
  return { records, totalLines: lineNumber };
}

/**
 * Read appended JSONL bytes from a cached EOF position.
 */
async function readJsonlTail(filePath: string, startByte: number): Promise<string> {
  const handle = await fs.open(filePath, 'r');
  try {
    const chunks: Buffer[] = [];
    const buffer = Buffer.alloc(64 * 1024);
    let position = startByte;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead <= 0) {
        break;
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      position += bytesRead;
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Parse JSONL text into records and raw line counts from a known cursor base.
 */
function parseJsonlText(text: string, baseLineNumber: number): {
  records: Array<{ record: LooseRecord; lineNumber: number }>;
  lineCount: number;
} {
  const records: Array<{ record: LooseRecord; lineNumber: number }> = [];
  let lineCount = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    lineCount += 1;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === 'object' && !Array.isArray(record)) {
        records.push({ record, lineNumber: baseLineNumber + lineCount });
      }
    } catch {
      // Ignore malformed transcript lines; provider histories are append-only.
    }
  }
  return { records, lineCount };
}

/**
 * Recursively list JSONL files below a directory.
 */
async function listJsonlFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }
  await visit(rootDir);
  return files.sort();
}

/**
 * Match a session id against filename or first JSONL session id.
 */
async function findSessionFile(files: string[], sessionId: string): Promise<string | null> {
  const target = String(sessionId || '').trim();
  if (!target) {
    return null;
  }
  const byName = files.find((filePath) => path.basename(filePath, '.jsonl') === target || path.basename(filePath).includes(target));
  if (byName) {
    return byName;
  }
  for (const filePath of files) {
    const firstRecord = await readJsonlFirstRecord(filePath);
    if (firstRecord?.id === target || firstRecord?.payload?.id === target) {
      return filePath;
    }
  }
  return null;
}

/**
 * Read the visible text payload used for duplicate transcript rows.
 */
function getTextMessageContent(message: LooseRecord): string {
  return String(message.message?.content || '').trim();
}

/**
 * Convert provider timestamps to a comparable millisecond value.
 */
function readTimestampMs(value: unknown): number | null {
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Convert Codex task completion epoch values into the transcript timestamp
 * format already used by message rows.
 */
function readCodexTaskCompletedAt(value: unknown): string | undefined {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    const epochMs = numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000;
    return new Date(epochMs).toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return undefined;
}

/**
 * Preserve numeric Codex timing fields without leaking NaN into the API.
 */
function readOptionalNumber(value: unknown): number | undefined {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

/**
 * Parse JSON-like fields without throwing while reading historical transcripts.
 */
function parseLooseRecord(value: unknown): LooseRecord | null {
  /**
   * docstring: Codex function arguments and outputs can arrive as objects or
   * JSON strings, so goal detection needs one tolerant parser.
   */
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as LooseRecord;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as LooseRecord
      : null;
  } catch {
    return null;
  }
}

/**
 * Read the Codex turn id from records that carry one in different locations.
 */
function readCodexRecordTurnId(record: LooseRecord): string {
  /**
   * docstring: Goal completion is tied to the provider turn, not to a tool
   * call id, so both task_complete and function_call metadata must normalize.
   */
  return String(record.payload?.turn_id || record.payload?.turnId || record.payload?.metadata?.turn_id || '');
}

/**
 * Return true when a Codex tool call explicitly marks an active goal complete.
 */
function isCodexGoalCompletionCall(record: LooseRecord): boolean {
  /**
   * docstring: Normal Codex turns also emit task_complete; only update_goal
   * with a complete status means the user-created goal has completed.
   */
  if (
    record.type !== 'response_item'
    || (record.payload?.type !== 'function_call' && record.payload?.type !== 'custom_tool_call')
  ) {
    return false;
  }

  const toolName = String(record.payload?.name || record.payload?.toolName || '').split('.').pop();
  if (toolName !== 'update_goal') {
    return false;
  }

  const args = parseLooseRecord(record.payload?.arguments ?? record.payload?.input) || {};
  const status = String(args.status || '').toLowerCase();
  return status === 'complete' || status === 'completed';
}

/**
 * Build transcript-level context needed to classify Codex lifecycle events.
 */
function buildCodexRecordContext(records: JsonlReadResult['records']): CodexRecordContext {
  /**
   * docstring: Read all returned records once so task_complete mapping can
   * distinguish ordinary turn completion from real /goal completion.
   */
  const goalCompletionTurnIds = new Set<string>();
  const goalUpdateCallTurns = new Map<string, string>();

  records.forEach(({ record }) => {
    if (isCodexGoalCompletionCall(record)) {
      const turnId = readCodexRecordTurnId(record);
      const callId = String(record.payload?.call_id || record.payload?.callId || record.payload?.id || '');
      if (turnId) {
        goalCompletionTurnIds.add(turnId);
      }
      if (callId && turnId) {
        goalUpdateCallTurns.set(callId, turnId);
      }
      return;
    }

    if (record.type !== 'response_item' || record.payload?.type !== 'function_call_output') {
      return;
    }
    const callId = String(record.payload.call_id || record.payload.callId || record.payload.id || '');
    const turnId = goalUpdateCallTurns.get(callId);
    const output = parseLooseRecord(record.payload.output ?? record.payload.content ?? record.payload.result);
    const status = String(output?.goal?.status || output?.status || '').toLowerCase();
    if (turnId && (status === 'complete' || status === 'completed')) {
      goalCompletionTurnIds.add(turnId);
    }
  });

  return { goalCompletionTurnIds };
}

/**
 * Decide whether a Codex task_complete record should become a goal banner.
 */
function isCodexGoalCompletionTask(record: LooseRecord, context: CodexRecordContext): boolean {
  /**
   * docstring: The UI milestone belongs only to completed /goal runs, never to
   * the provider's routine task_complete marker for every assistant turn.
   */
  const turnId = readCodexRecordTurnId(record);
  return Boolean(turnId && context.goalCompletionTurnIds.has(turnId));
}

/**
 * Build a short, visible summary from the final assistant answer that preceded
 * Codex's task_complete event.
 */
function summarizeTaskCompletionMessage(message: unknown): string {
  const content = stringifyMessageContent(message);
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    let normalized = line
      .trim()
      .replace(/^[-*]\s+/, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\*\*(.+?)\*\*$/, '$1')
      .trim();

    if (!normalized || /^问[:：]/.test(normalized)) {
      continue;
    }

    const answerMatch = normalized.match(/^答[:：]\s*(.+)$/);
    if (answerMatch) {
      normalized = answerMatch[1].trim();
    }

    if (/^(需求\/问题|原因分析|做法|成果|问|答)[:：]?$/.test(normalized)) {
      continue;
    }

    return summarizeText(normalized, 140, false);
  }

  return 'Goal completed';
}

/**
 * Collapse Codex's paired event_msg/response_item assistant records. The
 * response_item copy keeps phase metadata, so prefer it when both are present.
 */
function collapseAdjacentCodexAssistantDuplicate(messages: LooseRecord[], message: LooseRecord): boolean {
  const content = getTextMessageContent(message);
  if (!content) {
    return false;
  }

  const previous = messages[messages.length - 1];
  if (!previous || previous.type !== 'assistant' || getTextMessageContent(previous) !== content) {
    return false;
  }

  const previousTime = readTimestampMs(previous.timestamp);
  const currentTime = readTimestampMs(message.timestamp);
  if (previousTime !== null && currentTime !== null && Math.abs(currentTime - previousTime) > 5000) {
    return false;
  }

  if (!previous.message?.phase && message.message?.phase) {
    messages[messages.length - 1] = message;
  }
  return true;
}

/**
 * Convert Codex function-like payloads into the shared tool_use row contract.
 */
function codexFunctionPayloadToToolUse(
  payload: LooseRecord,
  sessionId: string,
  lineNumber: number,
  timestamp: unknown,
): LooseRecord {
  const normalized = normalizeCodexFunctionCall(payload);
  const callId = String(normalized.toolCallId || '');
  return {
    type: 'tool_use',
    provider: 'codex',
    timestamp,
    messageKey: `codex:${sessionId}:line:${lineNumber}:tool:${callId || 'call'}`,
    toolName: normalized.toolName,
    toolInput: normalized.toolInput,
    toolCallId: callId || undefined,
    status: payload.status,
  };
}

/**
 * Convert one Codex JSONL record to normalized message rows.
 */
function codexRecordToMessages(
  record: LooseRecord,
  sessionId: string,
  lineNumber: number,
  context: CodexRecordContext,
): LooseRecord[] {
  if (record.type === 'event_msg' && record.payload?.type === 'user_message') {
    const content = cleanCodexUserContent(stringifyMessageContent(record.payload.message));
    if (!content || isCodexInternalUserContent(content)) {
      return [];
    }
    return [{
      type: 'user',
      provider: 'codex',
      timestamp: record.timestamp,
      messageKey: `codex:${sessionId}:line:${lineNumber}:msg:0`,
      message: { role: 'user', content },
    }];
  }
  if (record.type === 'event_msg' && record.payload?.type === 'agent_message') {
    const content = stringifyMessageContent(record.payload.message);
    return content ? [{
      type: 'assistant',
      provider: 'codex',
      timestamp: record.timestamp,
      messageKey: `codex:${sessionId}:line:${lineNumber}:msg:0`,
      message: { role: 'assistant', content },
    }] : [];
  }
  if (record.type === 'event_msg' && record.payload?.type === 'task_complete') {
    if (!isCodexGoalCompletionTask(record, context)) {
      return [];
    }
    const durationMs = readOptionalNumber(record.payload.duration_ms);
    const timeToFirstTokenMs = readOptionalNumber(record.payload.time_to_first_token_ms);
    return [{
      type: 'assistant',
      provider: 'codex',
      timestamp: record.timestamp,
      messageKey: `codex:${sessionId}:line:${lineNumber}:task-complete:${record.payload.turn_id || 'goal'}`,
      content: summarizeTaskCompletionMessage(record.payload.last_agent_message),
      isTaskNotification: true,
      taskStatus: 'completed',
      taskKind: 'goal_complete',
      completedAt: readCodexTaskCompletedAt(record.payload.completed_at),
      durationMs,
      timeToFirstTokenMs,
    }];
  }
  if (record.type === 'response_item' && record.payload?.type === 'message' && record.payload?.role === 'assistant') {
    const content = stringifyMessageContent(record.payload.content);
    return content ? [{
      type: 'assistant',
      provider: 'codex',
      timestamp: record.timestamp,
      messageKey: `codex:${sessionId}:line:${lineNumber}:msg:0`,
      message: { role: 'assistant', content, phase: record.payload.phase },
    }] : [];
  }
  if (record.type === 'response_item' && record.payload?.type === 'message' && record.payload?.role === 'user') {
    const content = cleanCodexUserContent(stringifyMessageContent(record.payload.content));
    if (!content || isCodexInternalUserContent(content)) {
      return [];
    }
    return [{
      type: 'user',
      provider: 'codex',
      timestamp: record.timestamp,
      messageKey: `codex:${sessionId}:line:${lineNumber}:msg:0`,
      message: { role: 'user', content },
    }];
  }
  if (record.type === 'response_item' && record.payload?.type === 'update' && record.payload?.update?.type === 'functionCall') {
    return [codexFunctionPayloadToToolUse(record.payload.update, sessionId, lineNumber, record.timestamp)];
  }
  if (record.type === 'response_item' && record.payload?.type === 'command_execution') {
    const callId = String(record.payload.id || record.payload.call_id || '');
    return [
      {
        type: 'tool_use',
        provider: 'codex',
        timestamp: record.timestamp,
        messageKey: `codex:${sessionId}:line:${lineNumber}:tool:${callId || 'command'}`,
        toolName: String(record.payload.command || record.payload.name || 'Command'),
        toolInput: record.payload.arguments ?? record.payload.input ?? '',
        toolCallId: callId || undefined,
        status: record.payload.status,
      },
      {
        type: 'tool_result',
        provider: 'codex',
        timestamp: record.timestamp,
        messageKey: `codex:${sessionId}:line:${lineNumber}:tool-result:${callId || 'command'}`,
        toolCallId: callId || undefined,
        output: stringifyMessageContent(record.payload.output ?? record.payload.result),
        exitCode: record.payload.exitCode,
      },
    ];
  }
  if (record.type === 'response_item' && record.payload?.type === 'file_change') {
    const callId = String(record.payload.id || '');
    return [
      {
        type: 'tool_use',
        provider: 'codex',
        timestamp: record.timestamp,
        messageKey: `codex:${sessionId}:line:${lineNumber}:tool:${callId || 'file-change'}`,
        toolName: 'FileChanges',
        toolInput: { changes: [{ path: record.payload.path, changeType: record.payload.changeType }] },
        toolCallId: callId || undefined,
      },
      {
        type: 'tool_result',
        provider: 'codex',
        timestamp: record.timestamp,
        messageKey: `codex:${sessionId}:line:${lineNumber}:tool-result:${callId || 'file-change'}`,
        toolCallId: callId || undefined,
        output: stringifyMessageContent(record.payload.summary || record.payload.path || ''),
      },
    ];
  }
  if (record.type === 'response_item' && record.payload?.type === 'mcp_tool_call') {
    const callId = String(record.payload.id || '');
    const toolName = `${String(record.payload.server || 'mcp')}:${String(record.payload.name || 'tool')}`;
    return [
      {
        type: 'tool_use',
        provider: 'codex',
        timestamp: record.timestamp,
        messageKey: `codex:${sessionId}:line:${lineNumber}:tool:${callId || 'mcp'}`,
        toolName,
        toolInput: record.payload.arguments ?? record.payload.input ?? '',
        toolCallId: callId || undefined,
      },
      {
        type: 'tool_result',
        provider: 'codex',
        timestamp: record.timestamp,
        messageKey: `codex:${sessionId}:line:${lineNumber}:tool-result:${callId || 'mcp'}`,
        toolCallId: callId || undefined,
        output: stringifyMessageContent(record.payload.result ?? record.payload.output),
      },
    ];
  }
  if (
    record.type === 'response_item'
    && (record.payload?.type === 'function_call' || record.payload?.type === 'custom_tool_call')
  ) {
    return [codexFunctionPayloadToToolUse(record.payload, sessionId, lineNumber, record.timestamp)];
  }
  if (
    record.type === 'response_item'
    && (record.payload?.type === 'function_call_output' || record.payload?.type === 'custom_tool_call_output')
  ) {
    const callId = String(record.payload.call_id || record.payload.callId || record.payload.id || '');
    return [{
      type: 'tool_result',
      provider: 'codex',
      timestamp: record.timestamp,
      messageKey: `codex:${sessionId}:line:${lineNumber}:tool-result:${callId || 'call'}`,
      toolCallId: callId || undefined,
      output: stringifyMessageContent(record.payload.output ?? record.payload.content ?? record.payload.result),
    }];
  }
  return [];
}

/**
 * Convert one Pi JSONL record to normalized message rows.
 */
function piRecordToMessages(record: LooseRecord, sessionId: string, lineNumber: number): LooseRecord[] {
  if (record.type !== 'message') {
    return [];
  }
  const role = record.message?.role === 'user'
    ? 'user'
    : record.message?.role === 'toolResult'
      ? 'toolResult'
      : 'assistant';
  if (role === 'toolResult') {
    const output = stringifyMessageContent(record.message?.content);
    return [{
      type: 'tool_result',
      provider: 'pi',
      timestamp: record.timestamp,
      messageKey: `pi:${sessionId}:line:${lineNumber}:tool-result:${record.message?.toolCallId || record.id || 'result'}`,
      toolName: String(record.message?.toolName || ''),
      toolCallId: String(record.message?.toolCallId || ''),
      output,
    }];
  }
  if (role === 'assistant' && Array.isArray(record.message?.content)) {
    return piAssistantPartsToMessages(record.message.content, record, sessionId, lineNumber);
  }
  const content = role === 'assistant'
    ? stringifyAssistantTextContent(record.message?.content) || stringifyMessageContent(record.message?.content)
    : stringifyMessageContent(record.message?.content);
  return content ? [{
    type: role,
    provider: 'pi',
    timestamp: record.timestamp,
    messageKey: `pi:${sessionId}:line:${lineNumber}:msg:0`,
    message: { role, content },
  }] : [];
}

/**
 * Expand Pi mixed assistant parts in provider order.
 */
function piAssistantPartsToMessages(content: unknown[], record: LooseRecord, sessionId: string, lineNumber: number): LooseRecord[] {
  const messages: LooseRecord[] = [];
  content.forEach((part, index) => {
    if (typeof part === 'string') {
      if (part) {
        messages.push({
          type: 'assistant',
          provider: 'pi',
          timestamp: record.timestamp,
          messageKey: `pi:${sessionId}:line:${lineNumber}:msg:${index}`,
          message: { role: 'assistant', content: part },
        });
      }
      return;
    }
    if (!part || typeof part !== 'object') {
      return;
    }
    const item = part as LooseRecord;
    const kind = String(item.type || '');
    if (kind === 'text' || kind === 'output_text') {
      const text = String(item.text || item.content || '');
      if (text) {
        messages.push({
          type: 'assistant',
          provider: 'pi',
          timestamp: record.timestamp,
          messageKey: `pi:${sessionId}:line:${lineNumber}:msg:${index}`,
          message: { role: 'assistant', content: text },
        });
      }
      return;
    }
    if (kind === 'thinking' || kind === 'reasoning') {
      const thinking = String(item.thinking || item.text || item.content || '');
      if (thinking) {
        const type = record.message?.stopReason === 'stop' && content.length === 1 ? 'assistant' : 'thinking';
        messages.push({
          type,
          provider: 'pi',
          timestamp: record.timestamp,
          messageKey: `pi:${sessionId}:line:${lineNumber}:${type}:${index}`,
          message: { role: 'assistant', content: thinking },
        });
      }
      return;
    }
    if (kind === 'toolCall' || kind === 'tool_call' || kind === 'tool_use') {
      const toolCallId = String(item.id || item.toolCallId || item.tool_call_id || '');
      messages.push({
        type: 'tool_use',
        provider: 'pi',
        timestamp: record.timestamp,
        messageKey: `pi:${sessionId}:line:${lineNumber}:tool:${toolCallId || index}`,
        toolName: String(item.name || item.toolName || item.tool || 'UnknownTool'),
        toolInput: item.arguments ?? item.args ?? item.input ?? '',
        toolCallId: toolCallId || undefined,
      });
    }
  });
  return messages;
}

/**
 * Apply raw JSONL line offset/limit to a message list.
 */
function paginateMessages(messages: LooseRecord[], limit: unknown, offset: unknown, total: number = messages.length): LooseRecord {
  const normalizedOffset = Math.max(0, Number(offset) || 0);
  const normalizedLimit = limit === null || limit === undefined ? null : Math.max(0, Number(limit) || 0);
  const rawWindowStart = normalizedLimit === null
    ? 0
    : Math.max(0, total - normalizedOffset - normalizedLimit);
  const rawWindowEnd = normalizedLimit === null
    ? total
    : Math.max(0, total - normalizedOffset);
  const offsetMessages = messages.filter((message) => {
    const rawLine = getMessageRawLineNumber(message);
    return rawLine > rawWindowStart && rawLine <= rawWindowEnd;
  });
  const page = normalizedLimit === null
    ? offsetMessages
    : offsetMessages;
  const nextRawLineOffset = normalizedLimit === null ? total : Math.min(total, normalizedOffset + normalizedLimit);
  return {
    messages: page,
    total,
    hasMore: normalizedLimit !== null ? total > nextRawLineOffset : false,
    offset: normalizedOffset,
    limit: normalizedLimit,
    nextMessageOffset: nextRawLineOffset,
    nextRawLineOffset,
  };
}

/**
 * Extract the provider transcript raw JSONL line number from a stable message key.
 */
function getMessageRawLineNumber(message: LooseRecord): number {
  const match = String(message.messageKey || '').match(/:line:(\d+):/);
  return match ? Number(match[1]) : 0;
}

/**
 * Convert provider message content variants into searchable text.
 */
function stringifyMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (!part || typeof part !== 'object') {
          return '';
        }
        const record = part as LooseRecord;
        return String(record.text || record.content || record.thinking || record.message || '');
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    const record = content as LooseRecord;
    if (Array.isArray(record.content)) {
      return stringifyMessageContent(record.content);
    }
    return String(record.text || record.content || record.message || '');
  }
  return '';
}

const CODEX_INTERNAL_USER_BLOCK_TAGS = ['environment_context', 'system-reminder', 'codex_internal_context'];
const CODEX_AGENTS_INSTRUCTIONS_PATTERN = /^# AGENTS\.md instructions\s*\n+\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/i;

/**
 * Remove Codex bootstrap instructions from role=user transcript text.
 */
function cleanCodexUserContent(content: string): string {
  /**
   * docstring: First-turn Codex history can persist AGENTS.md and environment
   * bootstrap content as role=user rows, but only user-authored text is visible.
   */
  let visible = content.trim();
  if (!visible) {
    return '';
  }

  let changed = true;
  while (changed) {
    const before = visible;
    visible = visible.replace(CODEX_AGENTS_INSTRUCTIONS_PATTERN, '').trim();
    CODEX_INTERNAL_USER_BLOCK_TAGS.forEach((tagName) => {
      const leadingBlock = new RegExp(`^<${tagName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tagName}>\\s*`, 'i');
      const trailingBlock = new RegExp(`\\s*<${tagName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tagName}>\\s*$`, 'i');
      visible = visible.replace(leadingBlock, '').replace(trailingBlock, '').trim();
    });
    changed = visible !== before;
  }

  return visible;
}

/**
 * Detect provider-facing Codex user blocks that should not become chat bubbles.
 */
function isCodexInternalUserContent(content: string): boolean {
  /**
   * Codex can persist injected context as role=user rows during follow-up
   * turns.  Only hide complete known wrapper blocks so ordinary user text that
   * mentions these tag names remains visible.
   */
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }

  return CODEX_INTERNAL_USER_BLOCK_TAGS.some((tagName) => {
    const openTag = new RegExp(`^<${tagName}(?:\\s[^>]*)?>`, 'i');
    const closeTag = new RegExp(`</${tagName}>\\s*$`, 'i');
    return openTag.test(trimmed) && closeTag.test(trimmed);
  });
}

/**
 * Extract visible assistant answer text without mixing Pi thinking blocks into the answer row.
 */
function stringifyAssistantTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (!part || typeof part !== 'object') {
        return '';
      }
      const record = part as LooseRecord;
      const kind = String(record.type || '');
      return kind === 'text' || kind === 'output_text'
        ? String(record.text || record.content || '')
        : '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Trim a message into a session title.
 */
function summarizeText(text: string, maxLength = 50, ellipsis = true): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return ellipsis ? `${normalized.slice(0, maxLength)}...` : normalized.slice(0, maxLength);
}

/**
 * Return whether a parsed header belongs to a normalized project path.
 */
export function sessionBelongsToProject(session: LooseRecord, projectPath = ''): boolean {
  if (!projectPath) {
    return true;
  }
  return normalizeProjectPath(session.projectPath || session.cwd || '') === normalizeProjectPath(projectPath);
}
