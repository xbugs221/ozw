/**
 * PURPOSE: Centralize project session collection rules used by route recovery,
 * optimistic manual session creation, and websocket refresh reconciliation.
 */
import type { SessionProvider } from '../../types/app';
import type { Project, ProjectSession } from '../../types/app';
import { parseIndexedRouteSegment } from '../../utils/projectRoute';

/**
 * Return visible project sessions across built-in and provider-specific lists.
 */
export const getProjectSessions = (project: Project): ProjectSession[] => {
  const visibleSessions = [
    ...(project.sessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.piSessions ?? []),
    ...(project.claudeSessions ?? []),
    ...(project.hermesSessions ?? []),
  ];

  return visibleSessions.filter((session) => !(
    session.hidden === true ||
    session.archived === true ||
    session.status === 'archived' ||
    session.status === 'hidden'
  ));
};

/**
 * Find a provider-scoped session across all projects.
 */
export const findProjectSessionById = (
  projects: Project[],
  sessionId: string,
  provider: SessionProvider,
): { project: Project; session: ProjectSession } | null => {
  for (const project of projects) {
    const session = getProjectSessions(project).find(
      (entry) => entry.id === sessionId && (entry.__provider || provider) === provider,
    );
    if (session) return { project, session };
  }
  return null;
};

/**
 * Find the highest visible manual cN route so optimistic creation never reuses it.
 */
export const getHighestManualSessionRouteIndex = (project: Project): number => (
  getProjectSessions(project).reduce((maxRouteIndex, session) => {
    const routeIndex = Number(session.routeIndex);
    if (Number.isInteger(routeIndex) && routeIndex > maxRouteIndex) return routeIndex;

    const idRouteIndex = typeof session.id === 'string'
      ? parseIndexedRouteSegment(session.id, 'c')
      : null;
    return idRouteIndex !== null && idRouteIndex > maxRouteIndex ? idRouteIndex : maxRouteIndex;
  }, 0)
);

/**
 * Combine backend and visible counters to choose the next manual session route.
 */
export const getNextManualSessionRouteIndex = (project: Project): number => {
  const persistedNextRouteIndex = Number(project.manualSessionNextRouteIndex);
  const counterNextRouteIndex = Number.isInteger(persistedNextRouteIndex) && persistedNextRouteIndex > 0
    ? persistedNextRouteIndex
    : 1;
  return Math.max(counterNextRouteIndex, getHighestManualSessionRouteIndex(project) + 1);
};

/**
 * Choose the next default manual session label from the persisted high-water counter.
 */
export const getNextManualSessionLabel = (project: Project): string => `会话${getNextManualSessionRouteIndex(project)}`;

/**
 * Pick the same next cN route the backend will persist.
 */
export const getOptimisticManualSessionRouteIndex = (project: Project): number =>
  getNextManualSessionRouteIndex(project);

/**
 * Preserve the backend project owner for merged worktree sessions.
 */
export const withSessionProjectMetadata = (
  session: ProjectSession,
  project: Pick<Project, 'name' | 'fullPath' | 'path'>,
  provider: SessionProvider,
): ProjectSession => ({
  ...session,
  __provider: session.__provider || provider,
  projectPath:
    typeof session.projectPath === 'string' && session.projectPath
      ? session.projectPath
      : (project.fullPath || project.path || ''),
  __projectName:
    typeof session.__projectName === 'string' && session.__projectName
      ? session.__projectName
      : project.name,
});

/**
 * Map a provider to its project session bucket.
 */
export const providerToSessionsKey = (provider: SessionProvider): keyof Project => {
  if (provider === 'codex') return 'codexSessions';
  if (provider === 'pi') return 'piSessions';
  if (provider === 'claude') return 'claudeSessions';
  if (provider === 'hermes') return 'hermesSessions';
  throw new Error(`Unsupported session provider: ${String(provider)}`);
};

/**
 * Show a freshly created manual session in the sidebar immediately.
 */
export const insertSessionIntoProject = (
  project: Project,
  session: ProjectSession,
  provider: SessionProvider,
): Project => {
  const targetKey = providerToSessionsKey(provider);
  const currentSessions = Array.isArray(project[targetKey]) ? project[targetKey] as ProjectSession[] : [];
  const withoutDuplicate = currentSessions.filter((entry) => entry.id !== session.id);
  const currentTotal = Number(project.sessionMeta?.total || 0);

  return {
    ...project,
    [targetKey]: [session, ...withoutDuplicate],
    sessionMeta: {
      ...project.sessionMeta,
      total: Math.max(currentTotal, getProjectSessions(project).length + 1),
    },
  };
};

/**
 * Check whether a websocket project update can safely merge into current state.
 */
export const isUpdateAdditive = (
  currentProjects: Project[],
  updatedProjects: Project[],
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): boolean => {
  if (!selectedProject || !selectedSession) return true;

  const currentSelectedProject = currentProjects.find((project) => project.name === selectedProject.name);
  const updatedSelectedProject = updatedProjects.find((project) => project.name === selectedProject.name);
  if (!currentSelectedProject || !updatedSelectedProject) return false;

  const currentSelectedSession = getProjectSessions(currentSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );
  const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );
  if (!currentSelectedSession || !updatedSelectedSession) return false;

  return (
    currentSelectedSession.id === updatedSelectedSession.id &&
    currentSelectedSession.title === updatedSelectedSession.title &&
    currentSelectedSession.created_at === updatedSelectedSession.created_at &&
    currentSelectedSession.updated_at === updatedSelectedSession.updated_at
  );
};
