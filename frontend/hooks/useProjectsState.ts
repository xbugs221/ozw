/**
 * PURPOSE: Compose project, session, workflow, and sidebar state for the app
 * shell while delegating route, collection, and refresh business rules.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { SocketMessageEnvelope } from '../contexts/WebSocketContext';
import { getMessageHistoryTailSequence, getPendingSocketMessages, reduceProjectsUpdatedMessages, sessionChangedMatchesSelectedSession } from '../../shared/socket-message-utils';
import { api } from '../utils/api';
import { createWindowRefreshCoordinator } from '../utils/windowRefreshCoordinator';
import type { SessionProvider } from '../types/app';
import { buildProjectRoute, buildProjectSessionRoute, buildProjectWorkflowRoute, buildWorkflowChildSessionRoute } from '../utils/projectRoute';
import type { NewSessionOptions } from '../utils/workflowAutoStart';
import { findWorkflowById, getDirectSessionRouteIndex, normalizePathname, resolveRouteSelection, shouldPollWorkflowPlanningSession } from './projects/projectRouteSelection';
import { findProjectSessionById, getNextManualSessionLabel, getOptimisticManualSessionRouteIndex, getProjectSessions, insertSessionIntoProject, isUpdateAdditive, providerToSessionsKey, withSessionProjectMetadata } from './projects/projectSessionCollections';
import { findRefreshedSelectedSession, isInterruptedFetch, isTemporarySessionId, mergeProjectOverview, mergeProjectSummaries, normalizeComparablePath, projectMatchesOverview, projectsHaveChanges, serialize } from './projects/projectRefreshReducer';
import type { AppSocketMessage, AppTab, LoadingProgress, Project, ProjectSession, ProjectWorkflow, ProjectsUpdatedMessage } from '../types/app';
type UseProjectsStateArgs = {
  locationPathname: string;
  locationSearch?: string;
  navigate: NavigateFunction;
  messageHistory: SocketMessageEnvelope[];
  isMobile: boolean;
  activeSessions: Set<string>;
};
const VALID_TABS: Set<string> = new Set(['chat', 'files', 'shell', 'preview']);
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
      setSelectedProject(refreshedProject);
    }
  }, [projects, selectedProject]);
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
        getProjectSessions,
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
