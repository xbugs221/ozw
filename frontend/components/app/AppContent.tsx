/**
 * Application shell composition.
 * Wires shared WebSocket state, project/session selection, and main layout containers together.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
import ChatHistorySearchDialog from '../chat/view/ChatHistorySearchDialog';

import { useWebSocket } from '../../contexts/WebSocketContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import type { Project, ProjectSession, SessionProvider } from '../../types/app';
import { buildProjectSessionRoute, buildWorkflowChildSessionRoute } from '../../utils/projectRoute';
import { findWorkflowChildSession, hasWorkflowChildSession } from '../../utils/workflowSessions';

function hasStableSessionRoute(session: Pick<ProjectSession, 'id' | 'routeIndex'>): boolean {
  /**
   * 判断 session 是否能使用项目内 cN 短路由。
   */
  const routeIndex = Number(session.routeIndex);
  return (Number.isInteger(routeIndex) && routeIndex > 0) || /^c\d+$/.test(String(session.id || ''));
}

function getSessionProvider(session: Partial<ProjectSession> | null | undefined, fallback?: SessionProvider): SessionProvider {
  /**
   * 从 session 字段和调用方提示中解析 provider，默认保持 Codex 兼容行为。
   */
  if (session?.__provider === 'claude' || session?.provider === 'claude' || fallback === 'claude') return 'claude';
  return session?.__provider === 'pi' || session?.provider === 'pi' || fallback === 'pi' ? 'pi' : 'codex';
}

function buildSessionNavigationUrl(
  project: Project,
  session: ProjectSession,
  searchParams: URLSearchParams,
  fallbackProvider?: SessionProvider,
): string {
  /**
   * 生成项目会话跳转 URL；没有 cN 绑定的 provider 历史会话走兼容路由。
   */
  const provider = getSessionProvider(session, fallbackProvider);
  const projectPath = session.projectPath || project.fullPath || project.path || '';
  const nextParams = new URLSearchParams(searchParams);

  if (hasStableSessionRoute(session)) {
    const route = buildProjectSessionRoute(project, session);
    if (provider === 'codex') nextParams.delete('provider');
    else nextParams.set('provider', provider);
    nextParams.delete('projectPath');
    nextParams.delete('sessionSummary');
    return `${route}${nextParams.toString() ? `?${nextParams.toString()}` : ''}`;
  }

  nextParams.set('provider', provider);
  nextParams.set('projectPath', projectPath);
  const sessionSummary = String(session.summary || session.title || session.name || '').trim();
  if (sessionSummary) {
    nextParams.set('sessionSummary', sessionSummary);
  }
  return `/session/${encodeURIComponent(String(session.id || ''))}?${nextParams.toString()}`;
}

export default function AppContent() {
  /**
   * PURPOSE: Compose the application shell and keep desktop sidebar visibility
   * tied to the shared UI preference used by the header collapse button.
   */
  const navigate = useNavigate();
  const location = useLocation();
  const [isChatSearchOpen, setIsChatSearchOpen] = useState(false);
  const [renderSnapshotRequestId, setRenderSnapshotRequestId] = useState(0);
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const { ws, sendMessage, latestMessage, messageHistory } = useWebSocket();
  const {
    activeSessions,
    markSessionAsActive,
    markSessionAsInactive,
    replaceTemporarySession,
  } = useSessionProtection();

  const {
    selectedProject,
    selectedSession,
    selectedWorkflow,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    handleSidebarRefresh,
    sidebarSharedProps,
    handleSessionSelect,
    handleWorkflowSelect,
    handleNewSession,
  } = useProjectsState({
    locationPathname: location.pathname,
    locationSearch: location.search,
    navigate,
    messageHistory,
    isMobile,
    activeSessions,
  });

  const isProjectScopedRoute = location.pathname !== '/';
  const shouldInlineMobileSidebar = isMobile && !selectedProject && !isProjectScopedRoute;
  const isMobileSidebarOpen = isMobile && (shouldInlineMobileSidebar || sidebarOpen);
  const isSidebarOpen = isMobile ? isMobileSidebarOpen : sidebarVisible;
  const handleMenuClick = useCallback(() => {
    if (isMobile) {
      setSidebarOpen(true);
      return;
    }

    setPreference('sidebarVisible', true);
  }, [isMobile, setPreference, setSidebarOpen]);
  const handleDesktopSidebarCollapse = useCallback(() => {
    setPreference('sidebarVisible', false);
  }, [setPreference]);

  useEffect(() => {
    window.refreshProjects = handleSidebarRefresh;

    return () => {
      if (window.refreshProjects === handleSidebarRefresh) {
        delete window.refreshProjects;
      }
    };
  }, [handleSidebarRefresh]);

  useEffect(() => {
    window.openSettings = openSettings;

    return () => {
      if (window.openSettings === openSettings) {
        delete window.openSettings;
      }
    };
  }, [openSettings]);

  useEffect(() => {
    window.openChatHistorySearch = () => {
      setIsChatSearchOpen(true);
    };

    return () => {
      if (window.openChatHistorySearch) {
        delete window.openChatHistorySearch;
      }
    };
  }, []);

  const handleNavigateToSession = useCallback((
    targetSessionId: string,
    options?: {
      provider?: SessionProvider;
      projectName?: string;
      projectPath?: string;
      workflowId?: string;
      workflowRouteIndex?: number;
      workflowStageKey?: string;
      routeIndex?: number;
      routePath?: string;
      routeSearch?: Record<string, string>;
    },
  ) => {
    /**
     * PURPOSE: Resolve global session search hits and realtime-created session
     * ids into the canonical project/workflow routes.
     */
    const allProjects = sidebarSharedProps.projects || [];
    const requestedProvider = options?.provider;
    const requestedStageKey = options?.workflowStageKey;
    const requestedRoutePath = String(options?.routePath || '').trim();
    const requestedAddress = requestedRoutePath.match(/\/sessions\/(.+)$/)?.[1]
      ?.split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
    const workflowHasTargetChildSession = (workflow: { childSessions?: Array<{ id?: string; provider?: string; stageKey?: string; address?: string; routePath?: string }> }) => (
      hasWorkflowChildSession(
        workflow.childSessions,
        targetSessionId,
        {
          provider: requestedProvider,
          stageKey: requestedStageKey,
          address: requestedAddress,
          routePath: requestedRoutePath,
        },
      )
    );
    const workflowHasTargetRunnerProcess = (workflow: { runnerProcesses?: Array<{ sessionId?: string; provider?: string; stage?: string }> }) => (
      (workflow.runnerProcesses || []).some((process) => (
        process.sessionId === targetSessionId
        && (!requestedProvider || String(process.provider || 'codex') === requestedProvider)
        && (!requestedStageKey || String(process.stage || '') === requestedStageKey)
      ))
    );
    const matchingProject = allProjects.find((project) => (
      project.name === options?.projectName
      || project.fullPath === options?.projectPath
      || project.path === options?.projectPath
      || (project.sessions || []).some((session) => session.id === targetSessionId)
      || (project.codexSessions || []).some((session) => session.id === targetSessionId)
      || (project.piSessions || []).some((session) => session.id === targetSessionId)
      || (project.workflows || []).some((workflow) => (
        workflowHasTargetChildSession(workflow)
      ))
    )) || selectedProject;
    const targetSession = matchingProject
      ? [
          ...(matchingProject.sessions || []),
          ...(matchingProject.codexSessions || []),
          ...(matchingProject.piSessions || []),
        ].find((session) => (
          session.id === targetSessionId
          && (!requestedProvider || getSessionProvider(session, requestedProvider) === requestedProvider)
        )) || null
      : null;
    const searchResultSession = matchingProject && !targetSession && Number.isInteger(options?.routeIndex)
      ? {
          id: targetSessionId,
          routeIndex: options?.routeIndex,
          __provider: options?.provider,
        }
      : null;
    const explicitWorkflowId = typeof options?.workflowId === 'string' ? options.workflowId : '';
    const targetWorkflow = matchingProject
      ? (matchingProject.workflows || []).find((workflow) => (
        workflow.id === explicitWorkflowId
          || workflowHasTargetChildSession(workflow)
          || workflowHasTargetRunnerProcess(workflow)
      )) || null
      : null;
    const childSession = targetWorkflow
      ? findWorkflowChildSession(
          targetWorkflow.childSessions,
          targetSessionId,
          {
            provider: requestedProvider,
            stageKey: requestedStageKey,
            address: requestedAddress,
            routePath: requestedRoutePath,
          },
        )
      : null;
    const nextSearchParams = new URLSearchParams(options?.routeSearch || {});
    const isConcreteSessionRoute = /\/c\d+$/.test(location.pathname);
    const fallbackProject = matchingProject || selectedProject;
    const fallbackSelectedSession = selectedSession?.routeIndex
      ? {
          ...selectedSession,
          id: targetSessionId,
        }
      : null;
    const workflowDraftSession = targetWorkflow && fallbackSelectedSession?.routeIndex
      ? {
          ...fallbackSelectedSession,
          workflowId: targetWorkflow.id,
          stageKey: options?.workflowStageKey || fallbackSelectedSession.stageKey,
        }
      : null;
    const workflowRouteSession = childSession && requestedRoutePath
      ? {
          ...childSession,
          address: requestedAddress || childSession.address,
          routePath: requestedRoutePath,
        }
      : childSession || workflowDraftSession;
    const searchResultWorkflow = matchingProject && !targetWorkflow && Number.isInteger(options?.workflowRouteIndex)
      ? {
          id: explicitWorkflowId,
          routeIndex: options?.workflowRouteIndex,
        }
      : null;
    const searchResultWorkflowSession = (targetWorkflow || searchResultWorkflow) && !workflowRouteSession && (Number.isInteger(options?.routeIndex) || options?.workflowStageKey)
      ? {
          id: targetSessionId,
          routeIndex: options?.routeIndex,
          workflowId: explicitWorkflowId,
          stageKey: options?.workflowStageKey,
          provider: options?.provider,
          routePath: options?.routePath,
        }
      : null;
    const routeWorkflow = targetWorkflow || searchResultWorkflow;
    const routeWorkflowSession = workflowRouteSession || searchResultWorkflowSession;
    if (matchingProject && routeWorkflow && routeWorkflowSession) {
      const route = buildWorkflowChildSessionRoute(
        matchingProject,
        routeWorkflow,
        routeWorkflowSession,
      );
      navigate(`${route}${nextSearchParams.toString() ? `?${nextSearchParams.toString()}` : ''}`, {
        state: location.state,
      });
      return;
    }
    if (matchingProject && !targetSession && options?.provider) {
      const legacyParams = new URLSearchParams(nextSearchParams);
      legacyParams.set('projectPath', matchingProject.fullPath || matchingProject.path || options.projectPath || '');
      legacyParams.set('provider', options.provider);
      navigate(`/session/${encodeURIComponent(targetSessionId)}?${legacyParams.toString()}`, {
        state: location.state,
      });
      return;
    }
    const routeSession = targetSession || searchResultSession;
    if (matchingProject && routeSession) {
      navigate(buildSessionNavigationUrl(matchingProject, routeSession, nextSearchParams, requestedProvider), {
        state: location.state,
      });
      return;
    }
    /**
     * Keep the user on the draft route while the provider session is being
     * indexed. Falling back to `/` here discards correct project context and
     * can also misroute a concrete session page after the first message.
     * If the user is already on a stable `.../cN` route, keep the current
     * URL until project/session indexing catches up.
     */
    if (isConcreteSessionRoute) {
      return;
    }

    if (fallbackProject && fallbackSelectedSession) {
      const route = selectedWorkflow
        ? buildWorkflowChildSessionRoute(fallbackProject, selectedWorkflow, fallbackSelectedSession)
        : buildProjectSessionRoute(fallbackProject, fallbackSelectedSession);
      navigate(`${route}${nextSearchParams.toString() ? `?${nextSearchParams.toString()}` : ''}`, {
        state: location.state,
      });
    }
  }, [
    location.pathname,
    location.state,
    navigate,
    selectedProject,
    selectedSession,
    selectedWorkflow,
    sidebarSharedProps.projects,
  ]);

  const mainContent = (
    <MainContent
      selectedProject={selectedProject}
      selectedSession={selectedSession}
      selectedWorkflow={selectedWorkflow}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      ws={ws}
      sendMessage={sendMessage}
      latestMessage={latestMessage}
      messageHistory={messageHistory}
      isMobile={isMobile}
      isSidebarOpen={isSidebarOpen}
      onMenuClick={handleMenuClick}
      isLoading={isLoadingProjects}
      onInputFocusChange={setIsInputFocused}
      onSessionActive={markSessionAsActive}
      onSessionInactive={markSessionAsInactive}
      onReplaceTemporarySession={replaceTemporarySession}
      onNavigateToSession={handleNavigateToSession}
      onSelectProjectOverview={sidebarSharedProps.onProjectSelect}
      onSelectSession={handleSessionSelect}
      onSelectWorkflow={handleWorkflowSelect}
      onNewSession={handleNewSession}
      onShowSettings={() => setShowSettings(true)}
      onRefresh={handleSidebarRefresh}
      externalMessageUpdate={externalMessageUpdate}
      renderSnapshotRequestId={renderSnapshotRequestId}
      onRenderSnapshotRequest={() => setRenderSnapshotRequestId((previous) => previous + 1)}
    />
  );

  return (
    <div className="fixed inset-0 flex bg-background">
      {!isMobile && sidebarVisible ? (
        <div className="h-full flex-shrink-0 border-r border-border/50">
          <Sidebar {...sidebarSharedProps} onCollapseSidebar={handleDesktopSidebarCollapse} />
        </div>
      ) : shouldInlineMobileSidebar ? (
        <div className="h-full flex-shrink-0 border-r border-border/50">
          <Sidebar {...sidebarSharedProps} />
        </div>
      ) : sidebarOpen ? (
        <div
          className="h-full w-max max-w-[85vw] flex-shrink-0 border-r border-border/50 bg-card"
        >
          <Sidebar {...sidebarSharedProps} onCollapseSidebar={() => setSidebarOpen(false)} />
        </div>
      ) : null}

      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {mainContent}
      </div>

      <ChatHistorySearchDialog
        isOpen={isChatSearchOpen}
        onClose={() => setIsChatSearchOpen(false)}
        onNavigateToSession={handleNavigateToSession}
      />

    </div>
  );
}
