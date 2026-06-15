/**
 * Project and session selection state.
 * Keeps the sidebar model synchronized with API data and ordered WebSocket update events.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { SocketMessageEnvelope } from '../contexts/WebSocketContext';
import {
  getMessageHistoryTailSequence,
  getPendingSocketMessages,
  reduceProjectsUpdatedMessages,
  sessionChangedMatchesSelectedSession,
} from '../../shared/socket-message-utils';
import { api } from '../utils/api';
import { createWindowRefreshCoordinator } from '../utils/windowRefreshCoordinator';
import type { SessionProvider } from '../types/app';
import {
  buildProjectRoute,
  buildProjectSessionRoute,
  buildProjectWorkflowRoute,
  buildWorkflowChildSessionRoute,
  getProjectRoutePath,
  parseIndexedRouteSegment,
} from '../utils/projectRoute';
import { isWorkflowOwnedSession } from '../utils/workflowSessions';
import { resolveSessionProvider } from '../utils/session-provider';
import type { NewSessionOptions } from '../utils/workflowAutoStart';
import type {
  AppSocketMessage,
  AppTab,
  LoadingProgress,
  Project,
  ProjectSession,
  ProjectWorkflow,
  ProjectsUpdatedMessage,
} from '../types/app';

type UseProjectsStateArgs = {
  locationPathname: string;
  locationSearch?: string;
  navigate: NavigateFunction;
  messageHistory: SocketMessageEnvelope[];
  isMobile: boolean;
  activeSessions: Set<string>;
};

const serialize = (value: unknown) => JSON.stringify(value ?? null);
const isTemporarySessionId = (sessionId: string | null | undefined): boolean =>
  Boolean(sessionId && (sessionId.startsWith('new-session-') || /^c\d+$/.test(sessionId)));
const normalizeComparablePath = (value: string | null | undefined): string =>
  String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '');

/**
 * Detect fetch interruptions caused by browser navigation or page teardown.
 */
function isInterruptedFetch(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message || error || '');
  return message.includes('Failed to fetch') || message.includes('aborted') || message.includes('AbortError');
}

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
  includeExternalSessions: boolean,
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    const baseChanged =
      nextProject.name !== prevProject.name ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions) ||
      serialize(nextProject.workflows) !== serialize(prevProject.workflows) ||
      serialize(nextProject.hasUnreadActivity) !== serialize(prevProject.hasUnreadActivity);

    if (baseChanged) {
      return true;
    }

    if (!includeExternalSessions) {
      return false;
    }

    return (
      serialize(nextProject.codexSessions) !== serialize(prevProject.codexSessions) ||
      serialize(nextProject.piSessions) !== serialize(prevProject.piSessions)
    );
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  const visibleSessions = [
    ...(project.sessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.piSessions ?? []),
  ];

  return visibleSessions.filter((session) => {
    return !(
      session.hidden === true ||
      session.archived === true ||
      session.status === 'archived' ||
      session.status === 'hidden'
    );
  });
};

/**
 * Merge a detail overview into its matching lightweight project summary.
 */
function mergeProjectOverview(project: Project, overview: Project): Project {
  /**
   * PURPOSE: Preserve route/display fields from the first-paint summary while
   * attaching sessions, workflows, and batches loaded for the selected project.
   */
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
function mergeProjectSummary(project: Project, summary: Project): Project {
  /**
   * PURPOSE: Keep selected project overview state stable when /api/projects
   * refreshes only route/display metadata.
   */
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
function projectMatchesOverview(project: Project, overview: Project): boolean {
  /**
   * PURPOSE: Match by stable path first because provider-only project names can
   * be synthetic route identifiers.
   */
  const projectPath = normalizeComparablePath(project.fullPath || project.path);
  const overviewPath = normalizeComparablePath(overview.fullPath || overview.path);
  return Boolean(
    (projectPath && overviewPath && projectPath === overviewPath)
    || (project.name && overview.name && project.name === overview.name),
  );
}

/**
 * Reconcile first-paint project summaries with the current detailed state.
 */
function mergeProjectSummaries(prevProjects: Project[], summaries: Project[]): Project[] {
  /**
   * PURPOSE: Preserve selected overview data across lightweight sidebar list
   * invalidations while still accepting project metadata changes.
   */
  return summaries.map((summary) => {
    const existingProject = prevProjects.find((project) => projectMatchesOverview(project, summary));
    return existingProject ? mergeProjectSummary(existingProject, summary) : summary;
  });
}

const findProjectSessionById = (
  projects: Project[],
  sessionId: string,
  provider: SessionProvider,
): { project: Project; session: ProjectSession } | null => {
  for (const project of projects) {
    const session = getProjectSessions(project).find(
      (entry) => entry.id === sessionId && (entry.__provider || provider) === provider,
    );
    if (session) {
      return { project, session };
    }
  }

  return null;
};

/**
 * PURPOSE: Resolve the freshest workflow snapshot available for child-session
 * navigation so newly created workflows do not fall back to plain `/cN` routes.
 */
const findWorkflowById = (
  project: Project | null | undefined,
  workflowId: string | undefined,
): ProjectWorkflow | null => {
  if (!project || !workflowId) {
    return null;
  }

  return (project.workflows || []).find((workflow) => workflow.id === workflowId) || null;
};

/**
 * PURPOSE: Resolve the refreshed session that should replace one selected session.
 * Manual drafts keep their ozw route id, so refreshed data is reconciled by
 * exact id first and stable route index second within the same provider bucket.
 */
const findRefreshedSelectedSession = (
  project: Project,
  selectedSession: ProjectSession,
): ProjectSession | null => {
  const visibleSessions = getProjectSessions(project);
  const exactSession = visibleSessions.find((session) => session.id === selectedSession.id) || null;
  if (exactSession) {
    return exactSession;
  }

  if (!isTemporarySessionId(String(selectedSession.id || ''))) {
    return null;
  }

  const providerSessions = selectedSession.__provider === 'codex'
    ? (project.codexSessions || [])
    : selectedSession.__provider === 'pi'
        ? (project.piSessions || [])
        : (project.sessions || []);

  return providerSessions.find((session) => (
    session.routeIndex === selectedSession.routeIndex
  )) || null;
};

const hasPlanningChildSession = (workflow: ProjectWorkflow | null): boolean => {
  /**
   * PURPOSE: Detect whether the workflow detail already has a routable planning
   * session, including normalized legacy chat entries.
   */
  return Boolean((workflow?.childSessions || []).some((session) => (
    session.stageKey === 'planning'
  )));
};

const shouldPollWorkflowPlanningSession = (workflow: ProjectWorkflow | null): boolean => {
  /**
   * PURPOSE: Keep newly-created workflow details fresh only while the planning
   * child session is expected but not yet visible in the local read model.
   */
  if (!workflow || hasPlanningChildSession(workflow)) {
    return false;
  }

  const planningStatus = (workflow.stageStatuses || []).find((stage) => stage.key === 'planning')?.status;
  return workflow.stage === 'planning' || planningStatus === 'active' || planningStatus === 'ready';
};

type ResolvedRouteSelection = {
  project: Project | null;
  workflow: ProjectWorkflow | null;
  session: ProjectSession | null;
};

const normalizePathname = (pathname: string): string => {
  if (!pathname || pathname === '/') {
    return '/';
  }
  return pathname.replace(/\/+$/g, '') || '/';
};

const resolveRouteSelection = (
  projects: Project[],
  pathname: string,
): ResolvedRouteSelection => {
  const normalizedPathname = normalizePathname(pathname);
  if (normalizedPathname === '/') {
    return { project: null, workflow: null, session: null };
  }

  const legacySessionMatch = normalizedPathname.match(/^\/session\/([^/]+)$/);
  if (legacySessionMatch) {
    const legacySessionId = decodeURIComponent(legacySessionMatch[1]);
    for (const project of projects) {
      const session = getProjectSessions(project).find((entry) => entry.id === legacySessionId) || null;
      if (session) {
        return { project, workflow: null, session };
      }
    }
    // Fallback: create a synthetic session for cN and codex-prefixed IDs
    // so provider-complete handlers can resolve selectedProject / selectedSession
    // and call reloadCodexSessionMessages without short-circuiting.
    const cNMatch = legacySessionId.match(/^c(\d+)$/);
    const isCNSession = cNMatch !== null;
    if ((legacySessionId.startsWith('codex-') || isCNSession) && projects[0]) {
      const routeIndex = cNMatch ? Number(cNMatch[1]) : undefined;
      // Resolve project from query param so the session is scoped to the
      // correct read model (co home) when no indexed session is found.
      const searchParams = new URLSearchParams(window.location.search);
      const projectPathParam = searchParams.get('projectPath') || '';
      const providerParam = searchParams.get('provider') || 'codex';
      const resolvedProject = projectPathParam
        ? projects.find((p) => (p.fullPath || p.path) === projectPathParam) || projects[0]
        : projects[0];
      return {
        project: resolvedProject,
        workflow: null,
        session: {
          id: legacySessionId,
          routeIndex,
          summary: legacySessionId.startsWith('codex-') ? 'Codex Session' : `会话${String(routeIndex ?? '')}`,
          provider: providerParam as ProjectSession['provider'],
          __provider: providerParam as ProjectSession['__provider'],
          __projectName: resolvedProject?.name,
          projectPath: projectPathParam || resolvedProject?.fullPath || resolvedProject?.path || '',
        } as ProjectSession,
      };
    }
  }

  const matchedProject = [...projects]
    .sort((left, right) => getProjectRoutePath(right).length - getProjectRoutePath(left).length)
    .find((project) => {
      const projectRoute = getProjectRoutePath(project);
      return normalizedPathname === projectRoute || normalizedPathname.startsWith(`${projectRoute}/`);
    }) || null;

  if (!matchedProject) {
    return { project: null, workflow: null, session: null };
  }

  const projectRoute = getProjectRoutePath(matchedProject);
  const remainder = normalizedPathname.slice(projectRoute.length).replace(/^\/+/g, '');
  if (!remainder) {
    return { project: matchedProject, workflow: null, session: null };
  }

  const routeSegments = remainder.split('/').filter(Boolean);
  const workflowRunId = routeSegments[0] === 'runs' ? decodeURIComponent(routeSegments[1] || '') : '';
  const sessionRouteIndex = parseIndexedRouteSegment(routeSegments[0], 'c');

  if (workflowRunId && routeSegments.length === 2) {
    const workflow = (matchedProject.workflows || []).find((entry) => entry.runId === workflowRunId || entry.id === workflowRunId) || null;
    return { project: matchedProject, workflow, session: null };
  }

  if (sessionRouteIndex && routeSegments.length === 1) {
    const session = getProjectSessions(matchedProject).find((entry) => (
      entry.routeIndex === sessionRouteIndex && !isWorkflowOwnedSession(matchedProject, entry)
    )) || null;
    if (session) {
      return { project: matchedProject, workflow: null, session };
    }

    return {
      project: matchedProject,
      workflow: null,
      session: {
        id: `c${sessionRouteIndex}`,
        routeIndex: sessionRouteIndex,
        title: `会话${sessionRouteIndex}`,
        summary: `会话${sessionRouteIndex}`,
        provider: 'codex',
        __provider: 'codex',
        projectPath: matchedProject.fullPath || matchedProject.path || '',
        __projectName: matchedProject.name,
      } as ProjectSession,
    };
  }

  if (workflowRunId && routeSegments.length >= 4 && routeSegments[2] === 'sessions') {
    const workflow = (matchedProject.workflows || []).find((entry) => entry.runId === workflowRunId || entry.id === workflowRunId) || null;
    const childAddress = routeSegments.slice(3).map((segment) => decodeURIComponent(segment || '').trim()).filter(Boolean).join('/');
    if (!workflow || !childAddress) {
      return { project: matchedProject, workflow: null, session: null };
    }

    const childAddressParts = childAddress.split('/').filter(Boolean);
    const isByIdAddress = childAddressParts[0] === 'by-id' && childAddressParts.length >= 2;
    const addressStage = isByIdAddress ? '' : childAddressParts[0] || '';
    const addressRole = isByIdAddress ? '' : childAddressParts[1] || '';
    const addressSessionId = isByIdAddress ? childAddressParts.slice(1).join('/') : '';
    const runnerProcess = (workflow.runnerProcesses || []).find((entry) => (
      isByIdAddress
        ? entry.sessionId === addressSessionId
        : (entry.stage === addressStage && Boolean(addressRole) && entry.role === addressRole)
    )) || null;
    const childSession = (workflow.childSessions || []).find((entry) => (
      entry.address === childAddress
      || entry.routePath?.endsWith(`/sessions/${childAddress}`)
      || (isByIdAddress && entry.id === addressSessionId)
      || (!isByIdAddress && Boolean(addressRole) && entry.stageKey === addressStage && entry.role === addressRole)
      || (runnerProcess?.sessionId && entry.id === runnerProcess.sessionId)
    )) || null;
    const projectSession = getProjectSessions(matchedProject).find((entry) => (
      entry.id === childSession?.id
      || entry.id === runnerProcess?.sessionId
      || (entry.workflowId === workflow.id && (
        entry.stageKey === childAddress
        || entry.id === childAddress
        || entry.stageKey === runnerProcess?.stage
      ))
    )) || null;
    const session = (childSession || projectSession)
      ? (() => {
          const sessionProvider = resolveSessionProvider(childSession, projectSession, matchedProject);
          const baseSession = projectSession || {
            id: childSession?.id || runnerProcess?.sessionId || `${workflow.id}-${childAddress}`,
            title: childSession?.title,
            summary: childSession?.summary,
          };
          return {
            ...baseSession,
            routeIndex: projectSession?.routeIndex,
            workflowId: childSession?.workflowId || projectSession?.workflowId || workflow.id,
            projectPath: childSession?.projectPath || projectSession?.projectPath || matchedProject.fullPath || matchedProject.path,
            role: childSession?.role || runnerProcess?.role,
            stageKey: childSession?.stageKey || projectSession?.stageKey || runnerProcess?.stage,
            __provider: sessionProvider,
            __projectName: matchedProject.name,
          };
        })()
      : null;
    return { project: matchedProject, workflow: null, session };
  }

  return { project: matchedProject, workflow: null, session: null };
};

const getDirectSessionRouteIndex = (
  project: Project | null,
  pathname: string,
): number | null => {
  /**
   * PURPOSE: Extract the stable `/cN` route segment for a project-level manual
   * session even when the refreshed sidebar payload has not indexed that session.
   */
  if (!project) {
    return null;
  }

  const normalizedPathname = normalizePathname(pathname);
  const projectRoute = getProjectRoutePath(project);
  if (!normalizedPathname.startsWith(`${projectRoute}/`)) {
    return null;
  }

  const remainder = normalizedPathname.slice(projectRoute.length).replace(/^\/+/g, '');
  const routeSegments = remainder.split('/').filter(Boolean);
  if (routeSegments.length !== 1) {
    return null;
  }

  return parseIndexedRouteSegment(routeSegments[0], 'c');
};

/**
 * Choose the next default manual session label from the persisted high-water counter.
 */
const getHighestManualSessionRouteIndex = (project: Project): number => {
  /**
   * PURPOSE: Find the highest visible manual cN route so optimistic creation
   * never reuses a route that would show an older session.
   */
  return getProjectSessions(project).reduce((maxRouteIndex, session) => {
    const routeIndex = Number(session.routeIndex);
    if (Number.isInteger(routeIndex) && routeIndex > maxRouteIndex) {
      return routeIndex;
    }

    const idRouteIndex = typeof session.id === 'string'
      ? parseIndexedRouteSegment(session.id, 'c')
      : null;
    return idRouteIndex !== null && idRouteIndex > maxRouteIndex
      ? idRouteIndex
      : maxRouteIndex;
  }, 0);
};

const getNextManualSessionRouteIndex = (project: Project): number => {
  /**
   * PURPOSE: Combine the backend high-water counter with the visible route max
   * because either source can be stale in older project configs.
   */
  const persistedNextRouteIndex = Number(project.manualSessionNextRouteIndex);
  const counterNextRouteIndex = Number.isInteger(persistedNextRouteIndex) && persistedNextRouteIndex > 0
    ? persistedNextRouteIndex
    : 1;
  const visibleNextRouteIndex = getHighestManualSessionRouteIndex(project) + 1;

  return Math.max(counterNextRouteIndex, visibleNextRouteIndex);
};

const getNextManualSessionLabel = (project: Project): string => {
  const nextRouteIndex = getNextManualSessionRouteIndex(project);

  return `会话${nextRouteIndex}`;
};

const getOptimisticManualSessionRouteIndex = (project: Project): number => {
  /**
   * PURPOSE: Pick the same next cN route the backend will persist, using the
   * project payload that is already in memory so opening a blank draft is instant.
   */
  return getNextManualSessionRouteIndex(project);
};

/**
 * Preserve the backend project owner for merged worktree sessions.
 */
const withSessionProjectMetadata = (
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
 * PURPOSE: Show a freshly created manual session in the sidebar immediately
 * instead of waiting for the next backend refresh cycle.
 */
const providerToSessionsKey = (provider: SessionProvider): keyof Project => {
  if (provider === 'codex') return 'codexSessions';
  if (provider === 'pi') return 'piSessions';
  throw new Error(`Unsupported session provider: ${String(provider)}`);
};

const insertSessionIntoProject = (
  project: Project,
  session: ProjectSession,
  provider: SessionProvider,
): Project => {
  const targetKey = providerToSessionsKey(provider);
  const currentSessions = Array.isArray(project[targetKey]) ? project[targetKey] as ProjectSession[] : [];
  const withoutDuplicate = currentSessions.filter((entry) => entry.id !== session.id);
  const nextSessions = [session, ...withoutDuplicate];
  const currentTotal = Number(project.sessionMeta?.total || 0);

  return {
    ...project,
    [targetKey]: nextSessions,
    sessionMeta: {
      ...project.sessionMeta,
      total: Math.max(currentTotal, getProjectSessions(project).length + 1),
    },
  };
};

const isUpdateAdditive = (
  currentProjects: Project[],
  updatedProjects: Project[],
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): boolean => {
  if (!selectedProject || !selectedSession) {
    return true;
  }

  const currentSelectedProject = currentProjects.find((project) => project.name === selectedProject.name);
  const updatedSelectedProject = updatedProjects.find((project) => project.name === selectedProject.name);

  if (!currentSelectedProject || !updatedSelectedProject) {
    return false;
  }

  const currentSelectedSession = getProjectSessions(currentSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );
  const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );

  if (!currentSelectedSession || !updatedSelectedSession) {
    return false;
  }

  return (
    currentSelectedSession.id === updatedSelectedSession.id &&
    currentSelectedSession.title === updatedSelectedSession.title &&
    currentSelectedSession.created_at === updatedSelectedSession.created_at &&
    currentSelectedSession.updated_at === updatedSelectedSession.updated_at
  );
};

const VALID_TABS: Set<string> = new Set(['chat', 'files', 'shell', 'preview']);

const readPersistedTab = (): AppTab => {
  /**
   * Restore only main-content tabs. Legacy dock values are handled by the
   * workspace dock layout migration and must not hide the chat surface.
   */
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored === 'workflows' || stored === 'files' || stored === 'shell') {
      return 'chat';
    }
    if (stored && VALID_TABS.has(stored)) {
      return stored as AppTab;
    }
  } catch {
    // localStorage unavailable
  }
  return 'chat';
};

export function useProjectsState({
  locationPathname,
  locationSearch = '',
  navigate,
  messageHistory,
  isMobile,
  activeSessions,
}: UseProjectsStateArgs) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<ProjectWorkflow | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(readPersistedTab);

  useEffect(() => {
    try {
      localStorage.setItem('activeTab', activeTab);
    } catch {
      // Silently ignore storage errors
    }
  }, [activeTab]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('appearance');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWorkflowRefreshKeyRef = useRef<string | null>(null);
  /**
   * Initialize at the current tail so remounting the app shell does not replay stale socket events.
   */
  const lastProcessedMessageSequenceRef = useRef(
    getMessageHistoryTailSequence(messageHistory),
  );
  const selectedWorkflowRef = useRef(selectedWorkflow);
  selectedWorkflowRef.current = selectedWorkflow;
  const handleSidebarRefreshRef = useRef<() => Promise<void>>();
  const projectOverviewRequestKeyRef = useRef<string | null>(null);
  const projectRefreshCoordinatorRef = useRef<ReturnType<typeof createWindowRefreshCoordinator> | null>(null);
  const hasLoadedProjectsRef = useRef(false);

  const fetchProjects = useCallback(async (snapshotVersion?: string) => {
    /**
     * Fetch the lightweight project list and publish the same invalidation
     * version so follower windows can accept the owner snapshot.  Only the
     * first load owns the full-page loading state; later websocket refreshes
     * must keep the current project/workflow view mounted.
     */
    const shouldShowInitialLoading = !hasLoadedProjectsRef.current;
    try {
      if (shouldShowInitialLoading) {
        setIsLoadingProjects(true);
      }
      const response = await api.projects();
      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.status}`);
      }

      const projectData = await response.json();
      if (!Array.isArray(projectData)) {
        throw new Error('Projects API returned a non-array response');
      }
      const fetchedProjects = projectData as Project[];
      hasLoadedProjectsRef.current = true;

      setProjects((prevProjects) => {
        if (prevProjects.length === 0) {
          return fetchedProjects;
        }

        const mergedProjects = mergeProjectSummaries(prevProjects, fetchedProjects);
        return projectsHaveChanges(prevProjects, mergedProjects, true)
          ? mergedProjects
          : prevProjects;
      });
      await projectRefreshCoordinatorRef.current?.publishProjectsSnapshot({
        scope: 'projects:list',
        version: snapshotVersion || String(Date.now()),
        projects: fetchedProjects,
      });
      return fetchedProjects;
    } catch (error) {
      if (isInterruptedFetch(error)) {
        console.warn('Project fetch was interrupted:', error);
      } else {
        console.error('Error fetching projects:', error);
      }
      return null;
    } finally {
      if (shouldShowInitialLoading) {
        setIsLoadingProjects(false);
      }
    }
  }, []);

  useEffect(() => {
    const coordinator = createWindowRefreshCoordinator();
    projectRefreshCoordinatorRef.current = coordinator;
    void coordinator.start();
    return () => {
      void coordinator.dispose();
      if (projectRefreshCoordinatorRef.current === coordinator) {
        projectRefreshCoordinatorRef.current = null;
      }
    };
  }, []);

  const requestCoordinatedProjectRefresh = useCallback(async (invalidation: Record<string, unknown>) => {
    /**
     * Ask sibling windows whether this window owns the heavy project refresh.
     */
    const coordinator = projectRefreshCoordinatorRef.current;
    if (!coordinator) {
      return fetchProjects();
    }

    const decision = await coordinator.requestProjectRefresh({
      ...invalidation,
      scope: String(invalidation.scope || 'projects:list'),
    });
    if (decision.shouldRun) {
      return fetchProjects(String(invalidation.version || ''));
    }

    const expectedVersion = String(invalidation.version || '');
    const snapshot = coordinator.getProjectsSnapshot(decision.scope, expectedVersion)
      || await coordinator.waitForProjectsSnapshot?.(decision.scope, undefined, expectedVersion);
    const projectsSnapshot = Array.isArray(snapshot?.projects) ? snapshot.projects as Project[] : null;
    if (projectsSnapshot) {
      setProjects((prevProjects) => {
        const mergedProjects = mergeProjectSummaries(prevProjects, projectsSnapshot);
        return projectsHaveChanges(prevProjects, mergedProjects, true) ? mergedProjects : prevProjects;
      });
      return projectsSnapshot;
    }
    return null;
  }, [fetchProjects]);

  /**
   * Open settings on the requested tab, defaulting normal entry points to appearance.
   */
  const openSettings = useCallback((tab = 'appearance') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const fetchProjectOverview = useCallback(async (project: Project) => {
    const projectPath = project.fullPath || project.path || '';
    const projectKey = `${project.name}:${projectPath}`;
    projectOverviewRequestKeyRef.current = projectKey;

    try {
      const response = await api.projectOverview(project.name, projectPath);
      if (!response.ok) {
        throw new Error(`Failed to fetch project overview: ${response.status}`);
      }
      const overview = await response.json() as Project;
      setProjects((currentProjects) => currentProjects.map((entry) => (
        projectMatchesOverview(entry, overview)
          ? mergeProjectOverview(entry, overview)
          : entry
      )));
      setSelectedProject((currentProject) => {
        if (!currentProject || !projectMatchesOverview(currentProject, overview)) {
          return currentProject;
        }
        return mergeProjectOverview(currentProject, overview);
      });
      return overview;
    } catch (error) {
      if (isInterruptedFetch(error)) {
        console.warn('Project overview fetch was interrupted:', error);
      } else {
        console.error('Error fetching project overview:', error);
      }
      return null;
    } finally {
      if (projectOverviewRequestKeyRef.current === projectKey) {
        projectOverviewRequestKeyRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    const projectPath = selectedProject.fullPath || selectedProject.path || '';
    const projectKey = `${selectedProject.name}:${projectPath}`;
    const hasOverview = Array.isArray(selectedProject.codexSessions)
      || Array.isArray(selectedProject.piSessions)
      || Array.isArray(selectedProject.workflows)
      || Array.isArray(selectedProject.batches);
    if (hasOverview || projectOverviewRequestKeyRef.current === projectKey) {
      return;
    }

    void fetchProjectOverview(selectedProject);
  }, [fetchProjectOverview, selectedProject]);

  useEffect(() => {
    /**
     * Keep the overview panel bound to the latest project read model after
     * reloads or websocket merges refresh provider session timestamps.
     */
    if (!selectedProject || projects.length === 0) {
      return;
    }

    const selectedProjectPath = selectedProject.fullPath || selectedProject.path || '';
    const refreshedProject = (
      selectedProjectPath
        ? projects.find((project) => project.fullPath === selectedProjectPath || project.path === selectedProjectPath)
        : null
    ) || projects.find((project) => project.name === selectedProject.name);

    if (refreshedProject && serialize(refreshedProject) !== serialize(selectedProject)) {
      setSelectedProject(refreshedProject);
    }
  }, [projects, selectedProject]);

  // Auto-select the project when there is only one, so the user lands on the new session page
  useEffect(() => {
    if (!isLoadingProjects && projects.length === 1 && !selectedProject && locationPathname === '/') {
      setSelectedProject(projects[0]);
    }
  }, [isLoadingProjects, locationPathname, projects, selectedProject]);

  useEffect(() => {
    const pendingMessages = getPendingSocketMessages(messageHistory, lastProcessedMessageSequenceRef.current);
    if (pendingMessages.length === 0) {
      return;
    }

    let projectListInvalidated: Record<string, unknown> | null = null;

    for (const entry of pendingMessages) {
      lastProcessedMessageSequenceRef.current = entry.sequence;
      const latestMessage = entry.message as AppSocketMessage | null;
      if (!latestMessage) {
        continue;
      }

      if (latestMessage.type === 'loading_progress') {
        if (loadingProgressTimeoutRef.current) {
          clearTimeout(loadingProgressTimeoutRef.current);
          loadingProgressTimeoutRef.current = null;
        }

        setLoadingProgress(latestMessage as LoadingProgress);

        if (latestMessage.phase === 'complete') {
          loadingProgressTimeoutRef.current = setTimeout(() => {
            setLoadingProgress(null);
            loadingProgressTimeoutRef.current = null;
          }, 500);
        }
        continue;
      }

      if (latestMessage.type === 'session_changed') {
        const changedSessionId = (latestMessage as Record<string, unknown>)?.sessionId as string | undefined;
        if (sessionChangedMatchesSelectedSession(latestMessage as Record<string, unknown>, selectedSession)) {
          setExternalMessageUpdate((previous) => previous + 1);
        }

        // When viewing a workflow detail page (no selected session), only
        // refresh if the changed session is a known child of the current
        // workflow.  Broader project-scoped matching would re-introduce the
        // unconditional /api/projects calls the proposal removes; unknown
        // sessions rely on the finite retry calibration instead.
        if (!selectedSession && selectedWorkflowRef.current && changedSessionId) {
          const childSessions = selectedWorkflowRef.current.childSessions || [];
          if (childSessions.some((cs) => sessionChangedMatchesSelectedSession(latestMessage as Record<string, unknown>, cs))) {
            handleSidebarRefreshRef.current?.();
          }
        }
        continue;
      }

      if (latestMessage.type === 'project_list_invalidated') {
        projectListInvalidated = latestMessage as Record<string, unknown>;
        continue;
      }

      if (latestMessage.type === 'workflow_changed') {
        const changedRunId = (latestMessage as Record<string, unknown>)?.runId as string | undefined;
        if (selectedWorkflowRef.current?.runId && changedRunId && selectedWorkflowRef.current.runId === changedRunId) {
          handleSidebarRefreshRef.current?.();
        }
        continue;
      }
    }

    if (projectListInvalidated) {
      void requestCoordinatedProjectRefresh(projectListInvalidated);
    }

    const projectMessages = pendingMessages
      .map((entry) => entry.message as ProjectsUpdatedMessage | null)
      .filter((message): message is ProjectsUpdatedMessage => Boolean(message && message.type === 'projects_updated'));

    if (projectMessages.length === 0) {
      return;
    }

    const reducedState = reduceProjectsUpdatedMessages({
      messages: projectMessages,
      projects,
      selectedProject,
      selectedSession,
      activeSessions,
      getProjectSessions: getProjectSessions as unknown as (project: Record<string, unknown>) => Array<Record<string, unknown>>,
      isUpdateAdditive: isUpdateAdditive as (
        currentProjects: Array<Record<string, unknown>>,
        updatedProjects: Array<Record<string, unknown>>,
        selectedProject: Record<string, unknown> | null,
        selectedSession: Record<string, unknown> | null,
      ) => boolean,
    }) as {
      projects: Project[];
      selectedProject: Project | null;
      selectedSession: ProjectSession | null;
      externalMessageUpdateCount: number;
    };

    if (reducedState.externalMessageUpdateCount > 0) {
      setExternalMessageUpdate((previous) => previous + reducedState.externalMessageUpdateCount);
    }

    if (serialize(reducedState.projects) !== serialize(projects)) {
      setProjects(reducedState.projects);
    }

    if (serialize(reducedState.selectedProject) !== serialize(selectedProject)) {
      setSelectedProject(reducedState.selectedProject);
    }

    if (serialize(reducedState.selectedSession) !== serialize(selectedSession)) {
      setSelectedSession(reducedState.selectedSession);
    }
  }, [messageHistory, selectedProject, selectedSession, activeSessions, projects, requestCoordinatedProjectRefresh]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    /**
     * URL changes must update the selected project/session before the browser
     * paints the next route, otherwise the chat pane can briefly show the
     * previous session under the new cN URL.
     */
    const legacySessionMatch = normalizePathname(locationPathname).match(/^\/session\/([^/]+)$/);
    if (legacySessionMatch) {
      const searchParams = new URLSearchParams(locationSearch);
      const hintedProjectPath = searchParams.get('projectPath') || '';
      const rawProvider = searchParams.get('provider');
      const hintedProvider: SessionProvider = rawProvider === 'pi' ? 'pi' : 'codex';
      const decodedSessionId = decodeURIComponent(legacySessionMatch[1]);
      const requestedSessionSummary = String(searchParams.get('sessionSummary') || '').trim();
      const matchedProject = projects.find((project) => (
        normalizeComparablePath(project.fullPath || project.path || '') === normalizeComparablePath(hintedProjectPath)
      )) || null;
      const matchedSession = decodedSessionId && !matchedProject
        ? findProjectSessionById(projects, decodedSessionId, hintedProvider)
        : null;
      const resolvedProject = matchedProject || matchedSession?.project || null;

      if (resolvedProject && decodedSessionId) {
        const existingSession = matchedSession?.session || getProjectSessions(resolvedProject).find(
          (entry) => entry.id === decodedSessionId && (entry.__provider || hintedProvider) === hintedProvider,
        );
        const cNMatch = decodedSessionId.match(/^c(\d+)$/);
        const cNRouteIndex = cNMatch ? Number(cNMatch[1]) : undefined;
        const fallbackSession = {
          id: decodedSessionId,
          title: requestedSessionSummary || decodedSessionId,
          summary: requestedSessionSummary || decodedSessionId,
          routeIndex: existingSession?.routeIndex ?? cNRouteIndex,
        } as ProjectSession;
        const nextSession = withSessionProjectMetadata(
          existingSession || fallbackSession,
          resolvedProject,
          hintedProvider,
        );

        if (serialize(selectedProject) !== serialize(resolvedProject)) {
          setSelectedProject(resolvedProject);
        }
        if (
          selectedSession?.id !== nextSession.id
          || selectedSession?.__provider !== nextSession.__provider
          || selectedSession?.__projectName !== nextSession.__projectName
        ) {
          setSelectedSession(nextSession);
        }
        if (selectedWorkflow) {
          setSelectedWorkflow(null);
        }
      }
      return;
    }

    const resolvedSelection = resolveRouteSelection(projects, locationPathname);
    const resolvedProject = resolvedSelection.project;
    const resolvedWorkflow = resolvedSelection.workflow;
    const resolvedSession = resolvedSelection.session;

    if (!resolvedProject) {
      if (normalizePathname(locationPathname) === '/') {
        if (selectedWorkflow) {
          setSelectedWorkflow(null);
        }
        if (selectedSession) {
          setSelectedSession(null);
        }
      }
      return;
    }

    if (serialize(selectedProject) !== serialize(resolvedProject)) {
      setSelectedProject(resolvedProject);
    }

    if (resolvedWorkflow) {
      if (serialize(selectedWorkflow) !== serialize(resolvedWorkflow)) {
        setSelectedWorkflow(resolvedWorkflow);
      }
      if (selectedSession) {
        setSelectedSession(null);
      }
      return;
    }

    if (resolvedSession) {
      const provider = resolvedSession.__provider || ((resolvedProject.codexSessions || []).some(
        (session) => session.id === resolvedSession.id,
      ) ? 'codex' : (resolvedProject.piSessions || []).some(
        (session) => session.id === resolvedSession.id,
      ) ? 'pi' : 'codex');
      const nextSession = withSessionProjectMetadata(resolvedSession, resolvedProject, provider);
      if (
        selectedSession?.id !== nextSession.id
        || selectedSession?.routeIndex !== nextSession.routeIndex
        || selectedSession?.__provider !== nextSession.__provider
        || selectedSession?.__projectName !== nextSession.__projectName
      ) {
        setSelectedSession(nextSession);
      }
      if (selectedWorkflow) {
        setSelectedWorkflow(null);
      }
      return;
    }

    const directSessionRouteIndex = getDirectSessionRouteIndex(resolvedProject, locationPathname);
    if (
      selectedSession
      && directSessionRouteIndex
      && selectedSession.routeIndex === directSessionRouteIndex
      && selectedSession.__projectName === resolvedProject.name
    ) {
      if (selectedWorkflow) {
        setSelectedWorkflow(null);
      }
      return;
    }

    if (selectedSession) {
      setSelectedSession(null);
    }
    if (selectedWorkflow) {
      setSelectedWorkflow(null);
    }
  }, [locationPathname, locationSearch, projects, selectedProject, selectedSession, selectedWorkflow]);

  useEffect(() => {
    /**
     * A hard refresh can preserve an old pending session id from a previous
     * draft handoff. Once the current route resolves to a concrete session,
     * that stale value must not be allowed to redirect the next message turn.
     */
    if (typeof window === 'undefined') {
      return;
    }

    if (!selectedSession?.id || isTemporarySessionId(selectedSession.id)) {
      return;
    }

    const pendingSessionId = window.sessionStorage.getItem('pendingSessionId');
    if (pendingSessionId && pendingSessionId !== selectedSession.id) {
      window.sessionStorage.removeItem('pendingSessionId');
    }
  }, [selectedSession?.id]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setSelectedWorkflow(null);
      setActiveTab('chat');
      navigate(buildProjectRoute(project));
    },
    [navigate],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      setSelectedSession(session);
      setSelectedWorkflow(null);

      if (activeTab === 'preview') {
        setActiveTab('chat');
      }

      const sessionProjectName = session.__projectName || selectedProject?.name || '';
      const sessionProjectPath = session.projectPath || selectedProject?.fullPath || selectedProject?.path || '';
      const sessionProject = {
        fullPath: sessionProjectPath,
        path: sessionProjectPath,
        name: sessionProjectName,
        routePath: selectedProject?.routePath,
      };
      navigate(
        buildProjectSessionRoute(sessionProject, session),
      );
    },
    [activeTab, navigate, selectedProject?.fullPath, selectedProject?.name, selectedProject?.path, selectedProject?.routePath],
  );

  const handleNewSession = useCallback(
    async (project: Project, provider: SessionProvider = 'codex', options: NewSessionOptions = {}) => {
      const isManualSessionDraft = !options.workflowId;
      const defaultSessionLabel = getNextManualSessionLabel(project);
      let sessionSummary = typeof options.sessionSummary === 'string' ? options.sessionSummary.trim() : '';

      const shouldPromptForLabel = options.promptForLabel !== false;

      if (!sessionSummary && shouldPromptForLabel && isManualSessionDraft && typeof window !== 'undefined') {
        const requestedLabel = window.prompt('请输入会话名称', defaultSessionLabel);
        if (requestedLabel === null) {
          return;
        }
        sessionSummary = requestedLabel.trim() || defaultSessionLabel;
      }

      if (!sessionSummary) {
        sessionSummary = isManualSessionDraft ? defaultSessionLabel : '新会话';
      }

      let draftSession: ProjectSession = {
        id: `new-session-${Date.now()}`,
        routeIndex: undefined,
      };
      let persistManualDraft: Promise<Response> | null = null;
      if (isManualSessionDraft) {
        const routeIndex = getOptimisticManualSessionRouteIndex(project);
        draftSession = {
          id: `c${routeIndex}`,
          routeIndex,
          provider,
          label: sessionSummary,
          title: sessionSummary,
          summary: sessionSummary,
          name: sessionSummary,
          projectName: project.name,
          projectPath: project.fullPath || project.path || '',
          createdAt: new Date().toISOString(),
        };
        persistManualDraft = api.createManualSessionDraft(project.name, {
          provider,
          label: sessionSummary,
          projectPath: project.fullPath || project.path || '',
          routeIndex,
        });
      }

      let navigationProject = project;
      let targetWorkflow = findWorkflowById(project, options.workflowId);
      if (options.workflowId && !targetWorkflow) {
        const knownProject = projects.find((entry) => entry.name === project.name) || null;
        const knownWorkflow = findWorkflowById(knownProject, options.workflowId);
        if (knownProject && knownWorkflow) {
          navigationProject = knownProject;
          targetWorkflow = knownWorkflow;
        } else {
          try {
            const response = await api.projects();
            if (response.ok) {
              const freshProjects = (await response.json()) as Project[];
              const mergedFreshProjects = mergeProjectSummaries(projects, freshProjects);
              const freshProject = mergedFreshProjects.find((entry) => entry.name === project.name) || null;
              const freshWorkflow = findWorkflowById(freshProject, options.workflowId);
              if (freshProject && freshWorkflow) {
                navigationProject = freshProject;
                targetWorkflow = freshWorkflow;
                setProjects((prevProjects) => (
                  projectsHaveChanges(prevProjects, mergedFreshProjects, true) ? mergedFreshProjects : prevProjects
                ));
              }
            }
          } catch (error) {
            console.error('Error refreshing workflow route target:', error);
          }
        }
      }

      const syntheticSession = withSessionProjectMetadata(
        {
          id: draftSession.id,
          routeIndex: draftSession.routeIndex,
          label: sessionSummary,
          title: sessionSummary,
          summary: sessionSummary,
          workflowId: draftSession.workflowId || options.workflowId,
          stageKey: draftSession.stageKey || options.workflowStageKey,
          projectPath: draftSession.projectPath || navigationProject.fullPath || navigationProject.path || '',
          initialPrompt: typeof options.initialPrompt === 'string' ? options.initialPrompt : undefined,
        },
        navigationProject,
        provider,
      );
      const nextManualSessionRouteIndex = isManualSessionDraft && Number.isInteger(Number(draftSession.routeIndex))
        ? Number(draftSession.routeIndex) + 1
        : navigationProject.manualSessionNextRouteIndex;
      const projectWithSyntheticSession = {
        ...insertSessionIntoProject(navigationProject, syntheticSession, provider),
        manualSessionNextRouteIndex: nextManualSessionRouteIndex,
      };

      const initialPrompt = typeof options.initialPrompt === 'string' ? options.initialPrompt : '';
      if (initialPrompt.trim() && isManualSessionDraft && typeof window !== 'undefined') {
        window.localStorage.setItem(`draft_input_${navigationProject.name}`, initialPrompt);
      }

      setProjects((prevProjects) => prevProjects.map((entry) => (
        entry.name === navigationProject.name
          ? {
            ...insertSessionIntoProject(entry, syntheticSession, provider),
            manualSessionNextRouteIndex: nextManualSessionRouteIndex,
          }
          : entry
      )));
      setSelectedProject(projectWithSyntheticSession);
      setSelectedSession(syntheticSession);
      setSelectedWorkflow(null);
      setActiveTab('chat');
      const baseRoute = targetWorkflow
        ? buildWorkflowChildSessionRoute(projectWithSyntheticSession, targetWorkflow, syntheticSession)
        : buildProjectSessionRoute(projectWithSyntheticSession, syntheticSession);
      // Append provider query param so page refresh can restore Pi context.
      const routeWithProvider = provider === 'pi'
        ? `${baseRoute}${baseRoute.includes('?') ? '&' : '?'}provider=pi&projectPath=${encodeURIComponent(syntheticSession.projectPath || projectWithSyntheticSession.fullPath || projectWithSyntheticSession.path || '')}`
        : baseRoute;
      navigate(routeWithProvider);

      if (persistManualDraft) {
        persistManualDraft
          .then(async (response) => {
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              const message = typeof payload?.error === 'string' && payload.error
                ? payload.error
                : `Failed to create manual session draft (${response.status})`;
              throw new Error(message);
            }
            const createdSession = payload?.session;
            if (typeof createdSession?.id !== 'string' || !createdSession.id) {
              throw new Error('Manual session draft did not return a valid id');
            }
            if (createdSession.id !== draftSession.id) {
              const correctedSession = withSessionProjectMetadata(
                {
                  ...syntheticSession,
                  ...createdSession,
                  label: createdSession.label || createdSession.title || sessionSummary,
                  title: createdSession.title || createdSession.label || sessionSummary,
                  summary: createdSession.summary || createdSession.title || sessionSummary,
                  projectPath: createdSession.projectPath || syntheticSession.projectPath,
                },
                navigationProject,
                provider,
              );
              const sessionsKey = providerToSessionsKey(provider);
              const withoutOptimisticSession = {
                ...navigationProject,
                [sessionsKey]: (
                  Array.isArray(navigationProject[sessionsKey])
                    ? navigationProject[sessionsKey] as ProjectSession[]
                    : []
                ).filter((session) => session.id !== draftSession.id),
              };
              const correctedProject = {
                ...insertSessionIntoProject(withoutOptimisticSession, correctedSession, provider),
                manualSessionNextRouteIndex: Number(correctedSession.routeIndex) + 1,
              };
              setProjects((prevProjects) => prevProjects.map((entry) => {
                if (entry.name !== navigationProject.name) {
                  return entry;
                }
                const entryWithoutOptimisticSession = {
                  ...entry,
                  [sessionsKey]: (
                    Array.isArray(entry[sessionsKey])
                      ? entry[sessionsKey] as ProjectSession[]
                      : []
                  ).filter((session) => session.id !== draftSession.id),
                };
                return {
                  ...insertSessionIntoProject(entryWithoutOptimisticSession, correctedSession, provider),
                  manualSessionNextRouteIndex: Number(correctedSession.routeIndex) + 1,
                };
              }));
              setSelectedProject(correctedProject);
              setSelectedSession(correctedSession);
              const correctedRoute = buildProjectSessionRoute(correctedProject, correctedSession);
              navigate(provider === 'pi'
                ? `${correctedRoute}${correctedRoute.includes('?') ? '&' : '?'}provider=pi&projectPath=${encodeURIComponent(correctedSession.projectPath || correctedProject.fullPath || correctedProject.path || '')}`
                : correctedRoute);
            }
          })
          .catch((error) => {
            console.error('Error creating manual session draft:', error);
            setProjects((prevProjects) => prevProjects.map((entry) => (
              entry.name === navigationProject.name
                ? {
                  ...entry,
                  [providerToSessionsKey(provider)]: (
                    Array.isArray(entry[providerToSessionsKey(provider)])
                      ? entry[providerToSessionsKey(provider)] as ProjectSession[]
                      : []
                  ).filter((session) => session.id !== draftSession.id),
                }
                : entry
            )));
          });
      }
      return { ok: true as const };
    },
    [navigate, projects],
  );

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        setSelectedWorkflow(null);
        navigate(selectedProject ? buildProjectRoute(selectedProject) : '/');
      }

      setProjects((prevProjects) =>
        prevProjects.map((project) => ({
          ...project,
          sessions: project.sessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
          codexSessions: project.codexSessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
          piSessions: project.piSessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
          sessionMeta: {
            ...project.sessionMeta,
            total: Math.max(0, (project.sessionMeta?.total as number | undefined ?? 0) - 1),
          },
        })),
      );
    },
    [navigate, selectedProject, selectedSession?.id],
  );

  const handleWorkflowSelect = useCallback(
    (project: Project, workflow: ProjectWorkflow) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setSelectedWorkflow(workflow);
      setActiveTab('chat');
      navigate(buildProjectWorkflowRoute(project, workflow));
    },
    [navigate],
  );

  const handleSidebarRefresh = useCallback(async () => {
    try {
      const freshProjects = await requestCoordinatedProjectRefresh({
        type: 'project_list_invalidated',
        scope: 'projects:list',
        reason: 'manual-sidebar-refresh',
        version: String(Date.now()),
      }) || projects;

      const mergedFreshProjects = mergeProjectSummaries(projects, freshProjects);
      setProjects((prevProjects) => {
        const nextProjects = mergeProjectSummaries(prevProjects, freshProjects);
        return projectsHaveChanges(prevProjects, nextProjects, true) ? nextProjects : prevProjects;
      });

      if (!selectedProject) {
        return;
      }

      const refreshedProject = mergedFreshProjects.find((project) => project.name === selectedProject.name);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        if (selectedWorkflow) {
          const overview = await fetchProjectOverview(refreshedProject);
          const workflowSource = overview || refreshedProject;
          const refreshedWorkflow =
            workflowSource.workflows?.find((workflow) => workflow.id === selectedWorkflow.id) || null;

          if (serialize(refreshedWorkflow) !== serialize(selectedWorkflow)) {
            setSelectedWorkflow(refreshedWorkflow);
          }
        }
        return;
      }

      const refreshedSession = findRefreshedSelectedSession(
        refreshedProject,
        selectedSession,
      );

      if (refreshedSession) {
        const normalizedRefreshedSession = withSessionProjectMetadata(
          refreshedSession,
          refreshedProject,
          selectedSession.__provider || 'codex',
        );

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      if (isInterruptedFetch(error)) {
        console.warn('Sidebar refresh was interrupted:', error);
      } else {
        console.error('Error refreshing sidebar:', error);
      }
    }
  }, [fetchProjectOverview, projects, requestCoordinatedProjectRefresh, selectedProject, selectedSession, selectedWorkflow]);

  handleSidebarRefreshRef.current = handleSidebarRefresh;

  useEffect(() => {
    /**
     * Workflow details can stay on an in-memory snapshot while the backend read
     * model changes underneath, so re-fetch once whenever a concrete workflow
     * route becomes active.
     */
    if (!selectedWorkflow?.id || !selectedProject || selectedSession) {
      lastWorkflowRefreshKeyRef.current = null;
      return;
    }

    if (selectedWorkflow.workflowRoleSummary && selectedWorkflow.stageInspections?.length) {
      return;
    }

    const refreshKey = `${selectedProject.name}:${selectedWorkflow.id}`;
    if (lastWorkflowRefreshKeyRef.current === refreshKey) {
      return;
    }

    lastWorkflowRefreshKeyRef.current = refreshKey;
    void handleSidebarRefresh();
  }, [handleSidebarRefresh, selectedProject, selectedSession, selectedWorkflow?.id]);

  useEffect(() => {
    if (
      !selectedProject
      || selectedSession
      || !selectedWorkflow?.id
      || !shouldPollWorkflowPlanningSession(selectedWorkflow)
    ) {
      return undefined;
    }

    /**
     * Finite retry for planning child-session recovery instead of infinite
     * polling.  Stop when the session appears, max retries exhausted, or
     * page navigates away.
     */
    const MAX_RETRIES = 3;
    const DELAYS_MS = [250, 750, 1500];
    let attempts = 0;
    let cancelled = false;
    let currentTimeout: number | null = null;

    const retry = async () => {
      if (cancelled || attempts >= MAX_RETRIES) {
        return;
      }
      try {
        await handleSidebarRefresh();
      } finally {
        if (cancelled) {
          return;
        }
        attempts += 1;
        if (attempts < MAX_RETRIES) {
          currentTimeout = window.setTimeout(retry, DELAYS_MS[Math.min(attempts, DELAYS_MS.length - 1)]);
        }
      }
    };

    // Immediate first attempt
    void retry();

    return () => {
      cancelled = true;
      if (currentTimeout) {
        window.clearTimeout(currentTimeout);
      }
    };
  }, [
    handleSidebarRefresh,
    selectedProject,
    selectedSession,
    selectedWorkflow,
  ]);

  const handleProjectDelete = useCallback(
    (projectName: string) => {
      if (selectedProject?.name === projectName) {
        setSelectedProject(null);
        setSelectedSession(null);
        setSelectedWorkflow(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.name !== projectName));
    },
    [navigate, selectedProject?.name],
  );

  const effectiveSelectedProject = useMemo(() => {
    /**
     * Render from the canonical projects array when it has a fresher copy of
     * the selected project than state restored during route hydration.
     */
    if (!selectedProject) {
      return null;
    }

    const selectedProjectPath = selectedProject.fullPath || selectedProject.path || '';
    return (
      selectedProjectPath
        ? projects.find((project) => project.fullPath === selectedProjectPath || project.path === selectedProjectPath)
        : null
    ) || projects.find((project) => project.name === selectedProject.name) || selectedProject;
  }, [projects, selectedProject]);

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject: effectiveSelectedProject,
      onProjectSelect: handleProjectSelect,
      onNewSession: handleNewSession,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => setShowSettings(true),
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
    }),
    [
      handleNewSession,
      handleProjectDelete,
      handleProjectSelect,
      handleSidebarRefresh,
      isLoadingProjects,
      isMobile,
      loadingProgress,
      projects,
      settingsInitialTab,
      effectiveSelectedProject,
      showSettings,
    ],
  );

  return {
    projects,
    selectedProject: effectiveSelectedProject,
    selectedSession,
    selectedWorkflow,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    loadingProgress,
    isInputFocused,
    showSettings,
    settingsInitialTab,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    fetchProjects,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleWorkflowSelect,
    handleNewSession,
    handleSessionDelete,
    handleProjectDelete,
    handleSidebarRefresh,
  };
}
