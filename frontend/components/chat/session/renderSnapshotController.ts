/**
 * PURPOSE: Manage user-triggered rendered JSONL snapshots for chat sessions.
 * Business purpose: The rendered view is a frozen history snapshot and must not replace the live TUI by automatic events.
 */

export type RenderSnapshotMessage = {
  messageKey: string;
  content: string;
  [key: string]: unknown;
};

export type RenderSnapshotState = {
  mode: 'tui' | 'renderedSnapshot';
  tuiSessionKey: string;
  snapshotVersion: number;
  snapshotMessages: RenderSnapshotMessage[];
  loadedAt: string | null;
};

const AUTO_REFRESH_EVENTS = new Set([
  'projects_updated',
  'codex-complete',
  'pi-complete',
  'externalMessageUpdate',
]);

/**
 * Create the default TUI-first render state for a chat session.
 *
 * @param input Stable TUI session key.
 * @returns Initial render snapshot state.
 */
export function createInitialRenderSnapshotState(input: { tuiSessionKey: string }): RenderSnapshotState {
  return {
    mode: 'tui',
    tuiSessionKey: input.tuiSessionKey,
    snapshotVersion: 0,
    snapshotMessages: [],
    loadedAt: null,
  };
}

/**
 * Store one user-requested JSONL render snapshot.
 *
 * @param state Previous snapshot state.
 * @param input Loaded messages and load timestamp.
 * @returns Next frozen rendered-snapshot state.
 */
export function applyUserRenderSnapshot(
  state: RenderSnapshotState,
  input: { messages: RenderSnapshotMessage[]; loadedAt: string },
): RenderSnapshotState {
  return {
    ...state,
    mode: 'renderedSnapshot',
    snapshotVersion: state.snapshotVersion + 1,
    snapshotMessages: [...input.messages],
    loadedAt: input.loadedAt,
  };
}

/**
 * Decide whether an automatic event should leave a rendered snapshot untouched.
 *
 * @param state Current snapshot state.
 * @param event Runtime event descriptor.
 * @returns True when the event must not refresh the snapshot.
 */
export function shouldIgnoreSnapshotAutoRefresh(
  state: RenderSnapshotState,
  event: { type: string },
): boolean {
  return state.mode === 'renderedSnapshot' && AUTO_REFRESH_EVENTS.has(event.type);
}

/**
 * Switch visible mode back to the live TUI without deleting the stored snapshot.
 *
 * @param state Current snapshot state.
 * @returns State with TUI selected.
 */
export function returnToTuiMode(state: RenderSnapshotState): RenderSnapshotState {
  return {
    ...state,
    mode: 'tui',
  };
}
