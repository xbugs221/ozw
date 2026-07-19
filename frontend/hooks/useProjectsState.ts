/**
 * PURPOSE: Compose project, session, workflow, and sidebar state for the app
 * shell while delegating route, collection, and refresh business rules.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { SocketMessageEnvelope } from '../contexts/WebSocketContext';
import { getMessageHistoryTailSequence } from '../../shared/socket-message-utils';
import { api } from '../utils/api';
import { createWindowRefreshCoordinator } from '../utils/windowRefreshCoordinator';
import type { SessionProvider } from '../types/app';
import { buildProjectRoute, buildProjectSessionRoute, buildProjectWorkflowRoute, buildWorkflowChildSessionRoute, getProjectRoutePath } from '../utils/projectRoute';
import type { NewSessionOptions } from '../utils/workflowAutoStart';
import { findWorkflowById, shouldPollWorkflowPlanningSession } from './projects/projectRouteSelection';
import { getNextManualSessionLabel, getOptimisticManualSessionRouteIndex, getProjectSessions, insertSessionIntoProject, withSessionProjectMetadata } from './projects/projectSessionCollections';
import { findRefreshedSelectedSession, isInterruptedFetch, isTemporarySessionId, mergeProjectOverview, mergeProjectSummaries, mergeProjectSummary, normalizeComparablePath, projectMatchesOverview, projectsHaveChanges, serialize } from './projects/projectRefreshReducer';
import type { AppTab, LoadingProgress, Project, ProjectSession, ProjectWorkflow } from '../types/app';
import { useProjectRouteSelectionSync, useProjectsRealtimeReducers } from './projectsStateReducers';
import { refreshSidebarSelection } from './projectsStateRefreshController';
type UseProjectsStateArgs = {
  locationPathname: string;
  locationSearch?: string;
  navigate: NavigateFunction;
  messageHistory: SocketMessageEnvelope[];
  isMobile: boolean;
  activeSessions: Set<string>;
};
const VALID_TABS: Set<string> = new Set(['overview', 'chat', 'files', 'shell', 'preview']);
const readPersistedTab = (): AppTab => {
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored === 'workflows' || stored === 'files' || stored === 'shell') {
      return 'chat';
    }
    if (stored && VALID_TABS.has(stored)) {
      return stored as AppTab;
    }
  } catch {
  }
  return 'chat';
};

function hasStableSessionRoute(session: ProjectSession): boolean {
  /**
   * 判断 session 是否能使用项目内 cN 短路由。
   */
  const routeIndex = Number(session.routeIndex);
  return (Number.isInteger(routeIndex) && routeIndex > 0) || /^c\d+$/.test(String(session.id || ''));
}

function buildSessionNavigationUrl(
  project: Pick<Project, 'fullPath' | 'path' | 'name' | 'routePath'>,
  session: ProjectSession,
): string {
  /**
   * 为项目会话生成导航 URL；无 cN 绑定的 provider 历史会话回退到兼容路由。
   */
  const provider: SessionProvider = session.__provider === 'pi' ? 'pi' : session.__provider === 'claude' ? 'claude' : 'codex';
  const projectPath = session.projectPath || project.fullPath || project.path || '';

  if (hasStableSessionRoute(session)) {
    return buildProjectSessionRoute(project, session);
  }

  const params = new URLSearchParams({
    provider,
    projectPath,
  });
  const sessionSummary = String(session.summary || session.title || session.name || '').trim();
  if (sessionSummary) {
    params.set('sessionSummary', sessionSummary);
  }
  return `/session/${encodeURIComponent(String(session.id || ''))}?${params.toString()}`;
}

export function useProjectsState({
  locationPathname,
  locationSearch = '',
  navigate,
  messageHistory,
  isMobile,
  activeSessions,
}: UseProjectsStateArgs) {
  /**
   * Keep React state/effects and API orchestration together while pure project
   * selection rules live in frontend/hooks/projects.
   */
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<ProjectWorkflow | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(readPersistedTab);
  useEffect(() => {
    /**
     * 显式入口的 URL tab 优先于本地持久化，确保会话卡片能直接打开终端。
     */
    const tab = new URLSearchParams(locationSearch).get('tab');
    if (tab && VALID_TABS.has(tab)) {
      setActiveTab(tab as AppTab);
    }
  }, [locationSearch]);
  useEffect(() => {
    /** Entering a concrete session defaults to its live TUI unless the URL explicitly selects another tab. */
    if (!selectedSession?.id) return;
    const explicitTab = new URLSearchParams(locationSearch).get('tab');
    if (!explicitTab) {
      setActiveTab('shell');
    }
  }, [locationSearch, selectedSession?.id]);
  useEffect(() => {
    /**
     * 让项目主页和会话消息成为两个独立入口，避免项目路由继续高亮消息 Tab。
     */
    if (selectedProject && !selectedSession && !selectedWorkflow) {
      const normalizedPathname = locationPathname.replace(/\/+$/g, '') || '/';
      if (normalizedPathname === getProjectRoutePath(selectedProject)) {
        setActiveTab('overview');
      }
    }
  }, [locationPathname, selectedProject, selectedSession, selectedWorkflow]);

  useEffect(() => {
    /**
     * 从主页进入具体会话时，顶部入口回到消息态。
     */
    if ((selectedSession || selectedWorkflow) && activeTab === 'overview') {
      setActiveTab('chat');
    }
  }, [activeTab, locationPathname, selectedProject, selectedSession, selectedWorkflow]);
  useEffect(() => {
    try {
      localStorage.setItem('activeTab', activeTab);
    } catch {
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
      || Array.isArray(selectedProject.claudeSessions)
      || Array.isArray(selectedProject.workflows)
      || Array.isArray(selectedProject.batches);
    if (hasOverview || projectOverviewRequestKeyRef.current === projectKey) {
      return;
    }
    void fetchProjectOverview(selectedProject);
  }, [fetchProjectOverview, selectedProject]);
  useEffect(() => {
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
      setSelectedProject(mergeProjectSummary(selectedProject, refreshedProject));
    }
  }, [projects, selectedProject]);
  useEffect(() => {
    if (!isLoadingProjects && projects.length === 1 && !selectedProject && locationPathname === '/') {
      setSelectedProject(projects[0]);
    }
  }, [isLoadingProjects, locationPathname, projects, selectedProject]);
  useProjectsRealtimeReducers({
    activeSessions,
    fetchProjectOverview,
    handleSidebarRefreshRef,
    lastProcessedMessageSequenceRef,
    loadingProgressTimeoutRef,
    messageHistory,
    projects,
    requestCoordinatedProjectRefresh,
    selectedProject,
    selectedSession,
    selectedWorkflowRef,
    setExternalMessageUpdate,
    setLoadingProgress,
    setProjects,
    setSelectedProject,
    setSelectedSession,
  });
  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
    };
  }, []);
  useProjectRouteSelectionSync({
    fetchProjectOverview,
    locationPathname,
    locationSearch,
    projects,
    selectedProject,
    selectedSession,
    selectedWorkflow,
    setSelectedProject,
    setSelectedSession,
    setSelectedWorkflow,
  });
  useEffect(() => {
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
      setActiveTab('overview');
      navigate(buildProjectRoute(project));
      void fetchProjectOverview(project);
    },
    [fetchProjectOverview, navigate],
  );
  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      setSelectedSession(session);
      setSelectedWorkflow(null);
      setActiveTab('shell');
      const sessionProjectName = session.__projectName || selectedProject?.name || '';
      const sessionProjectPath = session.projectPath || selectedProject?.fullPath || selectedProject?.path || '';
      const sessionProject = {
        fullPath: sessionProjectPath,
        path: sessionProjectPath,
        name: sessionProjectName,
        routePath: selectedProject?.routePath,
      };
      navigate(
        buildSessionNavigationUrl(sessionProject, session),
      );
    },
    [navigate, selectedProject?.fullPath, selectedProject?.name, selectedProject?.path, selectedProject?.routePath],
  );
  const handleNewSession = useCallback(
    async (project: Project, provider: SessionProvider = 'codex', options: NewSessionOptions = {}) => {
      const isManualSessionDraft = !options.workflowId;
      const projectPath = normalizeComparablePath(project.fullPath || project.path || '');
      const currentProjectSnapshot = projects.find((entry) => {
        const entryPath = normalizeComparablePath(entry.fullPath || entry.path || '');
        return Boolean(
          (projectPath && entryPath && projectPath === entryPath) ||
          (project.name && entry.name === project.name),
        );
      }) || null;
      const optimisticRouteIndex = isManualSessionDraft
        ? Math.max(
          getOptimisticManualSessionRouteIndex(project),
          currentProjectSnapshot ? getOptimisticManualSessionRouteIndex(currentProjectSnapshot) : 0,
        )
        : 0;
      const defaultSessionLabel = isManualSessionDraft
        ? `会话${optimisticRouteIndex}`
        : getNextManualSessionLabel(project);
      let sessionSummary = typeof options.sessionSummary === 'string' ? options.sessionSummary.trim() : '';
      let useBackendDefaultSessionLabel = isManualSessionDraft && !sessionSummary;
      const shouldPromptForLabel = options.promptForLabel !== false;
      if (!sessionSummary && shouldPromptForLabel && isManualSessionDraft && typeof window !== 'undefined') {
        const requestedLabel = window.prompt('请输入会话名称', defaultSessionLabel);
        if (requestedLabel === null) {
          return;
        }
        const trimmedLabel = requestedLabel.trim();
        useBackendDefaultSessionLabel = !trimmedLabel || trimmedLabel === defaultSessionLabel;
        sessionSummary = useBackendDefaultSessionLabel ? defaultSessionLabel : trimmedLabel;
      }
      if (!sessionSummary) {
        sessionSummary = isManualSessionDraft ? defaultSessionLabel : '新会话';
      }
      let draftSession: ProjectSession = {
        id: `new-session-${Date.now()}`,
        routeIndex: undefined,
      };
      if (isManualSessionDraft) {
        let payload: Record<string, any> | null = null;
        try {
          const response = await api.createManualSessionDraft(project.name, {
            provider,
            label: useBackendDefaultSessionLabel ? '' : sessionSummary,
            projectPath: project.fullPath || project.path || '',
          });
          payload = await response.json().catch(() => null);
          if (!response.ok) {
            const message = typeof payload?.error === 'string' && payload.error
              ? payload.error
              : `Failed to create manual session draft (${response.status})`;
            throw new Error(message);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('Error creating manual session draft:', error);
          return { ok: false as const, error: message };
        }

        const createdSession = payload?.session;
        if (typeof createdSession?.id !== 'string' || !createdSession.id) {
          return { ok: false as const, error: 'Manual session draft did not return a valid id' };
        }
        const routeIndex = Number(createdSession.routeIndex);
        if (!Number.isInteger(routeIndex) || routeIndex <= 0) {
          return { ok: false as const, error: 'Manual session draft did not return a valid route index' };
        }
        const resolvedLabel = createdSession.label || createdSession.title || sessionSummary || `会话${routeIndex}`;
        sessionSummary = resolvedLabel;
        draftSession = {
          ...createdSession,
          id: createdSession.id,
          routeIndex,
          provider,
          label: resolvedLabel,
          title: createdSession.title || resolvedLabel,
          summary: createdSession.summary || createdSession.title || resolvedLabel,
          name: createdSession.name || resolvedLabel,
          projectName: createdSession.projectName || project.name,
          projectPath: createdSession.projectPath || project.fullPath || project.path || '',
          createdAt: createdSession.createdAt || new Date().toISOString(),
        };
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
      // New sessions start in the live terminal; rendered history is opened explicitly.
      setActiveTab('shell');
      const baseRoute = targetWorkflow
        ? buildWorkflowChildSessionRoute(projectWithSyntheticSession, targetWorkflow, syntheticSession)
        : buildProjectSessionRoute(projectWithSyntheticSession, syntheticSession);
      navigate(provider === 'codex' ? baseRoute : `${baseRoute}?provider=${encodeURIComponent(provider)}`);
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
          claudeSessions: project.claudeSessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
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
    await refreshSidebarSelection({
      fetchProjectOverview,
      projects,
      requestCoordinatedProjectRefresh,
      selectedProject,
      selectedSession,
      selectedWorkflow,
      setProjects,
      setSelectedProject,
      setSelectedSession,
      setSelectedWorkflow,
    });
  }, [fetchProjectOverview, projects, requestCoordinatedProjectRefresh, selectedProject, selectedSession, selectedWorkflow]);
  handleSidebarRefreshRef.current = handleSidebarRefresh;
  useEffect(() => {
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
