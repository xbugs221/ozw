/**
 * File purpose: centralize chat session identity and routing rules.
 * The chat view, composer, realtime handlers, and session loader use these
 * pure helpers to keep draft sessions, cN route aliases, provider lookup, and
 * workflow child session routing consistent.
 */
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';

export type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
  clientRequestId?: string;
  draftSessionId?: string | null;
};

export type SessionRoutingContext = {
  projectName: string;
  projectPath: string;
  provider: SessionProvider | null;
  workflowId?: string;
  workflowStageKey?: string;
};

/**
 * Return whether a session id is an unsaved draft route.
 */
export function isTemporarySessionId(sessionId?: string | null): boolean {
  return Boolean(sessionId && sessionId.startsWith('new-session-'));
}

/**
 * Return whether a session id is an ozw cN route alias.
 */
export function isCbwRouteSessionId(sessionId?: string | null): boolean {
  return Boolean(sessionId && /^c\d+$/.test(sessionId));
}

/**
 * Resolve a valid provider value from session metadata aliases.
 */
function readExplicitSessionProvider(session?: ProjectSession | null): SessionProvider | null {
  const explicitProvider = session?.__provider || session?.provider;
  return explicitProvider === 'codex' || explicitProvider === 'pi' || explicitProvider === 'claude' || explicitProvider === 'hermes'
    ? explicitProvider
    : null;
}

/**
 * Resolve the provider owning a session id from explicit metadata, direct ids,
 * or cN route aliases.
 */
export function resolveProjectSessionProvider(
  selectedProject: Project | null,
  sessionId?: string | null,
  selectedSession?: ProjectSession | null,
): SessionProvider | null {
  if (!sessionId || isTemporarySessionId(sessionId)) {
    return null;
  }

  // The hydrated project bucket is the ownership authority. A selected-session
  // object can retain stale metadata across project refresh/navigation; letting
  // that stale value win previously turned a Hermes scoped id into Codex.
  if (selectedProject) {
    if ((selectedProject.codexSessions || []).some((session) => session.id === sessionId)) return 'codex';
    if ((selectedProject.piSessions || []).some((session) => session.id === sessionId)) return 'pi';
    if ((selectedProject.claudeSessions || []).some((session) => session.id === sessionId)) return 'claude';
    if ((selectedProject.hermesSessions || []).some((session) => session.id === sessionId)) return 'hermes';
  }

  const explicitProvider = readExplicitSessionProvider(selectedSession);
  if (explicitProvider) {
    return explicitProvider;
  }

  if (!selectedProject) {
    return null;
  }

  if (isCbwRouteSessionId(sessionId)) {
    const routeIndex = Number(sessionId.slice(1));
    if ((selectedProject.piSessions || []).some((session) => session.routeIndex === routeIndex)) {
      return 'pi';
    }
    if ((selectedProject.claudeSessions || []).some((session) => session.routeIndex === routeIndex)) {
      return 'claude';
    }
    if ((selectedProject.codexSessions || []).some((session) => session.routeIndex === routeIndex)) {
      return 'codex';
    }
  }

  return null;
}

/**
 * Resolve the provider for a selected session object.
 */
export function resolveSessionProvider(
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): SessionProvider | null {
  return resolveProjectSessionProvider(selectedProject, selectedSession?.id, selectedSession);
}

/**
 * Resolve project and workflow routing metadata for session-scoped operations.
 */
export function resolveSessionRoutingContext(
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
  fallbackProvider?: SessionProvider,
): SessionRoutingContext {
  const provider = resolveSessionProvider(selectedProject, selectedSession) || fallbackProvider || null;
  const isCodex = provider === 'codex';
  const projectName = isCodex
    ? selectedProject?.name || ''
    : selectedSession?.__projectName || selectedProject?.name || '';

  return {
    projectName,
    projectPath: selectedSession?.projectPath || selectedProject?.fullPath || selectedProject?.path || '',
    provider,
    workflowId: typeof selectedSession?.workflowId === 'string' ? selectedSession.workflowId : undefined,
    workflowStageKey: typeof selectedSession?.stageKey === 'string' ? selectedSession.stageKey : undefined,
  };
}

/**
 * Resolve the session id used for server message API calls.
 */
export function getSessionLoadId(session: ProjectSession | null): string {
  /**
   * Provider-backed manual sessions are displayed through a stable cN route.
   * The cN messages endpoint is the only endpoint that can merge active-turn
   * overlay rows with provider JSONL, so route identity wins over provider id.
   */
  const routeIndex = Number(session?.routeIndex);
  if (Number.isInteger(routeIndex) && routeIndex > 0) {
    return `c${routeIndex}`;
  }
  return session?.id || '';
}

/**
 * Build the frontend view identity used to clear and hydrate visible messages.
 */
export function getSessionViewIdentityKey(
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): string | null {
  /**
   * A URL route can change without a provider session id changing, especially
   * around cN aliases and draft sessions. Include the routing context so the
   * chat pane tracks the actual view, not only the provider id.
   */
  if (!selectedProject || !selectedSession) {
    return null;
  }

  const context = resolveSessionRoutingContext(selectedProject, selectedSession);
  const routeIndex = Number(selectedSession.routeIndex);
  const routeKey = Number.isInteger(routeIndex) && routeIndex > 0 ? `c${routeIndex}` : '';
  const loadId = getSessionLoadId(selectedSession) || selectedSession.id || '';
  const createdAt =
    typeof selectedSession.createdAt === 'string' ? selectedSession.createdAt :
      (typeof selectedSession.created_at === 'string' ? selectedSession.created_at : '');

  return [
    context.projectName || selectedProject.name || '',
    context.projectPath || selectedProject.fullPath || selectedProject.path || '',
    context.provider || 'unknown-provider',
    loadId,
    selectedSession.id || '',
    routeKey,
    context.workflowId || '',
    context.workflowStageKey || '',
    createdAt,
  ].join('\u001f');
}

/**
 * Check whether a provider session-created event belongs to the draft request
 * currently shown in this chat view.
 */
export function isSessionCreatedForPendingView(
  latestMessage: Record<string, unknown>,
  pendingViewSession: PendingViewSession | null,
): boolean {
  if (!pendingViewSession) {
    return false;
  }

  const expectedRequestId = pendingViewSession.clientRequestId;
  if (!expectedRequestId) {
    return true;
  }

  return latestMessage.clientRequestId === expectedRequestId;
}

/**
 * Check whether a lifecycle event belongs to the optimistic request in this view.
 */
export function isMessageForPendingRequest(
  latestMessage: Record<string, unknown>,
  pendingViewSession: PendingViewSession | null,
): boolean {
  const expectedRequestId = pendingViewSession?.clientRequestId;
  return Boolean(expectedRequestId && latestMessage.clientRequestId === expectedRequestId);
}

/**
 * Build workflow navigation options for replacing temporary sessions.
 */
export function buildWorkflowNavigationOptions(
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
  fallbackProvider: SessionProvider,
): {
  provider?: SessionProvider;
  projectName?: string;
  projectPath?: string;
  workflowId?: string;
  workflowStageKey?: string;
} | undefined {
  if (!selectedSession?.workflowId) {
    return undefined;
  }

  const context = resolveSessionRoutingContext(selectedProject, selectedSession, fallbackProvider);
  return {
    provider: context.provider || fallbackProvider,
    projectName: context.projectName,
    projectPath: context.projectPath,
    workflowId: context.workflowId,
    workflowStageKey: context.workflowStageKey,
  };
}

/**
 * Check whether a project-scoped realtime event belongs to the active project.
 */
export function isMessageForSelectedProject(
  latestMessage: Record<string, unknown>,
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): boolean {
  const messageProjectPath = typeof latestMessage.projectPath === 'string' ? latestMessage.projectPath.trim() : '';
  const messageProjectName = typeof latestMessage.projectName === 'string' ? latestMessage.projectName.trim() : '';
  if (!messageProjectPath && !messageProjectName) {
    return true;
  }

  const activeProjectPath = (selectedSession?.projectPath || selectedProject?.fullPath || selectedProject?.path || '').trim();
  const activeProjectName = (selectedSession?.__projectName || selectedProject?.name || '').trim();
  if (messageProjectPath && activeProjectPath) {
    return messageProjectPath === activeProjectPath;
  }
  if (messageProjectName && activeProjectName) {
    return messageProjectName === activeProjectName;
  }
  return false;
}
