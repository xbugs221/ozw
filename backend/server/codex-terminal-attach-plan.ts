/**
 * 文件目的：集中决定 Codex 会话终端应复连 tmux、连接共享 daemon 或安全阻止。
 * 业务意义：已知活动的旧式外部会话不会被普通 resume 抢占。
 */

export type CodexTerminalAttachPlan = {
  action: 'attach-tmux' | 'remote-tui' | 'legacy-resume' | 'new-session' | 'blocked';
  commandArgs: string[] | null;
  reason: string | null;
  requiresOzwServer: boolean;
  mayInterruptActiveTurn: boolean;
  sessionFailed: boolean;
};

/** 依据 tmux、共享运行时和外部活动状态生成终端接管计划。 */
export function resolveCodexTerminalAttachPlan(input: {
  providerSessionId: string | null;
  managedTmuxExists: boolean;
  sharedRuntime: { ready: boolean; endpoint: string | null; threadOwned?: boolean; activeTurnOwned?: boolean };
  externalSessionState: 'running' | 'idle' | 'unknown';
}): CodexTerminalAttachPlan {
  if (input.managedTmuxExists) {
    return { action: 'attach-tmux', commandArgs: null, reason: null, requiresOzwServer: true, mayInterruptActiveTurn: false, sessionFailed: false };
  }
  const sharedHandoffVerified = input.sharedRuntime.threadOwned === true;
  if (input.sharedRuntime.ready && input.sharedRuntime.endpoint && input.providerSessionId && sharedHandoffVerified) {
    return {
      action: 'remote-tui',
      commandArgs: ['--remote', input.sharedRuntime.endpoint, 'resume', input.providerSessionId],
      reason: null, requiresOzwServer: false, mayInterruptActiveTurn: false, sessionFailed: false,
    };
  }
  if (input.externalSessionState === 'running' || (input.externalSessionState === 'unknown' && Boolean(input.providerSessionId))) {
    return {
      action: 'blocked', commandArgs: null,
      reason: input.externalSessionState === 'running'
        ? 'external-active-session-not-shared'
        : 'external-session-sharing-unknown',
      requiresOzwServer: false, mayInterruptActiveTurn: false, sessionFailed: false,
    };
  }
  if (input.providerSessionId) {
    return {
      action: 'legacy-resume', commandArgs: ['resume', input.providerSessionId], reason: 'shared-runtime-unavailable',
      requiresOzwServer: false, mayInterruptActiveTurn: false, sessionFailed: false,
    };
  }
  return { action: 'new-session', commandArgs: [], reason: null, requiresOzwServer: false, mayInterruptActiveTurn: false, sessionFailed: false };
}
