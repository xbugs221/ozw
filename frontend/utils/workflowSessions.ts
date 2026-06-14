/**
 * PURPOSE: Share workflow-owned session detection across project session lists
 * and project route resolution so runner child sessions stay workflow-scoped.
 */
import type { Project, ProjectSession, SessionProvider } from '../types/app';

type SessionLike = Pick<ProjectSession, 'id' | 'workflowId' | 'stageKey'> & {
  provider?: SessionProvider | string;
  __provider?: SessionProvider | string;
  providerSessionId?: string;
  sourceSessionId?: string;
  source_session_id?: string;
  origin?: string;
};

type WorkflowChildSessionLike = {
  id?: string;
  provider?: SessionProvider | string;
  stageKey?: string;
  address?: string;
  routePath?: string;
};

export function findWorkflowChildSession<T extends WorkflowChildSessionLike>(
  childSessions: T[] | undefined,
  sessionId: string,
  options: {
    provider?: SessionProvider | string;
    stageKey?: string;
    address?: string;
    routePath?: string;
    allowLegacyIdOnly?: boolean;
  } = {},
): T | null {
  /**
   * PURPOSE: Resolve workflow child sessions without crossing provider
   * namespaces when Codex and Pi reuse the same session id.
   */
  const sessions = childSessions || [];
  const targetProvider = String(options.provider || '').trim();
  const targetStageKey = String(options.stageKey || '').trim();
  const targetAddress = String(options.address || '').trim();
  const targetRoutePath = String(options.routePath || '').trim();
  const idMatches = (session: WorkflowChildSessionLike) => session.id === sessionId;
  const providerMatches = (session: WorkflowChildSessionLike) => String(session.provider || 'codex') === targetProvider;
  const stageMatches = (session: WorkflowChildSessionLike) => String(session.stageKey || '') === targetStageKey;
  const addressMatches = (session: WorkflowChildSessionLike) => String(session.address || '') === targetAddress;
  const routePathMatches = (session: WorkflowChildSessionLike) => String(session.routePath || '') === targetRoutePath;

  if (targetRoutePath) {
    const match = sessions.find((session) => idMatches(session) && routePathMatches(session));
    if (match) return match;
  }
  if (targetAddress) {
    const match = sessions.find((session) => idMatches(session) && addressMatches(session));
    if (match) return match;
  }

  if (targetProvider && targetStageKey) {
    const match = sessions.find((session) => idMatches(session) && providerMatches(session) && stageMatches(session));
    if (match) return match;
  }
  if (targetProvider) {
    const match = sessions.find((session) => idMatches(session) && providerMatches(session));
    if (match) return match;
  }
  if (!targetProvider && targetStageKey) {
    const match = sessions.find((session) => idMatches(session) && stageMatches(session));
    if (match) return match;
  }
  if (options.allowLegacyIdOnly === false) {
    return null;
  }
  return sessions.find((session) => session.id === sessionId) || null;
}

export function findWorkflowDagTargetChildSession<T extends WorkflowChildSessionLike>(
  childSessions: T[] | undefined,
  sessionId: string,
  provider?: SessionProvider | string,
): T | null {
  /**
   * PURPOSE: Keep the DAG review-target compatibility wrapper while delegating
   * to the shared provider-aware child-session resolver.
   */
  return findWorkflowChildSession(
    childSessions,
    sessionId,
    {
      provider,
    },
  );
}

export function hasWorkflowChildSession(
  childSessions: WorkflowChildSessionLike[] | undefined,
  sessionId: string,
  options: {
    provider?: SessionProvider | string;
    stageKey?: string;
    address?: string;
    routePath?: string;
  } = {},
): boolean {
  /**
   * PURPOSE: Test workflow ownership with the same provider-aware child-session
   * identity used by route selection.
   */
  return Boolean(findWorkflowChildSession(
    childSessions,
    sessionId,
    {
      ...options,
      allowLegacyIdOnly: !options.provider,
    },
  ));
}

function getSessionProvider(session: SessionLike): string {
  /**
   * PURPOSE: Normalize provider identity before comparing project and workflow
   * session ids, avoiding cross-provider false matches.
   */
  return String(session.__provider || session.provider || 'codex');
}

function getChildSessionProvider(provider: unknown): string {
  /**
   * PURPOSE: Treat missing or retired provider values as Codex ownership.
   */
  if (provider === 'pi') return 'pi';
  return 'codex';
}

function getSessionIdentityCandidates(session: SessionLike): string[] {
  /**
   * PURPOSE: Match workflow ownership against both the route-facing cN session
   * id and the underlying provider session id used by oz flow state.
   */
  return [
    session.id,
    session.providerSessionId,
    session.sourceSessionId,
    session.source_session_id,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

export function isWorkflowOwnedSession(project: Pick<Project, 'workflows'>, session: SessionLike): boolean {
  /**
   * PURPOSE: Detect whether a session belongs to any workflow read model rather
   * than the project's manual session list.
   *
   * Checks:
   * 1. Session has explicit workflowId or stageKey metadata
   * 2. Session id appears in any workflow's childSessions
   * 3. Session id appears in any workflow's runnerProcesses.sessionId
 * 4. Session id appears in any workflow's runnerDiagnostics workflow session ids
   */
  if (session.workflowId || session.stageKey || session.origin === 'workflow') {
    return true;
  }

  const provider = getSessionProvider(session);
  const sessionIds = getSessionIdentityCandidates(session);
  const workflows = project.workflows || [];
  return workflows.some((workflow) => (
    (workflow.childSessions || []).some((childSession) => (
      sessionIds.includes(String(childSession.id || ''))
      && getChildSessionProvider(childSession.provider) === provider
    ))
    || (workflow.runnerProcesses || []).some((process) => (
      sessionIds.includes(String(process.sessionId || ''))
      && getChildSessionProvider(process.provider) === provider
    ))
    // Check provider-aware workflowOwnedSessionRefs first (project-list summary).
    || sessionIds.some((sessionId) => isSessionInWorkflowOwnedRefs(workflow, sessionId, provider))
    // Fallback to runnerDiagnostics for backward compat.
    || sessionIds.some((sessionId) => isSessionInWorkflowDiagnosticsSessions(workflow, sessionId, provider))
    // Check if session id appears in workflowDag reviewTargets (parallel subagent sessions).
    || sessionIds.some((sessionId) => isSessionInWorkflowDagReviewTargets(workflow, sessionId, provider))
  ));
}

/**
 * Check if a session id appears in the workflow's workflowOwnedSessionRefs
 * (provider-aware list from project-list summary).
 */
function isSessionInWorkflowOwnedRefs(
  workflow: { workflowOwnedSessionRefs?: Array<{ sessionId?: string; provider?: string }> },
  sessionId: string,
  provider: string,
): boolean {
  const refs = workflow.workflowOwnedSessionRefs;
  if (!Array.isArray(refs)) {
    return false;
  }
  return refs.some((ref) => (
    String(ref.sessionId || '') === sessionId
    && String(ref.provider || 'codex') === provider
  ));
}

/**
 * Check if a session id appears in the workflow's runner diagnostics sessions
 * (the oz flow state.json sessions role map).
 */
function isSessionInWorkflowDiagnosticsSessions(
  workflow: { runnerDiagnostics?: Record<string, unknown>; diagnostics?: Record<string, unknown> },
  sessionId: string,
  provider: string,
): boolean {
  const diagnostics = (workflow.runnerDiagnostics || workflow.diagnostics || {}) as Record<string, unknown>;
  if (!diagnostics || typeof diagnostics !== 'object') {
    return false;
  }

  // Prefer provider-aware workflowOwnedSessions. When present, this list is
  // authoritative; id-only fallback would hide same-id sessions from another provider.
  const ownedSessions = diagnostics.workflowOwnedSessions;
  if (Array.isArray(ownedSessions)) {
    const matched = ownedSessions.some((entry) => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }
      const e = entry as { sessionId?: unknown; provider?: unknown };
      return String(e.sessionId || '') === sessionId && String(e.provider || 'codex') === provider;
    });
    if (matched) return true;
    if (ownedSessions.length > 0) return false;
  }

  // Fallback to id-only workflowOwnedSessionIds for backward compat
  const ownedIds = diagnostics.workflowOwnedSessionIds;
  if (Array.isArray(ownedIds) && ownedIds.some((ownedId) => String(ownedId) === sessionId)) {
    return true;
  }

  return false;
}

/**
 * Check if a session id appears in the workflow's DAG reviewTargets
 * (parallel subagent sessions from oz flow graph nodes).
 */
function isSessionInWorkflowDagReviewTargets(
  workflow: { workflowDag?: { nodes?: Array<{ reviewTargets?: Array<{ kind?: string; sessionId?: string; provider?: string }> }> } },
  sessionId: string,
  provider: string,
): boolean {
  const nodes = workflow.workflowDag?.nodes;
  if (!Array.isArray(nodes)) {
    return false;
  }
  for (const node of nodes) {
    const targets = node.reviewTargets;
    if (!Array.isArray(targets)) {
      continue;
    }
    for (const target of targets) {
      if (
        target.kind === 'session'
        && String(target.sessionId || '') === sessionId
        && String(target.provider || 'codex') === provider
      ) {
        return true;
      }
    }
  }
  return false;
}
