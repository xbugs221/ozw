/**
 * PURPOSE: Persist project sidebar rows as a SQLite read model so the home
 * project list can load without scanning provider transcript directories.
 */
import path from 'path';

type ProjectIndexRecord = {
  projectId?: string | null;
  name: string;
  displayName: string;
  projectPath: string;
  routePath: string;
  source: 'manual' | 'provider' | string;
  visible?: boolean | number | null;
  visibilityReason?: string | null;
  lastActivity?: string | Date | null;
  syncState?: string | null;
};

type ProjectIndexRow = {
  project_id: string;
  name: string;
  display_name: string;
  project_path: string;
  normalized_project_path: string;
  route_path: string;
  source: string;
  visible: number;
  visibility_reason: string | null;
  last_activity: string | null;
  indexed_at: string | null;
  sync_state: string | null;
};

const schemaReadyDbs = new WeakSet<object>();

/**
 * Store comparable timestamp values while accepting Date and string input.
 */
function toIsoString(value: unknown): string | null {
  /**
   * PURPOSE: Keep project_index ordering stable across manual and provider
   * updates.
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
 * Normalize project paths before identity comparison and DB lookup.
 */
function normalizeProjectPath(projectPath: string): string {
  /**
   * PURPOSE: Match the path identity rules used by existing provider indexes.
   */
  const trimmed = String(projectPath || '').trim();
  if (!trimmed) {
    return '';
  }
  const resolved = path.resolve(trimmed);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Ensure old user databases have the latest project index schema.
 */
function ensureProjectIndexSchema(db: any): void {
  /**
   * PURPOSE: Let tests and existing installs self-heal without a separate
   * migration command.
   */
  if (schemaReadyDbs.has(db)) {
    return;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_index (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      project_path TEXT NOT NULL,
      normalized_project_path TEXT NOT NULL,
      route_path TEXT NOT NULL,
      source TEXT NOT NULL,
      visible INTEGER NOT NULL DEFAULT 1,
      visibility_reason TEXT,
      last_activity TEXT,
      indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      sync_state TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_project_index_visible_recent
      ON project_index(visible, last_activity DESC, indexed_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_index_normalized_path
      ON project_index(normalized_project_path);
  `);
  const columns = db.prepare('PRAGMA table_info(project_index)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has('visibility_reason')) {
    db.exec('ALTER TABLE project_index ADD COLUMN visibility_reason TEXT');
  }
  if (!columnNames.has('sync_state')) {
    db.exec('ALTER TABLE project_index ADD COLUMN sync_state TEXT');
  }
  schemaReadyDbs.add(db);
}

/**
 * Convert a DB row to the lightweight project summary expected by /api/projects.
 */
function rowToProject(row: ProjectIndexRow): Record<string, unknown> {
  /**
   * PURPOSE: Preserve the existing project list response shape while stripping
   * heavy session arrays from the read-model path.
   */
  return {
    name: row.name,
    path: row.project_path,
    routePath: row.route_path,
    displayName: row.display_name,
    fullPath: row.project_path,
    isCustomName: false,
    isManuallyAdded: row.source === 'manual',
    sessions: [],
    sessionMeta: { hasMore: false, total: 0 },
    lastActivity: row.last_activity || undefined,
    source: row.source,
  };
}

/**
 * Upsert one project row into the sidebar read model.
 */
function upsertProjectIndex(db: any, record: ProjectIndexRecord): void {
  /**
   * PURPOSE: Let backfill and file watchers incrementally repair project
   * visibility for the home sidebar.
   */
  ensureProjectIndexSchema(db);
  const projectPath = String(record.projectPath || '').trim();
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  const name = String(record.name || '').trim();
  const displayName = String(record.displayName || name).trim();
  const routePath = String(record.routePath || '').trim();
  if (!normalizedProjectPath || !name || !displayName || !routePath) {
    return;
  }
  const projectId = String(record.projectId || normalizedProjectPath).trim();
  db.prepare(`
    INSERT INTO project_index (
      project_id,
      name,
      display_name,
      project_path,
      normalized_project_path,
      route_path,
      source,
      visible,
      visibility_reason,
      last_activity,
      indexed_at,
      sync_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      name = excluded.name,
      display_name = excluded.display_name,
      project_path = excluded.project_path,
      normalized_project_path = excluded.normalized_project_path,
      route_path = excluded.route_path,
      source = excluded.source,
      visible = excluded.visible,
      visibility_reason = excluded.visibility_reason,
      last_activity = excluded.last_activity,
      indexed_at = CURRENT_TIMESTAMP,
      sync_state = excluded.sync_state
  `).run(
    projectId,
    name,
    displayName,
    projectPath,
    normalizedProjectPath,
    routePath,
    String(record.source || 'provider'),
    record.visible === false || record.visible === 0 ? 0 : 1,
    record.visibilityReason || null,
    toIsoString(record.lastActivity),
    record.syncState || 'ready',
  );
}

/**
 * Return visible project rows for the lightweight home list.
 */
function listVisibleProjects(db: any, limit = 200): Record<string, unknown>[] {
  /**
   * PURPOSE: Serve /api/projects from SQLite without touching provider history
   * directories on the request path.
   */
  ensureProjectIndexSchema(db);
  const rows = db.prepare(`
    SELECT
      project_id,
      name,
      display_name,
      project_path,
      normalized_project_path,
      route_path,
      source,
      visible,
      visibility_reason,
      last_activity,
      indexed_at,
      sync_state
    FROM project_index
    WHERE visible = 1
    ORDER BY COALESCE(last_activity, indexed_at) DESC, display_name COLLATE NOCASE ASC
    LIMIT ?
  `).all(limit) as ProjectIndexRow[];
  return rows.map(rowToProject);
}

/**
 * Mark one project as hidden without deleting its sync metadata.
 */
function setProjectVisibility(db: any, projectPath: string, visible: boolean, reason = ''): void {
  /**
   * PURPOSE: Support future cleanup and reindex repair without weakening the
   * DB-only project list query.
   */
  ensureProjectIndexSchema(db);
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  if (!normalizedProjectPath) {
    return;
  }
  db.prepare(`
    UPDATE project_index
    SET visible = ?, visibility_reason = ?, indexed_at = CURRENT_TIMESTAMP
    WHERE normalized_project_path = ?
  `).run(visible ? 1 : 0, reason || null, normalizedProjectPath);
}

/**
 * Mark one provider-derived project as hidden without touching manual projects.
 */
function setProviderProjectVisibility(db: any, projectPath: string, visible: boolean, reason = ''): void {
  /**
   * PURPOSE: Let provider JSONL deletion repair the DB-backed sidebar while
   * preserving explicit user project pins for the same path.
   */
  ensureProjectIndexSchema(db);
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  if (!normalizedProjectPath) {
    return;
  }
  db.prepare(`
    UPDATE project_index
    SET visible = ?, visibility_reason = ?, indexed_at = CURRENT_TIMESTAMP
    WHERE normalized_project_path = ? AND source = 'provider'
  `).run(visible ? 1 : 0, reason || null, normalizedProjectPath);
}

/**
 * Update a project's display name in the sidebar read model.
 */
function updateProjectDisplayName(db: any, projectPath: string, displayName: string | null = null): void {
  /**
   * PURPOSE: Keep renameProject writes visible to the DB-backed lightweight
   * project list without rescanning provider directories.
   */
  ensureProjectIndexSchema(db);
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  if (!normalizedProjectPath) {
    return;
  }
  const fallbackName = path.basename(projectPath) || projectPath;
  const nextDisplayName = String(displayName || '').trim() || fallbackName;
  db.prepare(`
    UPDATE project_index
    SET display_name = ?, indexed_at = CURRENT_TIMESTAMP
    WHERE normalized_project_path = ?
  `).run(nextDisplayName, normalizedProjectPath);
}

/**
 * Delete a project row from the read model.
 */
function deleteProjectIndex(db: any, projectPath: string): void {
  /**
   * PURPOSE: Give repair jobs a hard-delete path for stale DB rows.
   */
  ensureProjectIndexSchema(db);
  db.prepare('DELETE FROM project_index WHERE normalized_project_path = ?')
    .run(normalizeProjectPath(projectPath));
}

const projectIndexDb = {
  upsert: upsertProjectIndex,
  listVisible: listVisibleProjects,
  updateDisplayName: updateProjectDisplayName,
  setVisibility: setProjectVisibility,
  setProviderVisibility: setProviderProjectVisibility,
  delete: deleteProjectIndex,
};

export {
  projectIndexDb,
};
