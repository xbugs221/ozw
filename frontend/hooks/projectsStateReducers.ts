/**
 * PURPOSE: Reduce project-related realtime messages into sidebar and selection state updates.
 */
import { useEffect, useLayoutEffect } from 'react';
import type { MutableRefObject } from 'react';

import { getPendingSocketMessages, reduceProjectsUpdatedMessages, sessionChangedMatchesSelectedSession } from '../../shared/socket-message-utils';
import type { SocketMessageEnvelope } from '../contexts/WebSocketContext';
import type { AppSocketMessage, LoadingProgress, Project, ProjectSession, ProjectWorkflow, ProjectsUpdatedMessage } from '../types/app';
import type { SessionProvider } from '../types/app';
import { findProjectSessionById, getProjectSessions, isUpdateAdditive, withSessionProjectMetadata } from './projects/projectSessionCollections';
import { getDirectSessionRouteIndex, normalizePathname, resolveRouteSelection } from './projects/projectRouteSelection';
import { normalizeComparablePath, serialize } from './projects/projectRefreshReducer';
import { resolveSessionProvider } from '../utils/session-provider';
import { normalizeSessionProvider } from '../utils/providerCapabilities';

/**
 * Legacy /session URLs may omit provider for historic Codex links, but a
 * supplied provider must be a known provider. This keeps compatibility for
 * unqualified Codex URLs without treating an invalid value as Codex.
 */
export function resolveLegacyRouteProvider(rawProvider: string | null): SessionProvider | null {
  return rawProvider === null ? 'codex' : normalizeSessionProvider(rawProvider);
}

type UseProjectsRealtimeReducersArgs = {
  activeSessions: Set<string>;
  fetchProjectOverview: (project: Project) => Promise<Project | null>;
  handleSidebarRefreshRef: MutableRefObject<(() => Promise<void>) | undefined>;
  lastProcessedMessageSequenceRef: MutableRefObject<number>;
  loadingProgressTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  messageHistory: SocketMessageEnvelope[];
  projects: Project[];
  requestCoordinatedProjectRefresh: (invalidation: Record<string, unknown>) => Promise<Project[] | null>;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  selectedWorkflowRef: MutableRefObject<ProjectWorkflow | null>;
  setExternalMessageUpdate: (updater: (previous: number) => number) => void;
  setLoadingProgress: (progress: LoadingProgress | null) => void;
  setProjects: (projects: Project[] | ((previous: Project[]) => Project[])) => void;
  setSelectedProject: (project: Project | null) => void;
  setSelectedSession: (session: ProjectSession | null) => void;
};

export function useProjectsRealtimeReducers({
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
}: UseProjectsRealtimeReducersArgs): void {
  /** Apply socket messages without expanding the top-level project state hook. */
  useEffect(() => {
    const pendingMessages = getPendingSocketMessages(messageHistory, lastProcessedMessageSequenceRef.current);
    if (pendingMessages.length === 0) {
      return;
    }
    let projectListInvalidated: Record<string, unknown> | null = null;
    for (const entry of pendingMessages) {
      lastProcessedMessageSequenceRef.current = entry.sequence;
      const latestMessage = entry.message as AppSocketMessage | null;
      if (!latestMessage) continue;
      if (latestMessage.type === 'loading_progress') {
        if (loadingProgressTimeoutRef.current) clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
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
      }
    }
    if (projectListInvalidated) {
      void (async () => {
        const freshProjects = await requestCoordinatedProjectRefresh(projectListInvalidated);
        if (!selectedProject || selectedSession || selectedWorkflowRef.current) return;
        const changedProjectPath = typeof projectListInvalidated?.changedProjectPath === 'string'
          ? normalizeComparablePath(projectListInvalidated.changedProjectPath)
          : '';
        const selectedProjectPath = normalizeComparablePath(selectedProject.fullPath || selectedProject.path || '');
        if (changedProjectPath && selectedProjectPath && changedProjectPath !== selectedProjectPath) return;
        const refreshedProject = (freshProjects || projects).find((project) => (
          project.name === selectedProject.name
          || normalizeComparablePath(project.fullPath || project.path || '') === selectedProjectPath
        )) || selectedProject;
        await fetchProjectOverview(refreshedProject);
      })();
    }
    const projectMessages = pendingMessages
      .map((entry) => entry.message as ProjectsUpdatedMessage | null)
      .filter((message): message is ProjectsUpdatedMessage => Boolean(message && message.type === 'projects_updated'));
    if (projectMessages.length === 0) return;
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
    if (serialize(reducedState.projects) !== serialize(projects)) setProjects(reducedState.projects);
    if (serialize(reducedState.selectedProject) !== serialize(selectedProject)) setSelectedProject(reducedState.selectedProject);
    if (serialize(reducedState.selectedSession) !== serialize(selectedSession)) setSelectedSession(reducedState.selectedSession);
  }, [activeSessions, fetchProjectOverview, handleSidebarRefreshRef, lastProcessedMessageSequenceRef, loadingProgressTimeoutRef, messageHistory, projects, requestCoordinatedProjectRefresh, selectedProject, selectedSession, selectedWorkflowRef, setExternalMessageUpdate, setLoadingProgress, setProjects, setSelectedProject, setSelectedSession]);
}

type UseProjectRouteSelectionSyncArgs = {
  fetchProjectOverview: (project: Project) => Promise<Project | null>;
  locationPathname: string;
  locationSearch: string;
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  selectedWorkflow: ProjectWorkflow | null;
  setSelectedProject: (project: Project | null) => void;
  setSelectedSession: (session: ProjectSession | null) => void;
  setSelectedWorkflow: (workflow: ProjectWorkflow | null) => void;
};

export function useProjectRouteSelectionSync({
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
}: UseProjectRouteSelectionSyncArgs): void {
  /** Keep URL route selection and loaded project/session state in sync. */
  useLayoutEffect(() => {
    const legacySessionMatch = normalizePathname(locationPathname).match(/^\/session\/([^/]+)$/);
    if (legacySessionMatch) {
      const searchParams = new URLSearchParams(locationSearch);
      const hintedProjectPath = searchParams.get('projectPath') || '';
      const rawProvider = searchParams.get('provider');
      const hintedProvider = resolveLegacyRouteProvider(rawProvider);
      if (!hintedProvider) {
        if (selectedSession) setSelectedSession(null);
        if (selectedWorkflow) setSelectedWorkflow(null);
        return;
      }
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
        const fallbackSession = {
          id: decodedSessionId,
          title: requestedSessionSummary || decodedSessionId,
          summary: requestedSessionSummary || decodedSessionId,
          routeIndex: existingSession?.routeIndex ?? (cNMatch ? Number(cNMatch[1]) : undefined),
        } as ProjectSession;
        const nextSession = withSessionProjectMetadata(existingSession || fallbackSession, resolvedProject, hintedProvider);
        if (serialize(selectedProject) !== serialize(resolvedProject)) setSelectedProject(resolvedProject);
        if (
          selectedSession?.id !== nextSession.id
          || selectedSession?.__provider !== nextSession.__provider
          || selectedSession?.__projectName !== nextSession.__projectName
        ) setSelectedSession(nextSession);
        if (selectedWorkflow) setSelectedWorkflow(null);
      }
      return;
    }
    const resolvedSelection = resolveRouteSelection(projects, locationPathname, locationSearch);
    const resolvedProject = resolvedSelection.project;
    if (!resolvedProject) {
      if (normalizePathname(locationPathname) === '/') {
        if (selectedProject) setSelectedProject(null);
        if (selectedWorkflow) setSelectedWorkflow(null);
        if (selectedSession) setSelectedSession(null);
      }
      return;
    }
    if (serialize(selectedProject) !== serialize(resolvedProject)) setSelectedProject(resolvedProject);
    if (resolvedSelection.workflow) {
      if (serialize(selectedWorkflow) !== serialize(resolvedSelection.workflow)) setSelectedWorkflow(resolvedSelection.workflow);
      if (selectedSession) setSelectedSession(null);
      return;
    }
    if (resolvedSelection.session) {
      const provider = resolveSessionProvider(null, resolvedSelection.session, resolvedProject);
      // Route state with no verified provider must not be hydrated as Codex.
      // This is intentionally a safe no-selection state, not a compatibility
      // fallback, because a later project refresh can provide verified ownership.
      if (!provider) {
        if (selectedSession) setSelectedSession(null);
        if (selectedWorkflow) setSelectedWorkflow(null);
        return;
      }
      const nextSession = withSessionProjectMetadata(resolvedSelection.session, resolvedProject, provider);
      if (
        selectedSession?.id !== nextSession.id
        || selectedSession?.routeIndex !== nextSession.routeIndex
        || selectedSession?.__provider !== nextSession.__provider
        || selectedSession?.__projectName !== nextSession.__projectName
      ) setSelectedSession(nextSession);
      if (selectedWorkflow) setSelectedWorkflow(null);
      return;
    }
    const directSessionRouteIndex = getDirectSessionRouteIndex(resolvedProject, locationPathname);
    if (
      selectedSession
      && directSessionRouteIndex
      && selectedSession.routeIndex === directSessionRouteIndex
      && selectedSession.__projectName === resolvedProject.name
    ) {
      if (selectedWorkflow) setSelectedWorkflow(null);
      return;
    }
    if (selectedSession) setSelectedSession(null);
    if (selectedWorkflow) setSelectedWorkflow(null);
  }, [locationPathname, locationSearch, projects, selectedProject, selectedSession, selectedWorkflow, setSelectedProject, setSelectedSession, setSelectedWorkflow]);

  useEffect(() => {
    const legacySessionMatch = normalizePathname(locationPathname).match(/^\/session\/([^/]+)$/);
    if (!legacySessionMatch || selectedSession || projects.length === 0) return undefined;
    const searchParams = new URLSearchParams(locationSearch);
    if (searchParams.get('projectPath')) return undefined;
    let cancelled = false;
    const decodedSessionId = decodeURIComponent(legacySessionMatch[1]);
    const routeProvider = searchParams.get('provider');
    const hintedProvider = resolveLegacyRouteProvider(routeProvider);
    if (!hintedProvider) return undefined;
    const resolveLegacySessionFromOverviews = async () => {
      /** Resolve legacy session URLs whose project is only knowable after overview loading. */
      for (const project of projects) {
        if (cancelled) return;
        const overview = await fetchProjectOverview(project);
        if (cancelled || !overview) continue;
        const matchedSession = getProjectSessions(overview).find(
          (entry) => entry.id === decodedSessionId && (entry.__provider || hintedProvider) === hintedProvider,
        );
        if (!matchedSession) continue;
        setSelectedProject(overview);
        setSelectedSession(withSessionProjectMetadata(matchedSession, overview, hintedProvider));
        setSelectedWorkflow(null);
        return;
      }
    };
    void resolveLegacySessionFromOverviews();
    return () => {
      cancelled = true;
    };
  }, [fetchProjectOverview, locationPathname, locationSearch, projects, selectedSession, setSelectedProject, setSelectedSession, setSelectedWorkflow]);
}
