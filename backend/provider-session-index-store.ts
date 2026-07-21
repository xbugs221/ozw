/**
 * PURPOSE: Persist provider JSONL session headers as a SQLite read model so
 * project overview can query recent sessions without cold-scanning history.
 */
import path from 'path';

type ProviderSessionIndexRecord = {
  provider: string;
  id: string;
  sourceSessionId?: string | null;
  origin?: 'manual' | 'workflow' | string | null;
  projectPath: string;
  summary?: string | null;
  title?: string | null;
  routeTitle?: string | null;
  model?: string | null;
  thread?: string | null;
  sessionFileName?: string | null;
  filePath: string;
  createdAt?: string | Date | null;
  lastActivity?: string | Date | null;
  messageCount?: number | null;
  messageCountKnown?: boolean | null;
  fileMtimeMs?: number | null;
};

type ProviderSessionIndexRow = {
  provider: string;
  session_id: string;
  source_session_id: string | null;
  origin: string | null;
  project_path: string;
  summary: string | null;
  title: string | null;
  route_title: string | null;
  model: string | null;
  thread: string | null;
  session_file_name: string | null;
  file_path: string;
  created_at: string | null;
  last_activity: string;
  message_count: number | null;
  message_count_known: number;
  manual_pending?: number;
};

const schemaReadyDbs = new WeakSet<object>();

/**
 * Normalize dates before writing SQLite text columns.
 */
function toIsoString(value: unknown): string | null {
  /**
   * PURPOSE: Store comparable timestamps while accepting Date or provider
   * string values from existing read models.
   */
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value.trim() : parsed.toISOString();
  }
  return null;
}

/**
 * Normalize project paths the same way provider indexes compare them.
 */
function normalizeProjectPath(projectPath: string): string {
  /**
   * PURPOSE: Keep DB lookups stable across relative/absolute path variants.
   */
  const trimmed = String(projectPath || '').trim();
  if (!trimmed) {
    return '';
  }
  const resolved = path.resolve(trimmed);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Keep origin values limited to the routing contract understood by ozw.
 */
function normalizeSessionOrigin(origin: unknown): 'manual' | 'workflow' | null {
  /**
   * PURPOSE: Persist only known session ownership labels so unknown provider
   * metadata cannot accidentally hide legitimate manual sessions.
   */
  return origin === 'manual' || origin === 'workflow' ? origin : null;
}

/**
 * Create the provider session index table when tests or old installs have not
 * run the latest init.sql yet.
 */
function ensureProviderSessionIndexSchema(db: any): void {
  /**
   * PURPOSE: Make the read model self-healing for existing user databases.
   */
  if (schemaReadyDbs.has(db)) {
    return;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_session_index (
      provider TEXT NOT NULL,
      session_id TEXT NOT NULL,
      source_session_id TEXT,
      origin TEXT,
      project_path TEXT NOT NULL,
      normalized_project_path TEXT NOT NULL,
      summary TEXT,
      title TEXT,
      route_title TEXT,
      model TEXT,
      thread TEXT,
      session_file_name TEXT,
      file_path TEXT NOT NULL,
      created_at TEXT,
      last_activity TEXT NOT NULL,
      message_count INTEGER,
      message_count_known INTEGER DEFAULT 0,
      file_mtime_ms REAL DEFAULT 0,
      activity_revision INTEGER NOT NULL DEFAULT 1,
      indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_provider_session_project_recent
      ON provider_session_index(provider, normalized_project_path, last_activity DESC);
    CREATE INDEX IF NOT EXISTS idx_provider_session_file
      ON provider_session_index(provider, file_path);
    CREATE TABLE IF NOT EXISTS session_attention_ack (
      provider TEXT NOT NULL,
      session_id TEXT NOT NULL,
      handled_revision INTEGER NOT NULL DEFAULT 0,
      manual_pending INTEGER NOT NULL DEFAULT 0,
      legacy_pending_migrated INTEGER NOT NULL DEFAULT 0,
      handled_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, session_id)
    );
  `);
  const columns = db.prepare('PRAGMA table_info(provider_session_index)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has('origin')) {
    db.exec('ALTER TABLE provider_session_index ADD COLUMN origin TEXT');
  }
  if (!columnNames.has('route_title')) {
    db.exec('ALTER TABLE provider_session_index ADD COLUMN route_title TEXT');
  }
  if (!columnNames.has('activity_revision')) {
    db.exec('ALTER TABLE provider_session_index ADD COLUMN activity_revision INTEGER NOT NULL DEFAULT 1');
  }
  const ackColumns = db.prepare('PRAGMA table_info(session_attention_ack)').all() as Array<{ name: string }>;
  if (!ackColumns.some((column) => column.name === 'legacy_pending_migrated')) {
    db.exec(`
      ALTER TABLE session_attention_ack
        ADD COLUMN legacy_pending_migrated INTEGER NOT NULL DEFAULT 0;
      UPDATE session_attention_ack SET legacy_pending_migrated = 1;
    `);
  }
  schemaReadyDbs.add(db);
}

/**
 * Convert a stored row back to the session-card shape used by projects.ts.
 */
function rowToSession(row: ProviderSessionIndexRow): Record<string, unknown> {
  /**
   * PURPOSE: Keep project overview callers independent from SQLite column
   * naming and preserve provider-specific identity fields.
   */
  const fallbackTitle = row.provider === 'pi' ? 'Pi Session' : row.provider === 'claude' ? 'Claude Session' : 'Codex Session';
  const routeTitle = row.route_title || row.title || row.summary || fallbackTitle;
  return {
    id: row.session_id,
    sourceSessionId: row.source_session_id || undefined,
    origin: normalizeSessionOrigin(row.origin) || undefined,
    summary: row.summary || row.title || row.route_title || fallbackTitle,
    title: row.title || row.route_title || row.summary || fallbackTitle,
    routeTitle,
    messageCount: row.message_count,
    messageCountKnown: row.message_count_known === 1,
    createdAt: row.created_at || undefined,
    lastActivity: row.last_activity,
    updated_at: row.last_activity,
    cwd: row.project_path,
    projectPath: row.project_path,
    model: row.model || undefined,
    thread: row.thread || undefined,
    sessionFileName: row.session_file_name || undefined,
    filePath: row.file_path,
    provider: row.provider,
    __provider: row.provider,
    pending: Number(row.manual_pending || 0) === 1,
  };
}

/**
 * Upsert one provider session header into the SQLite read model.
 */
function upsertProviderSessionIndex(db: any, record: ProviderSessionIndexRecord): void {
  /**
   * PURPOSE: Let JSONL scans incrementally repair the DB read model.
   */
  ensureProviderSessionIndexSchema(db);
  const provider = record.provider;
  const sessionId = String(record.id || '').trim();
  const projectPath = String(record.projectPath || '').trim();
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  const filePath = String(record.filePath || '').trim();
  const lastActivity = toIsoString(record.lastActivity) || toIsoString(record.createdAt) || new Date().toISOString();
  if (!provider || !sessionId || !normalizedProjectPath || !filePath) {
    return;
  }

  db.prepare(`
    INSERT INTO provider_session_index (
      provider,
      session_id,
      source_session_id,
      origin,
      project_path,
      normalized_project_path,
      summary,
      title,
      route_title,
      model,
      thread,
      session_file_name,
      file_path,
      created_at,
      last_activity,
      message_count,
      message_count_known,
      file_mtime_ms,
      activity_revision,
      indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(provider, session_id) DO UPDATE SET
      source_session_id = excluded.source_session_id,
      origin = COALESCE(excluded.origin, provider_session_index.origin),
      project_path = excluded.project_path,
      normalized_project_path = excluded.normalized_project_path,
      summary = excluded.summary,
      title = excluded.title,
      route_title = excluded.route_title,
      model = excluded.model,
      thread = excluded.thread,
      session_file_name = excluded.session_file_name,
      file_path = excluded.file_path,
      created_at = excluded.created_at,
      last_activity = excluded.last_activity,
      message_count = excluded.message_count,
      message_count_known = excluded.message_count_known,
      activity_revision = CASE
        WHEN excluded.file_mtime_ms <> provider_session_index.file_mtime_ms
          THEN provider_session_index.activity_revision + 1
        ELSE provider_session_index.activity_revision
      END,
      file_mtime_ms = excluded.file_mtime_ms,
      indexed_at = CURRENT_TIMESTAMP
  `).run(
    provider,
    sessionId,
    record.sourceSessionId || null,
    normalizeSessionOrigin(record.origin),
    projectPath,
    normalizedProjectPath,
    record.summary || null,
    record.title || record.summary || null,
    record.routeTitle || record.title || record.summary || null,
    record.model || null,
    record.thread || null,
    record.sessionFileName || null,
    filePath,
    toIsoString(record.createdAt),
    lastActivity,
    typeof record.messageCount === 'number' ? record.messageCount : null,
    record.messageCountKnown === true ? 1 : 0,
    typeof record.fileMtimeMs === 'number' ? record.fileMtimeMs : 0,
  );
}

/**
 * Return recent provider sessions for one project from SQLite.
 */
function listProviderSessionsForProject(db: any, provider: string, projectPath: string, limit: number): Record<string, unknown>[] {
  /**
   * PURPOSE: Serve project overview from indexed headers in milliseconds.
   */
  ensureProviderSessionIndexSchema(db);
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  if (!normalizedProjectPath || limit <= 0) {
    return [];
  }
  const rows = db.prepare(`
    SELECT
      p.provider,
      p.session_id,
      p.source_session_id,
      p.origin,
      p.project_path,
      p.summary,
      p.title,
      p.route_title,
      p.model,
      p.thread,
      p.session_file_name,
      p.file_path,
      p.created_at,
      p.last_activity,
      p.message_count,
      p.message_count_known,
      COALESCE(a.manual_pending, 0) AS manual_pending
    FROM provider_session_index p
    LEFT JOIN session_attention_ack a
      ON a.provider = p.provider AND a.session_id = p.session_id
    WHERE p.provider = ? AND p.normalized_project_path = ?
    ORDER BY p.last_activity DESC
    LIMIT ?
  `).all(provider, normalizedProjectPath, limit) as ProviderSessionIndexRow[];
  return rows.map(rowToSession);
}

/**
 * Return the project path currently indexed for one provider session file.
 */
function getProviderSessionProjectPathForFile(db: any, provider: string, filePath: string): string {
  /**
   * PURPOSE: Let unlink watchers repair project_index after the JSONL file has
   * already disappeared from disk.
   */
  ensureProviderSessionIndexSchema(db);
  const row = db.prepare(`
    SELECT project_path
    FROM provider_session_index
    WHERE provider = ? AND file_path = ?
    LIMIT 1
  `).get(provider, String(filePath || '')) as { project_path?: string } | undefined;
  return row?.project_path || '';
}

/**
 * Return the indexed transcript path for one provider session identity.
 */
function getProviderSessionFilePath(db: any, provider: string, sessionId: string): string {
  /**
   * PURPOSE: Let explicit history reads locate one transcript without recursively
   * scanning every provider directory on the request path.
   */
  ensureProviderSessionIndexSchema(db);
  const row = db.prepare(`
    SELECT file_path
    FROM provider_session_index
    WHERE provider = ? AND session_id = ?
    LIMIT 1
  `).get(provider, String(sessionId || '')) as { file_path?: string } | undefined;
  return row?.file_path || '';
}

/**
 * Count remaining provider sessions for a project after an index mutation.
 */
function countProviderSessionsForProject(db: any, projectPath: string): number {
  /**
   * PURPOSE: Avoid hiding a provider project while another transcript for that
   * project still exists.
   */
  ensureProviderSessionIndexSchema(db);
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  if (!normalizedProjectPath) {
    return 0;
  }
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM provider_session_index
    WHERE normalized_project_path = ?
  `).get(normalizedProjectPath) as { count?: number } | undefined;
  return Number(row?.count || 0);
}

/**
 * Remove stale index rows for a deleted or rewritten provider file.
 */
function deleteProviderSessionFile(db: any, provider: string, filePath: string): void {
  /**
   * PURPOSE: Give file watchers a cheap invalidation hook.
   */
  ensureProviderSessionIndexSchema(db);
  db.prepare('DELETE FROM provider_session_index WHERE provider = ? AND file_path = ?')
    .run(provider, String(filePath || ''));
}

const providerSessionIndexDb = {
  ensureSchema: ensureProviderSessionIndexSchema,
  upsert: upsertProviderSessionIndex,
  listForProject: listProviderSessionsForProject,
  getProjectPathForFile: getProviderSessionProjectPathForFile,
  getFilePath: getProviderSessionFilePath,
  countForProject: countProviderSessionsForProject,
  deleteFile: deleteProviderSessionFile,
};

export {
  providerSessionIndexDb,
};
