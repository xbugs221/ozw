// @ts-nocheck
/**
 * Shared utility: resolve a session's __provider from the child session,
 * project session, and project provider session lists.
 *
 * Extracted from useProjectsState.ts so both the production hook and
 * route-resolution tests use the same implementation.
 */
import type { SessionProvider } from '../types/session.ts';

/**
 * Resolve the SessionProvider for a selected session.
 *
 * Priority:
 *   1. childSession.provider (set by buildWorkflowReadModel)
 *   2. projectSession.__provider / provider (from project sidebar read model)
 *   3. Project provider session list membership (codexSessions / piSessions)
 *
 * Returns a provider only when it can be verified from explicit metadata or
 * project bucket membership. Unknown ownership must fail closed so it cannot
 * accidentally inherit Codex write capabilities.
 */
export function resolveSessionProvider(
  childSession: { id?: string; provider?: string } | null | undefined,
  projectSession: { id?: string; __provider?: string; provider?: string } | null | undefined,
  project?: {
    codexSessions?: Array<{ id: string }>;
    piSessions?: Array<{ id: string }>;
    claudeSessions?: Array<{ id: string }>;
    hermesSessions?: Array<{ id: string }>;
  } | null,
): SessionProvider | null {
  const sessionId = childSession?.id || projectSession?.id || '';

  // Priority 1: childSession.provider (set by buildWorkflowReadModel).
  // This is the authoritative signal for workflow child sessions and must
  // not be overridden by project provider session list membership.
  if (childSession?.provider === 'codex') return 'codex';
  if (childSession?.provider === 'pi') return 'pi';
  if (childSession?.provider === 'claude') return 'claude';
  if (childSession?.provider === 'hermes') return 'hermes';

  // Priority 2: project sidebar read models may expose either the persisted
  // provider field or the UI metadata field while a route is being restored.
  if (projectSession?.__provider === 'codex') return 'codex';
  if (projectSession?.__provider === 'pi') return 'pi';
  if (projectSession?.__provider === 'claude') return 'claude';
  if (projectSession?.__provider === 'hermes') return 'hermes';
  if (projectSession?.provider === 'codex') return 'codex';
  if (projectSession?.provider === 'pi') return 'pi';
  if (projectSession?.provider === 'claude') return 'claude';
  if (projectSession?.provider === 'hermes') return 'hermes';

  // Priority 3 (fallback): project provider session list membership.
  if ((project?.codexSessions || []).some((entry) => entry.id === sessionId)) return 'codex';
  if ((project?.piSessions || []).some((entry) => entry.id === sessionId)) return 'pi';
  if ((project?.claudeSessions || []).some((entry) => entry.id === sessionId)) return 'claude';
  if ((project?.hermesSessions || []).some((entry) => entry.id === sessionId)) return 'hermes';

  return null;
}
