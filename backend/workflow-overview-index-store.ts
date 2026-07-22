/**
 * PURPOSE: Persist workflow overview cards as a SQLite read model so project
 * overview requests do not parse runner state files on the HTTP path.
 */
import path from 'path';

type WorkflowOverviewRecord = {
  projectPath: string;
  workflow: Record<string, unknown>;
};

type WorkflowOverviewRow = {
  project_path: string;
  normalized_project_path: string;
  run_id: string;
  workflow_json: string;
  updated_at: string | null;
  indexed_at: string | null;
  visible: number;
};

type WorkflowBatchRow = {
  project_path: string;
  normalized_project_path: string;
  batch_id: string;
  batch_json: string;
  indexed_at: string | null;
  visible: number;
};

const schemaReadyDbs = new WeakSet<object>();

/**
 * Normalize project paths before identity comparison and DB lookup.
 */
function normalizeProjectPath(projectPath: string): string {
  /**
   * PURPOSE: Match project_index/provider_session_index path identity rules.
   */
  const trimmed = String(projectPath || '').trim();
  if (!trimmed) {
    return '';
  }
  const resolved = path.resolve(trimmed);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Extract a stable run id from a workflow summary.
 */
function getWorkflowRunId(workflow: Record<string, unknown>): string {
  /**
   * PURPOSE: Keep one row per runner run while accepting legacy summary ids.
   */
  return String(workflow.runId || workflow.id || workflow.legacyId || '').trim();
}

/**
 * Extract the workflow timestamp used for overview ordering.
 */
function getWorkflowUpdatedAt(workflow: Record<string, unknown>): string | null {
  /**
   * PURPOSE: Preserve the same newest-first ordering used by state-file reads.
   */
  const updatedAt = String(workflow.updatedAt || workflow.updated_at || '').trim();
  return updatedAt || null;
}

/**
 * Extract a stable batch id from a batch summary.
 */
function getBatchId(batch: Record<string, unknown>): string {
  /**
   * PURPOSE: Keep one indexed row per oz flow batch state file.
   */
  return String(batch.id || batch.batchId || '').trim();
}

/**
 * Ensure old user databases have the workflow overview index schema.
 */
function ensureWorkflowOverviewIndexSchema(db: any): void {
  /**
   * PURPOSE: Let existing installs self-heal without a separate migration step.
   */
  if (schemaReadyDbs.has(db)) {
    return;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_overview_index (
      normalized_project_path TEXT NOT NULL,
      run_id TEXT NOT NULL,
      project_path TEXT NOT NULL,
      workflow_json TEXT NOT NULL,
      updated_at TEXT,
      indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      visible INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (normalized_project_path, run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_overview_project_recent
      ON workflow_overview_index(normalized_project_path, visible, updated_at DESC, indexed_at DESC);
    CREATE TABLE IF NOT EXISTS workflow_batch_index (
      normalized_project_path TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      project_path TEXT NOT NULL,
      batch_json TEXT NOT NULL,
      indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      visible INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (normalized_project_path, batch_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_batch_project_recent
      ON workflow_batch_index(normalized_project_path, visible, batch_id DESC, indexed_at DESC);
  `);
  schemaReadyDbs.add(db);
}

/**
 * Convert one indexed row back to the overview workflow summary.
 */
function rowToWorkflow(row: WorkflowOverviewRow): Record<string, unknown> | null {
  /**
   * PURPOSE: Keep callers independent from SQLite column names and tolerate
   * corrupt cache rows by dropping them from the response.
   */
  try {
    const workflow = JSON.parse(row.workflow_json);
    return workflow && typeof workflow === 'object' ? workflow : null;
  } catch {
    return null;
  }
}

/**
 * Convert one indexed row back to the overview batch summary.
 */
function rowToBatch(row: WorkflowBatchRow): Record<string, unknown> | null {
  /**
   * PURPOSE: Keep project overview batch grouping independent from SQLite
   * column names and tolerate corrupt cache rows.
   */
  try {
    const batch = JSON.parse(row.batch_json);
    return batch && typeof batch === 'object' ? batch : null;
  } catch {
    return null;
  }
}

/**
 * Replace all indexed workflow overviews for one project.
 */
function replaceProjectWorkflowOverviews(db: any, projectPath: string, workflows: Record<string, unknown>[]): number {
  /**
   * PURPOSE: Let background sync parse state files once and atomically publish
   * the bounded overview rows used by project home.
   */
  ensureWorkflowOverviewIndexSchema(db);
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  if (!normalizedProjectPath) {
    return 0;
  }

  const records = workflows
    .map((workflow) => ({ workflow, runId: getWorkflowRunId(workflow) }))
    .filter((record) => record.runId);

  const transaction = db.transaction(() => {
    const upsert = db.prepare(`
      INSERT INTO workflow_overview_index (
        normalized_project_path,
        run_id,
        project_path,
        workflow_json,
        updated_at,
        indexed_at,
        visible
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
      ON CONFLICT(normalized_project_path, run_id) DO UPDATE SET
        project_path = excluded.project_path,
        workflow_json = excluded.workflow_json,
        updated_at = excluded.updated_at,
        indexed_at = CURRENT_TIMESTAMP,
        visible = 1
    `);
    for (const record of records) {
      upsert.run(
        normalizedProjectPath,
        record.runId,
        projectPath,
        JSON.stringify(record.workflow),
        getWorkflowUpdatedAt(record.workflow),
      );
    }

    if (records.length === 0) {
      db.prepare(`
        UPDATE workflow_overview_index
        SET visible = 0, indexed_at = CURRENT_TIMESTAMP
        WHERE normalized_project_path = ?
      `).run(normalizedProjectPath);
      return;
    }

    const placeholders = records.map(() => '?').join(', ');
    db.prepare(`
      UPDATE workflow_overview_index
      SET visible = 0, indexed_at = CURRENT_TIMESTAMP
      WHERE normalized_project_path = ?
        AND run_id NOT IN (${placeholders})
    `).run(normalizedProjectPath, ...records.map((record) => record.runId));
  });

  transaction();
  return records.length;
}

/**
 * Replace all indexed batch overviews for one project.
 */
function replaceProjectBatchOverviews(db: any, projectPath: string, batches: Record<string, unknown>[]): number {
  /**
   * PURPOSE: Keep batch grouping data available to project overview without
   * reading batch state files on the HTTP request path.
   */
  ensureWorkflowOverviewIndexSchema(db);
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  if (!normalizedProjectPath) {
    return 0;
  }

  const records = batches
    .map((batch) => ({ batch, batchId: getBatchId(batch) }))
    .filter((record) => record.batchId);

  const transaction = db.transaction(() => {
    const upsert = db.prepare(`
      INSERT INTO workflow_batch_index (
        normalized_project_path,
        batch_id,
        project_path,
        batch_json,
        indexed_at,
        visible
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
      ON CONFLICT(normalized_project_path, batch_id) DO UPDATE SET
        project_path = excluded.project_path,
        batch_json = excluded.batch_json,
        indexed_at = CURRENT_TIMESTAMP,
        visible = 1
    `);
    for (const record of records) {
      upsert.run(
        normalizedProjectPath,
        record.batchId,
        projectPath,
        JSON.stringify(record.batch),
      );
    }

    if (records.length === 0) {
      db.prepare(`
        UPDATE workflow_batch_index
        SET visible = 0, indexed_at = CURRENT_TIMESTAMP
        WHERE normalized_project_path = ?
      `).run(normalizedProjectPath);
      return;
    }

    const placeholders = records.map(() => '?').join(', ');
    db.prepare(`
      UPDATE workflow_batch_index
      SET visible = 0, indexed_at = CURRENT_TIMESTAMP
      WHERE normalized_project_path = ?
        AND batch_id NOT IN (${placeholders})
    `).run(normalizedProjectPath, ...records.map((record) => record.batchId));
  });

  transaction();
  return records.length;
}

/**
 * Return indexed workflow overviews for one project.
 */
function listProjectWorkflowOverviews(db: any, projectPath: string, limit = 100): Record<string, unknown>[] {
  /**
   * PURPOSE: Serve project overview workflow cards from SQLite without reading
   * runner state files on each project open.
   */
  ensureWorkflowOverviewIndexSchema(db);
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  const boundedLimit = Math.max(0, Math.floor(Number(limit) || 0));
  if (!normalizedProjectPath || boundedLimit === 0) {
    return [];
  }
  const rows = db.prepare(`
    SELECT
      project_path,
      normalized_project_path,
      run_id,
      workflow_json,
      updated_at,
      indexed_at,
      visible
    FROM workflow_overview_index
    WHERE normalized_project_path = ? AND visible = 1
    ORDER BY updated_at DESC, indexed_at DESC, run_id ASC
    LIMIT ?
  `).all(normalizedProjectPath, boundedLimit) as WorkflowOverviewRow[];
  return rows.map(rowToWorkflow).filter((workflow): workflow is Record<string, unknown> => Boolean(workflow));
}

/**
 * Return indexed batch overviews for one project.
 */
function listProjectBatchOverviews(db: any, projectPath: string, limit = 100): Record<string, unknown>[] {
  /**
   * PURPOSE: Serve project overview batch groups from SQLite alongside indexed
   * workflow cards.
   */
  ensureWorkflowOverviewIndexSchema(db);
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  const boundedLimit = Math.max(0, Math.floor(Number(limit) || 0));
  if (!normalizedProjectPath || boundedLimit === 0) {
    return [];
  }
  const rows = db.prepare(`
    SELECT
      project_path,
      normalized_project_path,
      batch_id,
      batch_json,
      indexed_at,
      visible
    FROM workflow_batch_index
    WHERE normalized_project_path = ? AND visible = 1
    ORDER BY batch_id DESC, indexed_at DESC
    LIMIT ?
  `).all(normalizedProjectPath, boundedLimit) as WorkflowBatchRow[];
  return rows.map(rowToBatch).filter((batch): batch is Record<string, unknown> => Boolean(batch));
}

const workflowOverviewIndexDb = {
  ensureSchema: ensureWorkflowOverviewIndexSchema,
  replaceForProject: replaceProjectWorkflowOverviews,
  replaceBatchesForProject: replaceProjectBatchOverviews,
  listForProject: listProjectWorkflowOverviews,
  listBatchesForProject: listProjectBatchOverviews,
};

export {
  workflowOverviewIndexDb,
};
