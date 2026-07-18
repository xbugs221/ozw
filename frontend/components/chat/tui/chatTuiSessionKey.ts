/**
 * PURPOSE: Build stable chat TUI PTY session keys across view switches.
 * Business purpose: Codex and Pi terminals must reconnect to the right provider session without sharing PTY state.
 */

type ChatTuiSessionKeyInput = {
  projectPath: string;
  provider: 'codex' | 'pi' | 'claude';
  routeSessionId?: string | null;
  providerSessionId?: string | null;
};

/**
 * Convert user and route context into one readable PTY session identity.
 *
 * @param input Project, provider, route, and provider session identifiers.
 * @returns Stable key used by browser and backend shell relay.
 */
export function buildChatTuiSessionKey(input: ChatTuiSessionKeyInput): string {
  const projectPath = input.projectPath.trim() || 'unknown-project';
  const routeSessionId = input.routeSessionId?.trim() || 'no-route-session';
  const providerSessionId = input.providerSessionId?.trim() || 'no-provider-session';

  return [
    'chat-tui',
    `provider=${input.provider}`,
    `project=${projectPath}`,
    `route=${routeSessionId}`,
    `providerSession=${providerSessionId}`,
  ].join('|');
}
