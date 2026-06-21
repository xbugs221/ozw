/**
 * PURPOSE: Define project overview selection state helpers for provider-aware batch actions.
 */
export function createProjectOverviewSelectionKey(provider: string, sessionId: string): string {
  /** Build a stable selection key that keeps provider identity attached to a session. */
  return `${provider}:${sessionId}`;
}
