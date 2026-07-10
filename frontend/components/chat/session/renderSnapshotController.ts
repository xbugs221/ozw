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
  nextHistoryOffset: number;
  hasMoreHistory: boolean;
  historyRevision: number;
  isLoadingHistory: boolean;
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
    nextHistoryOffset: 0,
    hasMoreHistory: false,
    historyRevision: 0,
    isLoadingHistory: false,
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
  input: {
    messages: RenderSnapshotMessage[];
    loadedAt: string;
    nextHistoryOffset?: number;
    hasMoreHistory?: boolean;
  },
): RenderSnapshotState {
  return {
    ...state,
    mode: 'renderedSnapshot',
    snapshotVersion: state.snapshotVersion + 1,
    snapshotMessages: [...input.messages],
    loadedAt: input.loadedAt,
    nextHistoryOffset: input.nextHistoryOffset ?? input.messages.length,
    hasMoreHistory: input.hasMoreHistory ?? false,
    historyRevision: 0,
    isLoadingHistory: false,
  };
}

/**
 * Replace the prepared viewport window without treating layout calibration as
 * a new user render.
 */
export function replaceRenderSnapshotMessages(
  state: RenderSnapshotState,
  messages: RenderSnapshotMessage[],
): RenderSnapshotState {
  /** Keep the frozen snapshot version stable while the viewport budget settles. */
  return { ...state, snapshotMessages: [...messages] };
}

/**
 * Replace the measured viewport budget and persist the bounded raw-page cursor.
 */
export function replaceRenderSnapshotBudget(
  state: RenderSnapshotState,
  input: {
    messages: RenderSnapshotMessage[];
    nextHistoryOffset: number;
    hasMoreHistory: boolean;
  },
): RenderSnapshotState {
  /** Keep calibration metadata aligned with every additional bounded raw page. */
  return {
    ...state,
    snapshotMessages: [...input.messages],
    nextHistoryOffset: input.nextHistoryOffset,
    hasMoreHistory: input.hasMoreHistory,
  };
}

/**
 * Mark a bounded older-history request as running or settled.
 */
export function setRenderSnapshotHistoryLoading(
  state: RenderSnapshotState,
  isLoadingHistory: boolean,
): RenderSnapshotState {
  /** Expose Render-owned loading state without borrowing the hidden TUI state. */
  return { ...state, isLoadingHistory };
}

/**
 * Prepend one user-requested logical history page and advance its raw cursor.
 */
export function prependRenderSnapshotHistory(
  state: RenderSnapshotState,
  input: {
    messages: RenderSnapshotMessage[];
    nextHistoryOffset: number;
    hasMoreHistory: boolean;
  },
): RenderSnapshotState {
  /** User navigation revises history while leaving the frozen tail version intact. */
  return {
    ...state,
    snapshotMessages: [...input.messages, ...state.snapshotMessages],
    nextHistoryOffset: input.nextHistoryOffset,
    hasMoreHistory: input.hasMoreHistory,
    historyRevision: state.historyRevision + 1,
    isLoadingHistory: false,
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
