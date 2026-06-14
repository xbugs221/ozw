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
};

/**
 * 构建首屏项目列表使用的轻量 summary，避免携带 Provider 会话与 workflow 明细。
 */
export function summarizeProjectForList(project: LooseRecord = {}): LooseRecord {
  const {
    sessions,
    codexSessions,
    piSessions,
    workflows,
    batches,
    ...summary
  } = project;
  void sessions;
  void codexSessions;
  void piSessions;
  void workflows;
  void batches;
  return summary;
}

/**
 * 组装单项目 overview API 返回体，保持现有会话过滤和 workflow 元数据合并行为。
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
  const workflowOwnedSessionIdsByProvider = (workflowProject.workflows || []).reduce((acc: Record<string, Set<string>>, workflow: LooseRecord) => {
    for (const ref of workflow.workflowOwnedSessionRefs || []) {
      const provider = String(ref?.provider || '').trim() || 'codex';
      const sessionId = String(ref?.sessionId || '').trim();
      if (!sessionId) {
        continue;
      }
      if (!acc[provider]) {
        acc[provider] = new Set<string>();
      }
      acc[provider].add(sessionId);
    }
    return acc;
  }, {});
  const [codexSessions, piSessions] = await Promise.all([
    dependencies.getCodexSessions(projectPath, {
      limit: 10,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
      preferRecentProjectScan: true,
      workflowOwnedSessionIds: workflowOwnedSessionIdsByProvider.codex || new Set<string>(),
    }),
    dependencies.getPiSessions(projectPath, {
      limit: 10,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
      preferRecentProjectScan: true,
      workflowOwnedSessionIds: workflowOwnedSessionIdsByProvider.pi || new Set<string>(),
    }),
  ]);

  return {
    ...dependencies.summarizeProjectForList(project),
    sessions: [],
    sessionMeta: projectRecord.sessionMeta || { hasMore: false, total: 0 },
    codexSessions,
    piSessions,
    workflows: workflowProject.workflows || [],
    batches: workflowProject.batches || [],
    hasUnreadActivity: workflowProject.hasUnreadActivity === true,
  };
}
