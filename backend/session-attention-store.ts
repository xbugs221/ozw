/**
 * 文件目的：提供跨项目会话待处理看板的 SQLite 读模型与确认游标。
 * 业务意义：“处理完成”只确认用户看到的活动版本，不会误清并发新活动。
 */
import type Database from 'better-sqlite3';
import { providerSessionIndexDb } from './provider-session-index-store.js';
import { workflowOverviewIndexDb } from './workflow-overview-index-store.js';

type AttentionIdentity = {
  provider: string;
  sessionId: string;
};

type ObservedAttentionIdentity = AttentionIdentity & {
  observedRevision: number;
};

type AttentionRow = AttentionIdentity & {
  projectPath: string;
  title: string;
  summary: string;
  lastActivity: string;
  activityRevision: number;
  handledRevision: number;
  manualPending: boolean;
};

type BatchResult = {
  handled: string[];
  newerActivity: string[];
  missing: string[];
};

const schemaReadyDbs = new WeakSet<object>();

/**
 * 幂等建立确认表和看板查询索引，并兼容旧版 Provider 索引库。
 */
function ensureSchema(db: Database.Database): void {
  /** 业务目的：旧数据库升级后可立即使用看板，无需手工迁移。 */
  if (schemaReadyDbs.has(db)) return;
  providerSessionIndexDb.ensureSchema(db);
  workflowOverviewIndexDb.ensureSchema(db);
  const columns = db.prepare('PRAGMA table_info(provider_session_index)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'activity_revision')) {
    db.exec('ALTER TABLE provider_session_index ADD COLUMN activity_revision INTEGER NOT NULL DEFAULT 1');
  }
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_provider_session_attention_recent
      ON provider_session_index(last_activity DESC);
  `);
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
 * 返回最近的有界待处理会话，不读取消息正文。
 */
function list(db: Database.Database, options: { limit: number }): AttentionRow[] {
  /** 业务目的：首页用一次最多 100 条的查询聚合三种 Provider。 */
  ensureSchema(db);
  const requestedLimit = Number(options?.limit);
  const limit = Math.min(100, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 100));
  const rows = db.prepare(`
    SELECT
      p.provider,
      p.session_id,
      p.project_path,
      p.title,
      p.summary,
      p.last_activity,
      p.activity_revision,
      COALESCE(a.handled_revision, 0) AS handled_revision,
      COALESCE(a.manual_pending, 0) AS manual_pending
    FROM provider_session_index p
    LEFT JOIN session_attention_ack a
      ON a.provider = p.provider AND a.session_id = p.session_id
    WHERE (
      p.activity_revision > COALESCE(a.handled_revision, 0)
      OR COALESCE(a.manual_pending, 0) = 1
    )
      AND COALESCE(p.origin, 'manual') <> 'workflow'
      AND NOT EXISTS (
        SELECT 1
        FROM workflow_overview_index w,
          json_each(w.workflow_json, '$.workflowOwnedSessionRefs') AS owned
        WHERE w.visible = 1
          AND w.normalized_project_path = p.normalized_project_path
          AND json_extract(owned.value, '$.sessionId') = p.session_id
          AND COALESCE(json_extract(owned.value, '$.provider'), 'codex') = p.provider
      )
    ORDER BY p.last_activity DESC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    provider: String(row.provider),
    sessionId: String(row.session_id),
    projectPath: String(row.project_path || ''),
    title: String(row.title || row.summary || '未命名会话'),
    summary: String(row.summary || row.title || '未命名会话'),
    lastActivity: String(row.last_activity || ''),
    activityRevision: Number(row.activity_revision || 1),
    handledRevision: Number(row.handled_revision || 0),
    manualPending: Number(row.manual_pending || 0) === 1,
  }));
}

/**
 * 在一个事务中确认用户已观察的活动版本。
 */
function markHandled(db: Database.Database, items: ObservedAttentionIdentity[]): BatchResult {
  /** 业务目的：并发到达的更高版本仍留在看板，批量操作可幂等重试。 */
  ensureSchema(db);
  if (!Array.isArray(items) || items.length < 1 || items.length > 200) {
    throw new RangeError('批量处理数量必须在 1 到 200 之间');
  }
  const run = db.transaction((batch: ObservedAttentionIdentity[]): BatchResult => {
    const result: BatchResult = { handled: [], newerActivity: [], missing: [] };
    const findCurrent = db.prepare(`
      SELECT activity_revision FROM provider_session_index
      WHERE provider = ? AND session_id = ?
    `);
    const writeAck = db.prepare(`
      INSERT INTO session_attention_ack (
        provider, session_id, handled_revision, manual_pending, legacy_pending_migrated, handled_at, updated_at
      ) VALUES (?, ?, ?, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(provider, session_id) DO UPDATE SET
        handled_revision = MAX(session_attention_ack.handled_revision, excluded.handled_revision),
        manual_pending = 0,
        legacy_pending_migrated = 1,
        handled_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `);
    for (const item of batch) {
      const provider = String(item?.provider || '').trim();
      const sessionId = String(item?.sessionId || '').trim();
      const key = `${provider}:${sessionId}`;
      const current = findCurrent.get(provider, sessionId) as { activity_revision?: number } | undefined;
      if (!provider || !sessionId || !current) {
        result.missing.push(key);
        continue;
      }
      const observedRevision = Number(item.observedRevision);
      const activityRevision = Number(current.activity_revision || 0);
      if (!Number.isSafeInteger(observedRevision) || observedRevision < 1 || observedRevision > activityRevision) {
        throw new RangeError(`${key} 的 observedRevision 无效`);
      }
      writeAck.run(provider, sessionId, observedRevision);
      if (activityRevision > observedRevision) result.newerActivity.push(key);
      else result.handled.push(key);
    }
    return result;
  });
  return run(items);
}

/**
 * 将旧项目配置中的 pending 真值至多迁移一次。
 */
function migrateLegacyPending(db: Database.Database, provider: string, sessionId: string, pending: boolean): void {
  /** 业务目的：SQLite 一旦接管状态，重启回填不得覆盖用户后续的处理结果。 */
  ensureSchema(db);
  const exists = db.prepare(`
    SELECT 1 FROM provider_session_index WHERE provider = ? AND session_id = ?
  `).get(provider, sessionId);
  if (!exists) throw new Error('会话不存在');
  db.prepare(`
    INSERT INTO session_attention_ack (
      provider, session_id, handled_revision, manual_pending, legacy_pending_migrated, updated_at
    ) VALUES (?, ?, 0, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(provider, session_id) DO UPDATE SET
      manual_pending = excluded.manual_pending,
      legacy_pending_migrated = 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE session_attention_ack.legacy_pending_migrated = 0
  `).run(provider, sessionId, pending ? 1 : 0);
}

/**
 * 写入会话的手动待处理标志。
 */
function setManualPending(db: Database.Database, provider: string, sessionId: string, pending: boolean): void {
  /** 业务目的：项目内“待办”与首页看板共用同一持久化真值。 */
  ensureSchema(db);
  const exists = db.prepare(`
    SELECT 1 FROM provider_session_index WHERE provider = ? AND session_id = ?
  `).get(provider, sessionId);
  if (!exists) throw new Error('会话不存在');
  db.prepare(`
    INSERT INTO session_attention_ack (
      provider, session_id, handled_revision, manual_pending, legacy_pending_migrated, updated_at
    ) VALUES (?, ?, 0, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(provider, session_id) DO UPDATE SET
      manual_pending = excluded.manual_pending,
      legacy_pending_migrated = 1,
      updated_at = CURRENT_TIMESTAMP
  `).run(provider, sessionId, pending ? 1 : 0);
}

const sessionAttentionDb = { ensureSchema, list, markHandled, setManualPending, migrateLegacyPending };

export { sessionAttentionDb };
export type { AttentionRow, BatchResult, ObservedAttentionIdentity };
