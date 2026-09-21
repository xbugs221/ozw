/**
 * 文件目的：封装项目列表 summary 与单项目 overview 读模型组装逻辑。
 * 业务意义：API 层只负责路由和认证，Provider 会话与 workflow 合并规则集中在 typed 边界中。
 */

type LooseRecord = Record<string, any>;

import { listHermesSessionsForProject } from './hermes-session-read-model.js';

export type ProjectOverviewReadModelDependencies = {
  summarizeProjectForList(project?: LooseRecord): LooseRecord;
  attachWorkflowMetadata(projects: LooseRecord[]): Promise<LooseRecord[]>;
  getCodexSessions(projectPath: string, options: LooseRecord): Promise<LooseRecord[]>;
  getPiSessions(projectPath: string, options: LooseRecord): Promise<LooseRecord[]>;
  getClaudeSessions?(projectPath: string, options: LooseRecord): Promise<LooseRecord[]>;
};

const PROJECT_ACTIVITY_FIELDS = [
  'lastActivity',
  'last_activity',
  'activityAt',
  'activity_at',
  'updatedAt',
  'updated_at',
  'timeUpdated',
  'time_updated',
  'modifiedAt',
  'modified_at',
  'timestamp',
  'createdAt',
  'created_at',
  'timeCreated',
  'time_created',
] as const;

/**
 * Convert a project or session timestamp into milliseconds for comparison.
 */
function readActivityMilliseconds(value: unknown): number | null {
  /** PURPOSE: Accept ISO values and provider epoch values from legacy read models. */
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value < 1_000_000_000_000 ? value * 1000 : value;
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    const timestamp = numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Find the newest activity timestamp from a project summary and loaded rows.
 */
function getLatestProjectActivity(project: LooseRecord): string | undefined {
  /** PURPOSE: Keep lightweight summaries sortable even when activity only exists in nested legacy rows. */
  let latestMilliseconds: number | null = null;

  const inspectRecord = (record: LooseRecord | null | undefined) => {
    /** Inspect all supported timestamp aliases without trusting field order. */
    if (!record) {
      return;
    }
    for (const field of PROJECT_ACTIVITY_FIELDS) {
      const timestamp = readActivityMilliseconds(record[field]);
      if (timestamp !== null && (latestMilliseconds === null || timestamp > latestMilliseconds)) {
        latestMilliseconds = timestamp;
      }
    }
  };

  inspectRecord(project);
  for (const field of ['sessions', 'codexSessions', 'piSessions', 'claudeSessions', 'hermesSessions', 'workflows']) {
    const rows = Array.isArray(project[field]) ? project[field] : [];
    for (const row of rows) {
      if (row && typeof row === 'object') {
        inspectRecord(row as LooseRecord);
      }
    }
  }

  return latestMilliseconds === null ? undefined : new Date(latestMilliseconds).toISOString();
}

/**
 * 把 workflow 读模型中的内部会话统一提取成 provider 分组，供手动会话列表过滤。
 */
function collectWorkflowOwnedSessionIdsByProvider(workflows: LooseRecord[] = []): Record<string, Set<string>> {
  const sessionIdsByProvider: Record<string, Set<string>> = {};
  const addSession = (sessionId: unknown, provider: unknown = 'codex') => {
    /**
     * 兼容 summary refs、childSessions、runnerDiagnostics 等不同来源的内部会话记录。
     */
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      return;
    }
    const normalizedProvider = String(provider || '').trim() || 'codex';
    if (!sessionIdsByProvider[normalizedProvider]) {
      sessionIdsByProvider[normalizedProvider] = new Set<string>();
    }
    sessionIdsByProvider[normalizedProvider].add(normalizedSessionId);
  };

  for (const workflow of workflows) {
    for (const ref of workflow.workflowOwnedSessionRefs || []) {
      addSession(ref?.sessionId, ref?.provider);
    }
    for (const session of workflow.childSessions || []) {
      addSession(session?.id || session?.sessionId, session?.provider);
    }
    for (const process of workflow.runnerProcesses || []) {
      addSession(process?.sessionId || process?.session_id, process?.provider);
    }
    for (const session of workflow.runnerDiagnostics?.workflowOwnedSessions || []) {
      addSession(session?.sessionId || session?.id, session?.provider);
    }
    for (const session of workflow.diagnostics?.workflowOwnedSessions || []) {
      addSession(session?.sessionId || session?.id, session?.provider);
    }
  }

  return sessionIdsByProvider;
}

/**
 * 构建首屏项目列表使用的轻量 summary，避免携带 Provider 会话与 workflow 明细。
 */
export function summarizeProjectForList(project: LooseRecord = {}): LooseRecord {
  const latestActivity = getLatestProjectActivity(project);
  const {
    sessions,
    codexSessions,
    piSessions,
    claudeSessions,
    hermesSessions,
    workflows,
    batches,
    ...summary
  } = project;
  void sessions;
  void codexSessions;
  void piSessions;
  void claudeSessions;
  void hermesSessions;
  void workflows;
  void batches;
  if (latestActivity) {
    summary.lastActivity = latestActivity;
  }
  return summary;
}

/**
 * 组装单项目 overview API 返回体，会话与 workflow 均从 DB 读模型读取。
 */
export async function buildProjectOverviewReadModel(
  project: LooseRecord,
  dependencies: ProjectOverviewReadModelDependencies,
): Promise<LooseRecord> {
  const projectPath = project.fullPath || project.path || '';
  const projectRecord = project as LooseRecord;
  const projectsWithWorkflowMetadata = await dependencies.attachWorkflowMetadata([{
    ...project,
    fullPath: projectPath,
    path: projectPath,
  }]);
  const workflowProject = projectsWithWorkflowMetadata[0] || {};
  const workflowOwnedSessionIdsByProvider = collectWorkflowOwnedSessionIdsByProvider(workflowProject.workflows || []);
  const [codexSessions, piSessions] = await Promise.all([
    dependencies.getCodexSessions(projectPath, {
      limit: 10,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
      skipProviderScan: true,
      workflowOwnedSessionIds: workflowOwnedSessionIdsByProvider.codex || new Set<string>(),
    }),
    dependencies.getPiSessions(projectPath, {
      limit: 10,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
      skipProviderScan: true,
      workflowOwnedSessionIds: workflowOwnedSessionIdsByProvider.pi || new Set<string>(),
    }),
  ]);
  const claudeSessions = typeof dependencies.getClaudeSessions === 'function'
    ? await dependencies.getClaudeSessions(projectPath, { limit: 10, skipProviderScan: true })
    : [];
  const hermesResult = await listHermesSessionsForProject(projectPath, { limit: 10 });

  return {
    ...dependencies.summarizeProjectForList(project),
    sessions: [],
    sessionMeta: projectRecord.sessionMeta || { hasMore: false, total: 0 },
    codexSessions,
    piSessions,
    claudeSessions,
    hermesSessions: hermesResult.sessions,
    hermesDiagnostics: hermesResult.diagnostics,
    workflows: workflowProject.workflows || [],
    batches: workflowProject.batches || [],
    hasUnreadActivity: workflowProject.hasUnreadActivity === true,
  };
}
