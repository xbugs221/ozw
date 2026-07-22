/**
 * Read-only projection of local Hermes SQLite history.
 * Database paths are discovered server-side; explicit homes exist for tests only.
 */
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import Database from 'better-sqlite3';

type HermesHome = { scope: string; dbPath: string; displayName?: string };
type ReadOptions = { homes?: HermesHome[]; includeHidden?: boolean; limit?: number; cursor?: string | null };
type Diagnostic = { scope: string; status: 'ready' | 'missing' | 'incompatible' | 'error'; schemaVersion?: number; message?: string };
type Row = Record<string, any>;
type HistoryCursor = {
  version: 1;
  scope: string;
  sessionId: string;
  beforeId: number;
  snapshotMaxId: number;
  snapshotTotal: number;
  consumed: number;
};
type OwnershipResolution = { path: string; source: 'git_repo_root' | 'cwd' | null };

const REQUIRED_SESSION_COLUMNS = ['id', 'source', 'started_at'];
const REQUIRED_MESSAGE_COLUMNS = ['id', 'session_id', 'role', 'content', 'timestamp'];
export const HERMES_HISTORY_MAX_ROW_BYTES = 64 * 1024;
export const HERMES_HISTORY_MAX_PAGE_BYTES = 512 * 1024;
const HERMES_HISTORY_MAX_FIELD_BYTES = 48 * 1024;
const HERMES_TITLE_MAX_BYTES = 256;
const HERMES_HISTORY_PAGE_MARKER_RESERVE_BYTES = 1024;
const HERMES_HISTORY_ROW_MARKER_RESERVE_BYTES = 512;

function encodeScopedIdentityPart(value: string): string {
  return encodeURIComponent(value).replace(/~/g, '%7E');
}

export function encodeHermesScopedId(scope: string, sessionId: string): string {
  return `${encodeScopedIdentityPart(scope)}~${encodeScopedIdentityPart(sessionId)}`;
}

export function decodeHermesScopedId(value: string): { providerScope: string; providerSessionId: string } | null {
  const separator = value.indexOf('~');
  if (separator <= 0 || value.indexOf('~', separator + 1) !== -1) return null;
  try {
    const providerScope = decodeURIComponent(value.slice(0, separator));
    const providerSessionId = decodeURIComponent(value.slice(separator + 1));
    return providerScope && providerSessionId ? { providerScope, providerSessionId } : null;
  } catch {
    return null;
  }
}

function normalizeFsPath(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw ? path.resolve(raw).replace(/[\\/]+$/, '') : '';
}

function pathBelongsToProject(candidatePath: string, projectPath: string): boolean {
  const normalizedProject = normalizeFsPath(projectPath);
  if (!candidatePath || !normalizedProject) return false;
  const relative = path.relative(normalizedProject, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function discoverHomes(): Promise<HermesHome[]> {
  const root = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');
  const homes: HermesHome[] = [{ scope: 'default', dbPath: path.join(root, 'state.db'), displayName: 'Default' }];
  const profilesRoot = path.join(root, 'profiles');
  try {
    for (const entry of await fs.readdir(profilesRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) homes.push({ scope: entry.name, dbPath: path.join(profilesRoot, entry.name, 'state.db'), displayName: entry.name });
    }
  } catch { /* profiles are optional */ }
  return homes;
}

function columns(db: Database.Database, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((row) => String(row.name)));
}

function openHome(home: HermesHome): { db: Database.Database; schemaVersion: number; sessionColumns: Set<string>; messageColumns: Set<string> } {
  const db = new Database(home.dbPath, { readonly: true, fileMustExist: true });
  try {
    const sessionColumns = columns(db, 'sessions');
    const messageColumns = columns(db, 'messages');
    if (REQUIRED_SESSION_COLUMNS.some((name) => !sessionColumns.has(name)) || REQUIRED_MESSAGE_COLUMNS.some((name) => !messageColumns.has(name))) {
      throw new Error('required Hermes tables or columns are absent');
    }
    const schemaVersion = Number((db.prepare('SELECT version FROM schema_version LIMIT 1').get() as Row | undefined)?.version);
    if (!Number.isFinite(schemaVersion) || schemaVersion < 16) throw new Error(`unsupported schema version ${schemaVersion}`);
    return { db, schemaVersion, sessionColumns, messageColumns };
  } catch (error) {
    db.close();
    throw error;
  }
}

function diagnosticFromError(scope: string, error: any): Diagnostic {
  if (error?.code === 'SQLITE_CANTOPEN') return { scope, status: 'missing', message: 'Hermes database is unavailable' };
  if (error?.code === 'SQLITE_BUSY' || error?.code === 'SQLITE_LOCKED') return { scope, status: 'error', message: 'Hermes database is busy' };
  const rawMessage = String(error?.message || '');
  const versionMatch = rawMessage.match(/unsupported schema version ([\w.-]+)/i);
  return {
    scope,
    status: 'incompatible',
    message: versionMatch ? `Unsupported Hermes schema version ${versionMatch[1]}` : 'Hermes schema is incompatible',
  };
}

function selectSessions(db: Database.Database, available: Set<string>): Row[] {
  const optional = ['model', 'parent_session_id', 'ended_at', 'end_reason', 'message_count', 'tool_call_count', 'cwd', 'git_repo_root', 'title', 'archived', 'model_config'];
  const projection = [...REQUIRED_SESSION_COLUMNS, ...optional.filter((name) => available.has(name))];
  return db.prepare(`SELECT ${projection.join(', ')} FROM sessions ORDER BY started_at DESC, id DESC`).all() as Row[];
}

function isDelegate(row: Row): boolean {
  if (row.source === 'tool') return true;
  if (typeof row.model_config !== 'string') return false;
  try {
    const config = JSON.parse(row.model_config);
    return Boolean(config?._delegate_from);
  } catch { return false; }
}

function sessionModelConfig(row: Row): Row {
  if (typeof row.model_config !== 'string') return {};
  try {
    const value = JSON.parse(row.model_config);
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}

function isBranch(row: Row): boolean {
  return Boolean(sessionModelConfig(row)._branched_from);
}

function isCompressionContinuation(child: Row, parent: Row | undefined): boolean {
  return Boolean(parent && parent.end_reason === 'compression' && !isDelegate(child) && !isBranch(child));
}

function isCompressionParent(row: Row, children: Map<string, Row[]>): boolean {
  return row.end_reason === 'compression'
    && (children.get(String(row.id)) || []).some((child) => isCompressionContinuation(child, row));
}

function truncateUtf8Prefix(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length <= maxBytes) return value;
  const suffix = '…';
  const available = Math.max(0, maxBytes - Buffer.byteLength(suffix));
  return `${encoded.subarray(0, available).toString('utf8').replace(/\uFFFD$/u, '')}${suffix}`;
}

function titleFor(row: Row, firstVisibleUserText: string): string {
  const explicit = typeof row.title === 'string' ? row.title.trim() : '';
  const fallback = firstVisibleUserText.replace(/\s+/g, ' ').trim();
  return truncateUtf8Prefix(explicit || fallback || 'Hermes Session', HERMES_TITLE_MAX_BYTES);
}

function projectSession(
  row: Row,
  home: HermesHome,
  messageActivityAt: number | null,
  ownershipPath: string,
  firstVisibleUserText: string,
): Row {
  const activityAt = messageActivityAt ?? Number(row.ended_at || row.started_at);
  return {
    id: encodeHermesScopedId(home.scope, String(row.id)),
    providerSessionId: String(row.id),
    providerScope: home.scope,
    provider: 'hermes',
    __provider: 'hermes',
    title: titleFor(row, firstVisibleUserText),
    model: typeof row.model === 'string' ? row.model : '',
    source: row.source,
    projectPath: ownershipPath,
    createdAt: new Date(Number(row.started_at) * 1000).toISOString(),
    created_at: new Date(Number(row.started_at) * 1000).toISOString(),
    updated_at: new Date(activityAt * 1000).toISOString(),
    messageCount: Number(row.message_count || 0),
    toolCallCount: Number(row.tool_call_count || 0),
    archived: Number(row.archived || 0) === 1,
    readOnly: true,
  };
}

function latestMessageActivity(db: Database.Database, available: Set<string>): Map<string, number> {
  const active = available.has('active') ? ' WHERE active = 1' : '';
  const rows = db.prepare(`
    SELECT messages.session_id, messages.timestamp
    FROM messages
    INNER JOIN (
      SELECT session_id, MAX(id) AS latest_id
      FROM messages${active}
      GROUP BY session_id
    ) latest ON latest.session_id = messages.session_id AND latest.latest_id = messages.id
  `).all() as Row[];
  return new Map(rows.map((row) => [String(row.session_id), Number(row.timestamp)]));
}

function firstVisibleUserMessages(db: Database.Database, available: Set<string>): Map<string, { id: number; content: string }> {
  const active = available.has('active') ? ' AND active = 1' : '';
  const rows = db.prepare(`
    SELECT messages.session_id, messages.id, messages.content
    FROM messages
    INNER JOIN (
      SELECT session_id, MIN(id) AS first_id
      FROM messages
      WHERE role = 'user' AND content IS NOT NULL AND TRIM(content) != ''${active}
      GROUP BY session_id
    ) first_user ON first_user.session_id = messages.session_id AND first_user.first_id = messages.id
  `).all() as Row[];
  return new Map(rows.map((row) => [String(row.session_id), { id: Number(row.id), content: String(row.content || '') }]));
}

type PathAvailability = (candidatePath: string) => Promise<boolean>;

async function listMatching(
  predicate: (row: Row, ownership: OwnershipResolution) => boolean | Promise<boolean>,
  options: ReadOptions = {},
) {
  const homes = options.homes || await discoverHomes();
  const sessions: Row[] = [];
  const diagnostics: Diagnostic[] = [];
  const pathAvailability = new Map<string, Promise<boolean>>();
  const pathAvailable: PathAvailability = (candidatePath) => {
    const normalized = normalizeFsPath(candidatePath);
    if (!normalized) return Promise.resolve(false);
    const existing = pathAvailability.get(normalized);
    if (existing) return existing;
    const pending = fs.stat(normalized).then((stat) => stat.isDirectory()).catch(() => false);
    pathAvailability.set(normalized, pending);
    return pending;
  };
  const resolveOwnership = async (row: Row): Promise<OwnershipResolution> => {
    const repositoryRoot = normalizeFsPath(row.git_repo_root);
    if (repositoryRoot && await pathAvailable(repositoryRoot)) {
      return { path: repositoryRoot, source: 'git_repo_root' };
    }
    const cwd = normalizeFsPath(row.cwd);
    if (cwd && await pathAvailable(cwd)) {
      return { path: cwd, source: 'cwd' };
    }
    return { path: '', source: null };
  };
  for (const home of homes) {
    let opened: ReturnType<typeof openHome> | null = null;
    try {
      opened = openHome(home);
      const rows = selectSessions(opened.db, opened.sessionColumns);
      const messageActivity = latestMessageActivity(opened.db, opened.messageColumns);
      const firstUserMessages = firstVisibleUserMessages(opened.db, opened.messageColumns);
      const children = new Map<string, Row[]>();
      for (const row of rows) {
        if (!row.parent_session_id) continue;
        const key = String(row.parent_session_id);
        children.set(key, [...(children.get(key) || []), row]);
      }
      const matchingRows = await Promise.all(rows.map(async (row) => {
        const ownership = await resolveOwnership(row);
        return { row, ownership, matches: await predicate(row, ownership) };
      }));
      for (const { row, ownership, matches } of matchingRows) {
        if (!options.includeHidden && Number(row.archived || 0) === 1) continue;
        if (isDelegate(row) || isCompressionParent(row, children) || !matches) continue;
        const activityAt = lineage(rows, String(row.id))
          .map((sessionId) => messageActivity.get(sessionId))
          .filter((value): value is number => Number.isFinite(value))
          .reduce<number | null>((latest, value) => latest === null ? value : Math.max(latest, value), null);
        const firstVisibleUserText = lineage(rows, String(row.id))
          .map((sessionId) => firstUserMessages.get(sessionId))
          .filter((value): value is { id: number; content: string } => Boolean(value))
          .sort((left, right) => left.id - right.id)
          .map((value) => decodeStructuredContent(value.content))
          .find((value) => Boolean(value.trim())) || '';
        sessions.push(projectSession(row, home, activityAt, ownership.path, firstVisibleUserText));
      }
      diagnostics.push({ scope: home.scope, status: 'ready', schemaVersion: opened.schemaVersion });
    } catch (error: any) {
      // Hermes is an optional, read-only integration. A configured profile can
      // disappear when Hermes is not installed or its local state is cleaned.
      // Do not turn that expected absence into a workspace-wide warning.
      const diagnostic = diagnosticFromError(home.scope, error);
      if (diagnostic.status !== 'missing') diagnostics.push(diagnostic);
    } finally {
      opened?.db.close();
    }
  }
  sessions.sort((left, right) => {
    const activityDelta = new Date(String(right.updated_at || right.createdAt || 0)).getTime()
      - new Date(String(left.updated_at || left.createdAt || 0)).getTime();
    return activityDelta || String(right.id).localeCompare(String(left.id));
  });
  return { sessions: sessions.slice(0, options.limit || Number.MAX_SAFE_INTEGER), diagnostics };
}

export function listHermesSessionsForProject(projectPath: string, options: ReadOptions = {}) {
  return listMatching((_row, ownership) => {
    if (ownership.source === 'git_repo_root') {
      return ownership.path === normalizeFsPath(projectPath);
    }
    return ownership.source === 'cwd' && pathBelongsToProject(ownership.path, projectPath);
  }, options);
}

export function listUnscopedHermesSessions(options: ReadOptions = {}) {
  return listMatching((_row, ownership) => ownership.source === null, options);
}

export function listHermesSessions(options: ReadOptions = {}) {
  return listMatching(() => true, options);
}

function decodeStructuredContent(content: unknown): string {
  if (typeof content !== 'string') return '';
  if (!content.startsWith('\0json:')) return content;
  try {
    const parts = JSON.parse(content.slice(6));
    if (!Array.isArray(parts)) return '';
    return parts.map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text' && typeof part.text === 'string') return part.text;
      if (String(part?.type || '').match(/image|file|media/)) return '[Hermes media omitted]';
      return '';
    }).filter(Boolean).join('\n');
  } catch { return '[Invalid structured Hermes content]'; }
}

function isCompressionUserEcho(older: Row, newer: Row, sessionIds: string[]): boolean {
  if (older.role !== 'user' || newer.role !== 'user') return false;
  const olderSessionIndex = sessionIds.indexOf(String(older.session_id));
  const newerSessionIndex = sessionIds.indexOf(String(newer.session_id));
  if (olderSessionIndex < 0 || newerSessionIndex !== olderSessionIndex + 1) return false;
  const olderContent = decodeStructuredContent(older.content).trim();
  const newerContent = decodeStructuredContent(newer.content).trim();
  return Boolean(olderContent && olderContent === newerContent);
}

function lineage(rows: Row[], tipId: string): string[] {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const result: string[] = [];
  const seen = new Set<string>();
  let current: Row | undefined = byId.get(tipId);
  while (current && !seen.has(String(current.id))) {
    const id = String(current.id);
    seen.add(id);
    result.unshift(id);
    const parent = current.parent_session_id ? byId.get(String(current.parent_session_id)) : undefined;
    // parent_session_id also represents ordinary branches and delegates.  Only a
    // parent that ended by compression is a display-history continuation.
    current = isCompressionContinuation(current, parent) ? parent : undefined;
  }
  return result;
}

function encodeHistoryCursor(value: HistoryCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeHistoryCursor(value: string, identity: { providerScope: string; providerSessionId: string }): HistoryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as HistoryCursor;
    const validNumbers = [parsed.beforeId, parsed.snapshotMaxId, parsed.snapshotTotal, parsed.consumed]
      .every((item) => Number.isSafeInteger(item) && item >= 0);
    const validProgress = parsed.beforeId <= parsed.snapshotMaxId + 1 && parsed.consumed <= parsed.snapshotTotal;
    if (parsed.version !== 1 || parsed.scope !== identity.providerScope || parsed.sessionId !== identity.providerSessionId || !validNumbers || !validProgress) {
      throw new Error('cursor identity mismatch');
    }
    return parsed;
  } catch {
    throw new Error('Invalid Hermes history cursor');
  }
}

function messageRows(
  db: Database.Database,
  available: Set<string>,
  sessionIds: string[],
  limit: number,
  cursor: HistoryCursor | null,
): { rows: Row[]; total: number; pageRowCount: number; oldestRowId: number | null; newestRowId: number | null; hasMore: boolean; snapshotMaxId: number; consumed: number } {
  const optional = ['tool_call_id', 'tool_calls', 'tool_name', 'finish_reason', 'reasoning', 'reasoning_content', 'reasoning_details', 'active', 'effect_disposition', 'compacted'];
  const projection = [...REQUIRED_MESSAGE_COLUMNS, ...optional.filter((name) => available.has(name))];
  const active = available.has('active') ? ' AND active = 1' : '';
  const placeholders = sessionIds.map(() => '?').join(', ');
  const snapshot = cursor || (() => {
    const row = db.prepare(`SELECT COUNT(*) AS count, COALESCE(MAX(id), 0) AS maxId FROM messages WHERE session_id IN (${placeholders})${active}`).get(...sessionIds) as Row;
    return {
      snapshotTotal: Number(row.count || 0),
      snapshotMaxId: Number(row.maxId || 0),
      beforeId: Number(row.maxId || 0) + 1,
      consumed: 0,
    };
  })();
  const candidateRows = db.prepare(`SELECT ${projection.join(', ')} FROM messages WHERE session_id IN (${placeholders})${active} AND id < ? AND id <= ? ORDER BY id DESC LIMIT ?`)
    .all(...sessionIds, snapshot.beforeId, snapshot.snapshotMaxId, limit) as Row[];
  const pageRows: Row[] = [];
  let estimatedPageBytes = 2;
  const appendWithinPageBudget = (row: Row): boolean => {
    const rawStringBytes = projection.reduce((total, column) => (
      typeof row[column] === 'string' ? total + Buffer.byteLength(row[column], 'utf8') : total
    ), 0);
    const estimatedRowBytes = Math.min(HERMES_HISTORY_MAX_ROW_BYTES, 1024 + (rawStringBytes * 2));
    if (
      pageRows.length > 0
      && estimatedPageBytes + estimatedRowBytes > HERMES_HISTORY_MAX_PAGE_BYTES - HERMES_HISTORY_PAGE_MARKER_RESERVE_BYTES
    ) return false;
    pageRows.push(row);
    estimatedPageBytes += estimatedRowBytes;
    return true;
  };
  for (const row of candidateRows) {
    if (!appendWithinPageBudget(row)) break;
  }
  const declaredToolCalls = new Set<string>();
  const pendingToolResults = new Set<string>();
  const collectToolLinks = (row: Row) => {
    if (row.role === 'assistant' && typeof row.tool_calls === 'string') {
      try {
        const calls = JSON.parse(row.tool_calls);
        if (Array.isArray(calls)) {
          for (const call of calls) {
            const id = String(call?.id || '');
            if (id) {
              declaredToolCalls.add(id);
              pendingToolResults.delete(id);
            }
          }
        }
      } catch { /* malformed tool payload cannot establish a result link */ }
    }
    if (row.role === 'tool') {
      const id = String(row.tool_call_id || '');
      if (id && !declaredToolCalls.has(id)) pendingToolResults.add(id);
    }
  };
  pageRows.forEach(collectToolLinks);
  let scanBeforeId = pageRows.length ? Number(pageRows[pageRows.length - 1].id) : snapshot.beforeId;
  while (pageRows.length > 0 && pendingToolResults.size > 0) {
    const olderRows = db.prepare(`SELECT ${projection.join(', ')} FROM messages WHERE session_id IN (${placeholders})${active} AND id < ? AND id <= ? ORDER BY id DESC LIMIT 100`)
      .all(...sessionIds, scanBeforeId, snapshot.snapshotMaxId) as Row[];
    if (olderRows.length === 0) break;
    for (const row of olderRows) {
      if (!appendWithinPageBudget(row)) {
        pendingToolResults.clear();
        break;
      }
      collectToolLinks(row);
      scanBeforeId = Number(row.id);
      if (pendingToolResults.size === 0) break;
    }
  }
  while (pageRows.length > 0) {
    const oldestPageRow = pageRows[pageRows.length - 1];
    if (oldestPageRow.role !== 'user') break;
    const olderRow = db.prepare(`SELECT ${projection.join(', ')} FROM messages WHERE session_id IN (${placeholders})${active} AND id < ? AND id <= ? ORDER BY id DESC LIMIT 1`)
      .get(...sessionIds, Number(oldestPageRow.id), snapshot.snapshotMaxId) as Row | undefined;
    if (!olderRow || !isCompressionUserEcho(olderRow, oldestPageRow, sessionIds)) break;
    pageRows.push(olderRow);
  }
  const pageRowCount = pageRows.length;
  const oldestRowId = pageRows.length ? Number(pageRows[pageRows.length - 1].id) : null;
  const hasMore = oldestRowId !== null && Boolean(db.prepare(`SELECT 1 FROM messages WHERE session_id IN (${placeholders})${active} AND id < ? AND id <= ? LIMIT 1`)
    .get(...sessionIds, oldestRowId, snapshot.snapshotMaxId));
  const rows = pageRows.reverse();
  return {
    rows,
    total: snapshot.snapshotTotal,
    pageRowCount,
    oldestRowId,
    newestRowId: rows.length ? Number(rows[rows.length - 1].id) : null,
    hasMore,
    snapshotMaxId: snapshot.snapshotMaxId,
    consumed: snapshot.consumed + pageRowCount,
  };
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function boundedText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value : String(value || '');
  const bytes = Buffer.byteLength(text, 'utf8');
  return bytes <= HERMES_HISTORY_MAX_FIELD_BYTES
    ? text
    : `[Hermes ${label} truncated: ${bytes} UTF-8 bytes exceeds ${HERMES_HISTORY_MAX_FIELD_BYTES}-byte field limit]`;
}

function boundedToolInput(value: unknown): unknown {
  const bytes = byteLength(value);
  return bytes <= HERMES_HISTORY_MAX_FIELD_BYTES
    ? value
    : {
      truncated: true,
      message: `[Hermes tool input truncated: ${bytes} UTF-8 bytes exceeds ${HERMES_HISTORY_MAX_FIELD_BYTES}-byte field limit]`,
    };
}

function normalizeRows(rows: Row[], scope: string, sessionId: string, sessionIds: string[]): Row[] {
  const rowParts: Array<{ row: Row; messages: Row[] }> = [];
  const pageToolCallIds = new Set<string>();
  for (const row of rows) {
    if (row.role !== 'assistant' || typeof row.tool_calls !== 'string') continue;
    try {
      const calls = JSON.parse(row.tool_calls);
      if (Array.isArray(calls)) {
        calls.forEach((call) => {
          const id = String(call?.id || '');
          if (id) pageToolCallIds.add(id);
        });
      }
    } catch { /* malformed tool payload cannot establish a result link */ }
  }
  const decorate = (row: Row, part: string, value: Row) => ({ ...value, provider: 'hermes', messageKey: `hermes:${scope}:${sessionId}:${row.id}:${part}`, timestamp: new Date(Number(row.timestamp) * 1000).toISOString() });
  let previousRow: Row | null = null;
  for (const row of rows) {
    const parts: Row[] = [];
    const push = (part: string, value: Row) => parts.push(decorate(row, part, value));
    const content = boundedText(decodeStructuredContent(row.content), `${String(row.role || 'message')} content`);
    if (row.role === 'user' && content && !(previousRow && isCompressionUserEcho(previousRow, row, sessionIds))) {
      push('message', { type: 'message', message: { role: 'user', content } });
    }
    if (row.role === 'assistant') {
      const reasoningValues = [row.reasoning, row.reasoning_content, row.reasoning_details].filter((value, index, all) => typeof value === 'string' && value.trim() && all.indexOf(value) === index);
      reasoningValues.forEach((reasoning, index) => push(`thinking-${index}`, { type: 'thinking', message: { role: 'assistant', content: boundedText(reasoning, 'reasoning') } }));
      if (typeof row.tool_calls === 'string' && row.tool_calls) {
        try {
          const calls = JSON.parse(row.tool_calls);
          if (Array.isArray(calls)) calls.forEach((call, index) => {
            let input: unknown = call?.function?.arguments ?? call?.arguments ?? {};
            if (typeof input === 'string') { try { input = JSON.parse(input); } catch { /* retain raw input */ } }
            const hermesToolName = String(call?.function?.name || call?.name || 'tool');
            const toolName = hermesToolName === 'terminal' ? 'exec_command' : hermesToolName;
            push(`tool-${index}`, { type: 'tool_use', toolCallId: String(call?.id || `${row.id}-${index}`), toolName, hermesToolName, toolInput: boundedToolInput(input) });
          });
        } catch { /* malformed tool payload is safely ignored */ }
      }
      if (content) push('assistant', { type: 'assistant', message: { role: 'assistant', content } });
    }
    if (row.role === 'tool') {
      push('tool-result', { type: 'tool_result', toolCallId: String(row.tool_call_id || ''), toolName: String(row.tool_name || ''), output: boundedText(content, 'tool result'), effectDisposition: row.effect_disposition || undefined });
    }
    const boundedParts: Row[] = [];
    let usedRowBytes = 2;
    for (const part of parts) {
      const partBytes = byteLength(part) + (boundedParts.length > 0 ? 1 : 0);
      if (usedRowBytes + partBytes > HERMES_HISTORY_MAX_ROW_BYTES - HERMES_HISTORY_ROW_MARKER_RESERVE_BYTES) {
        const marker = decorate(row, 'row-truncated', {
          type: 'assistant',
          message: { role: 'assistant', content: `[Hermes row truncated: normalized output exceeds ${HERMES_HISTORY_MAX_ROW_BYTES}-byte row limit]` },
        });
        if (usedRowBytes + byteLength(marker) + 1 <= HERMES_HISTORY_MAX_ROW_BYTES) boundedParts.push(marker);
        break;
      }
      boundedParts.push(part);
      usedRowBytes += partBytes;
    }
    rowParts.push({ row, messages: boundedParts });
    previousRow = row;
  }
  const emittedToolCallIds = new Set(rowParts.flatMap(({ messages }) => messages
    .filter((message) => message.type === 'tool_use')
    .map((message) => String(message.toolCallId || ''))));
  const candidates = rowParts.flatMap(({ messages }) => messages).map((message) => {
    if (message.type !== 'tool_result' || emittedToolCallIds.has(String(message.toolCallId || ''))) {
      return message;
    }
    const { output: _output, toolCallId: _toolCallId, toolName: _toolName, effectDisposition: _effectDisposition, ...base } = message;
    return {
      ...base,
      type: 'assistant',
      message: {
        role: 'assistant',
        content: '[Hermes tool result omitted: matching tool call is unavailable within this page budget]',
      },
    };
  });
  const result: Row[] = [];
  let usedPageBytes = 2;
  for (const message of candidates) {
    const messageBytes = byteLength(message) + (result.length > 0 ? 1 : 0);
      if (usedPageBytes + messageBytes > HERMES_HISTORY_MAX_PAGE_BYTES - HERMES_HISTORY_PAGE_MARKER_RESERVE_BYTES) {
      const boundary = rows.length ? `${rows[0].id}-${rows[rows.length - 1].id}` : 'empty';
      const marker = {
        type: 'assistant',
        message: { role: 'assistant', content: `[Hermes page truncated: normalized output exceeds ${HERMES_HISTORY_MAX_PAGE_BYTES}-byte page limit]` },
        provider: 'hermes',
        messageKey: `hermes:${scope}:${sessionId}:${boundary}:page-truncated`,
        timestamp: rows.length ? new Date(Number(rows[rows.length - 1].timestamp) * 1000).toISOString() : new Date(0).toISOString(),
      };
      if (usedPageBytes + byteLength(marker) + 1 <= HERMES_HISTORY_MAX_PAGE_BYTES) result.push(marker);
      break;
    }
    result.push(message);
    usedPageBytes += messageBytes;
  }
  return result;
}

export async function getHermesSessionMessages(identity: { providerScope: string; providerSessionId: string }, options: ReadOptions = {}) {
  const homes = options.homes || await discoverHomes();
  const home = homes.find((candidate) => candidate.scope === identity.providerScope);
  if (!home) throw new Error(`Unknown Hermes profile: ${identity.providerScope}`);
  const opened = openHome(home);
  try {
    const sessions = selectSessions(opened.db, opened.sessionColumns);
    if (!sessions.some((row) => String(row.id) === identity.providerSessionId)) throw new Error('Hermes session not found');
    const sessionIds = lineage(sessions, identity.providerSessionId);
    const limit = Math.max(1, Math.min(options.limit || 1000, 5000));
    const cursor = options.cursor ? decodeHistoryCursor(options.cursor, identity) : null;
    const page = messageRows(opened.db, opened.messageColumns, sessionIds, limit, cursor);
    const nextCursor = page.hasMore && page.oldestRowId !== null
      ? encodeHistoryCursor({
        version: 1,
        scope: identity.providerScope,
        sessionId: identity.providerSessionId,
        beforeId: page.oldestRowId,
        snapshotMaxId: page.snapshotMaxId,
        snapshotTotal: page.total,
        consumed: page.consumed,
      })
      : null;
    return {
      messages: normalizeRows(page.rows, identity.providerScope, identity.providerSessionId, sessionIds),
      total: page.total,
      hasMore: page.hasMore,
      nextMessageOffset: page.consumed,
      nextCursor,
      appendCursor: page.newestRowId === null ? null : String(page.newestRowId),
      diagnostics: [{ scope: home.scope, status: 'ready', schemaVersion: opened.schemaVersion }],
    };
  } finally {
    opened.db.close();
  }
}

export const __hermesReadModelForTest = { scopedId: encodeHermesScopedId, discoverHomes };
