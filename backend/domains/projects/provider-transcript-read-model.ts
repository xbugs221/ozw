/**
 * PURPOSE: Typed provider transcript reader for Codex and Pi JSONL session
 * headers and message payloads.
 */
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';

import { normalizeProjectPath, type LooseRecord } from './project-config-read-model.js';

type JsonlCursor = {
  lineCount: number;
  byteSize: number;
};

type JsonlReadResult = {
  records: Array<{ record: LooseRecord; lineNumber: number }>;
  totalLines: number;
};

const jsonlCursorCache = new Map<string, JsonlCursor>();

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
  let lastUserMessage = '';
  let sourceSessionId = '';
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
      sourceSessionId ||= String(record.payload.id || '');
    }
    if (!cwd && typeof record.cwd === 'string') {
      cwd = record.cwd;
    }
    if (record.type === 'event_msg' && record.payload?.type === 'user_message') {
      messageCount += 1;
      firstUserMessage ||= stringifyMessageContent(record.payload.message);
      lastUserMessage = stringifyMessageContent(record.payload.message) || lastUserMessage;
    }
    if (record.type === 'response_item' && record.payload?.type === 'message') {
      messageCount += 1;
    }
  }
  if (!cwd) {
    return null;
  }
  const { thread, sessionFileName } = deriveCodexThreadFromJsonlPath(filePath);
  return {
    id: thread,
    provider: 'codex',
    cwd,
    projectPath: cwd,
    model,
    createdAt: firstTimestamp || lastTimestamp || new Date().toISOString(),
    lastActivity: lastTimestamp || firstTimestamp || new Date().toISOString(),
    updated_at: lastTimestamp || firstTimestamp || new Date().toISOString(),
    summary: hasSessionMeta ? 'Codex Session' : (firstUserMessage ? summarizeText(firstUserMessage) : 'Codex Session'),
    title: hasSessionMeta ? 'Codex Session' : (firstUserMessage ? summarizeText(firstUserMessage) : 'Codex Session'),
    routeTitle: lastUserMessage ? summarizeText(lastUserMessage, 20, false) : 'Codex Session',
    messageCount,
    messageCountKnown: true,
    filePath,
    sessionFileName,
    sourceSessionId,
    thread,
  };
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
    sessionFileName,
  };
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
    return { messages: [], total: 0, hasMore: false, offset: 0, limit, nextRawLineOffset: 0 };
  }
  const messages: LooseRecord[] = [];
  const userEchoKeys = new Set<string>();
  const transcript = await readJsonlRecordsForMessages(filePath, afterLine);
  for (const { record, lineNumber } of transcript.records) {
    for (const message of codexRecordToMessages(record, String(sessionId), lineNumber)) {
      if (message.type === 'user') {
        const content = String(message.message?.content || '').trim();
        if (content && userEchoKeys.has(content)) {
          continue;
        }
        if (content) {
          userEchoKeys.add(content);
        }
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
    return { messages: [], total: 0, hasMore: false, offset: 0, limit, nextRawLineOffset: 0 };
  }
  const messages: LooseRecord[] = [];
  const transcript = await readJsonlRecordsForMessages(filePath, afterLine);
  for (const { record, lineNumber } of transcript.records) {
    messages.push(...piRecordToMessages(record, String(sessionId), lineNumber));
  }
  return paginateMessages(messages, limit, offset, transcript.totalLines);
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
 * Convert one Codex JSONL record to normalized message rows.
 */
function codexRecordToMessages(record: LooseRecord, sessionId: string, lineNumber: number): LooseRecord[] {
  if (record.type === 'event_msg' && record.payload?.type === 'user_message') {
    const content = stringifyMessageContent(record.payload.message);
    return content ? [{
      type: 'user',
      provider: 'codex',
      timestamp: record.timestamp,
      messageKey: `codex:${sessionId}:line:${lineNumber}:msg:0`,
      message: { role: 'user', content },
    }] : [];
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
    const content = stringifyMessageContent(record.payload.content);
    return content ? [{
      type: 'user',
      provider: 'codex',
      timestamp: record.timestamp,
      messageKey: `codex:${sessionId}:line:${lineNumber}:msg:0`,
      message: { role: 'user', content },
    }] : [];
  }
  if (record.type === 'response_item' && record.payload?.type === 'update' && record.payload?.update?.type === 'functionCall') {
    const update = record.payload.update;
    const callId = String(update.id || update.call_id || update.callId || '');
    return [{
      type: 'tool_use',
      provider: 'codex',
      timestamp: record.timestamp,
      messageKey: `codex:${sessionId}:line:${lineNumber}:tool:${callId || 'call'}`,
      toolName: String(update.name || 'UnknownTool'),
      toolInput: update.arguments ?? update.input ?? '',
      toolCallId: callId || undefined,
      status: update.status,
    }];
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
  if (record.type === 'response_item' && record.payload?.type === 'function_call') {
    const callId = String(record.payload.call_id || record.payload.callId || record.payload.id || '');
    return [{
      type: 'tool_use',
      provider: 'codex',
      timestamp: record.timestamp,
      messageKey: `codex:${sessionId}:line:${lineNumber}:tool:${callId || 'call'}`,
      toolName: String(record.payload.name || 'UnknownTool'),
      toolInput: record.payload.arguments ?? record.payload.input ?? '',
      toolCallId: callId || undefined,
      status: record.payload.status,
    }];
  }
  if (record.type === 'response_item' && record.payload?.type === 'function_call_output') {
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
