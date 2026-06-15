/**
 * PURPOSE: Keep project refresh merge rules outside the React hook so sidebar
 * updates preserve loaded overview details while accepting fresh list data.
 */
import type { Project, ProjectSession } from '../../types/app';

export const serialize = (value: unknown) => JSON.stringify(value ?? null);

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
 * Compare project arrays, including provider sessions when requested.
 */
export const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
  includeExternalSessions: boolean,
): boolean => {
  if (prevProjects.length !== nextProjects.length) return true;

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) return true;

    const baseChanged =
      nextProject.name !== prevProject.name ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions) ||
      serialize(nextProject.workflows) !== serialize(prevProject.workflows) ||
      serialize(nextProject.hasUnreadActivity) !== serialize(prevProject.hasUnreadActivity);

    if (baseChanged) return true;
    if (!includeExternalSessions) return false;

    return (
      serialize(nextProject.codexSessions) !== serialize(prevProject.codexSessions) ||
      serialize(nextProject.piSessions) !== serialize(prevProject.piSessions)
    );
  });
};

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
  return Boolean(
    (projectPath && overviewPath && projectPath === overviewPath) ||
      (project.name && overview.name && project.name === overview.name),
  );
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
