/**
 * 文件目的：封装项目列表 summary 与单项目 overview 读模型组装逻辑。
 * 业务意义：API 层只负责路由和认证，Provider 会话与 workflow 合并规则集中在 typed 边界中。
 */

type LooseRecord = Record<string, any>;

export type ProjectOverviewReadModelDependencies = {
  summarizeProjectForList(project?: LooseRecord): LooseRecord;
  attachWorkflowMetadata(projects: LooseRecord[]): Promise<LooseRecord[]>;
  getCodexSessions(projectPath: string, options: LooseRecord): Promise<LooseRecord[]>;
  getPiSessions(projectPath: string, options: LooseRecord): Promise<LooseRecord[]>;
  getClaudeSessions?(projectPath: string, options: LooseRecord): Promise<LooseRecord[]>;
};

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
  const {
    sessions,
    codexSessions,
    piSessions,
    claudeSessions,
    workflows,
    batches,
    ...summary
  } = project;
  void sessions;
  void codexSessions;
  void piSessions;
  void claudeSessions;
  void workflows;
  void batches;
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

  return {
    ...dependencies.summarizeProjectForList(project),
    sessions: [],
    sessionMeta: projectRecord.sessionMeta || { hasMore: false, total: 0 },
    codexSessions,
    piSessions,
    claudeSessions,
    workflows: workflowProject.workflows || [],
    batches: workflowProject.batches || [],
    hasUnreadActivity: workflowProject.hasUnreadActivity === true,
  };
}
