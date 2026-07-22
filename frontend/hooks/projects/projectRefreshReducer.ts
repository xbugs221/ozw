/**
 * PURPOSE: Keep project refresh merge rules outside the React hook so sidebar
 * updates preserve loaded overview details while accepting fresh list data.
 */
import type { Project, ProjectSession, ProjectWorkflow } from '../../types/app';

type RefreshComparableProject = Pick<Project, 'name' | 'displayName' | 'fullPath' | 'sessionMeta' | 'hasUnreadActivity'>;

export const serialize = (value: unknown): string => {
  /** Preserve legacy primitive comparisons without using deep JSON serialization. */
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return String(value);
  return String(value);
};

export const isTemporarySessionId = (sessionId: string | null | undefined): boolean =>
  Boolean(sessionId && (sessionId.startsWith('new-session-') || /^c\d+$/.test(sessionId)));

export const normalizeComparablePath = (value: string | null | undefined): string =>
  String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '');

/**
 * Detect fetch interruptions caused by browser navigation or page teardown.
 */
export function isInterruptedFetch(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message || error || '');
  return message.includes('Failed to fetch') || message.includes('aborted') || message.includes('AbortError');
}

/**
 * Merge a detail overview into its matching lightweight project summary.
 */
export function mergeProjectOverview(project: Project, overview: Project): Project {
  return {
    ...project,
    ...overview,
    name: project.name || overview.name,
    displayName: project.displayName || overview.displayName,
    routePath: project.routePath || overview.routePath,
    fullPath: project.fullPath || overview.fullPath,
    path: project.path || overview.path,
  };
}

/**
 * Merge a lightweight list refresh without discarding already loaded details.
 */
export function mergeProjectSummary(project: Project, summary: Project): Project {
  return {
    ...summary,
    sessions: project.sessions,
    sessionMeta: project.sessionMeta ?? summary.sessionMeta,
    codexSessions: project.codexSessions,
    piSessions: project.piSessions,
    claudeSessions: project.claudeSessions,
    hermesSessions: project.hermesSessions,
    workflows: project.workflows,
    batches: project.batches,
    hasUnreadActivity: project.hasUnreadActivity ?? summary.hasUnreadActivity,
  };
}

/**
 * Test whether an overview response belongs to a project summary.
 */
export function projectMatchesOverview(project: Project, overview: Project): boolean {
  const projectPath = normalizeComparablePath(project.fullPath || project.path);
  const overviewPath = normalizeComparablePath(overview.fullPath || overview.path);
  if (projectPath || overviewPath) {
    return Boolean(projectPath && overviewPath && projectPath === overviewPath);
  }
  return Boolean(project.name && overview.name && project.name === overview.name);
}

/**
 * Reconcile first-paint project summaries with the current detailed state.
 */
export function mergeProjectSummaries(prevProjects: Project[], summaries: Project[]): Project[] {
  return summaries.map((summary) => {
    const existingProject = prevProjects.find((project) => projectMatchesOverview(project, summary));
    return existingProject ? mergeProjectSummary(existingProject, summary) : summary;
  });
}

/**
 * Resolve the refreshed session that should replace one selected session.
 */
export const findRefreshedSelectedSession = (
  project: Project,
  selectedSession: ProjectSession,
  getProjectSessions: (project: Project) => ProjectSession[],
): ProjectSession | null => {
  const visibleSessions = getProjectSessions(project);
  const exactSession = visibleSessions.find((session) => session.id === selectedSession.id) || null;
  if (exactSession) return exactSession;
  if (!isTemporarySessionId(String(selectedSession.id || ''))) return null;

  const providerSessions = selectedSession.__provider === 'codex'
    ? (project.codexSessions || [])
    : selectedSession.__provider === 'pi'
      ? (project.piSessions || [])
      : (project.sessions || []);

  return providerSessions.find((session) => session.routeIndex === selectedSession.routeIndex) || null;
};

function signatureSegment(value: unknown): string {
  /** Convert primitive refresh fields into stable signature segments. */
  if (value === null || value === undefined) return '';
  return String(value).replace(/[|:,]/g, ' ');
}

function sessionListSignature(items: ProjectSession[] | undefined): string {
  /** Summarize visible session identity and ordering without deep serialization. */
  return (items || [])
    .map((item) => [
      item.id,
      item.routeIndex,
      item.updatedAt ?? item.updated_at ?? item.lastActivity ?? item.last_activity ?? item.timestamp,
      item.messageCount,
      item.status,
      item.favorite,
      item.hidden,
      item.archived,
    ].map(signatureSegment).join(':'))
    .join('|');
}

function workflowListSignature(items: ProjectWorkflow[] | undefined): string {
  /** Summarize workflow list identity and status without walking nested payloads. */
  return (items || [])
    .map((item) => [
      item.id,
      item.status,
      item.updatedAt ?? item.createdAt,
      item.title,
    ].map(signatureSegment).join(':'))
    .join('|');
}

export function buildProjectRefreshSignature(
  project: RefreshComparableProject,
  includeExternalSessions: boolean,
): string {
  /** Build a bounded project refresh signature from fields that affect sidebar state. */
  const internal = project as Project;
  const base = [
    project.name,
    project.displayName,
    project.fullPath,
    project.sessionMeta?.total,
    project.sessionMeta?.hasMore,
    project.hasUnreadActivity,
    sessionListSignature(internal.sessions),
    workflowListSignature(internal.workflows),
  ];
  if (includeExternalSessions) {
    base.push(sessionListSignature(internal.codexSessions), sessionListSignature(internal.piSessions));
  }
  return base.map(signatureSegment).join('|');
}

/**
 * Compare project arrays, including provider rows when requested.
 */
export const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
  includeExternalRows: boolean,
): boolean => {
  if (prevProjects.length !== nextProjects.length) return true;

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) return true;
    return (
      buildProjectRefreshSignature(nextProject, includeExternalRows) !==
      buildProjectRefreshSignature(prevProject, includeExternalRows)
    );
  });
};
