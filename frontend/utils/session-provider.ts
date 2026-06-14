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
 *   2. projectSession.__provider (from project sidebar read model)
 *   3. Project provider session list membership (codexSessions / piSessions)
 *
 * Returns 'codex', 'pi', or 'codex' as default.
 */
export function resolveSessionProvider(
  childSession: { id?: string; provider?: string } | null | undefined,
  projectSession: { id?: string; __provider?: string } | null | undefined,
  project?: {
    codexSessions?: Array<{ id: string }>;
    piSessions?: Array<{ id: string }>;
  } | null,
): SessionProvider {
  const sessionId = childSession?.id || projectSession?.id || '';

  // Priority 1: childSession.provider (set by buildWorkflowReadModel).
  // This is the authoritative signal for workflow child sessions and must
  // not be overridden by project provider session list membership.
  if (childSession?.provider === 'codex') return 'codex';
  if (childSession?.provider === 'pi') return 'pi';

  // Priority 2: projectSession.__provider (from project sidebar read model).
  if (projectSession?.__provider === 'codex') return 'codex';
  if (projectSession?.__provider === 'pi') return 'pi';

  // Priority 3 (fallback): project provider session list membership.
  if ((project?.codexSessions || []).some((entry) => entry.id === sessionId)) return 'codex';
  if ((project?.piSessions || []).some((entry) => entry.id === sessionId)) return 'pi';

  return 'codex';
}
