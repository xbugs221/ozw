/**
 * PURPOSE: Shared helpers for ordered WebSocket message consumption.
 * These utilities keep realtime consumers aligned on how to skip historical backlog,
 * select pending messages, and apply batched project updates without losing ordering.
 */

export interface SocketMessageEntry {
  sequence?: number;
  message?: unknown;
}

/**
 * Return the latest processed sequence number from a message history snapshot.
 * Consumers use this to avoid replaying stale messages after a remount.
 */
export function getMessageHistoryTailSequence(messageHistory: SocketMessageEntry[]): number {
  if (!Array.isArray(messageHistory) || messageHistory.length === 0) {
    return 0;
  }

  const tailSequence = messageHistory[messageHistory.length - 1]?.sequence ?? 0;
  return Number.isFinite(tailSequence) ? tailSequence : 0;
}

export interface PendingSocketMessageEntry {
  sequence: number;
  message?: unknown;
}

/**
 * Collect socket messages that have not been processed yet.
 */
export function getPendingSocketMessages(
  messageHistory: SocketMessageEntry[],
  lastProcessedSequence: number,
): PendingSocketMessageEntry[] {
  if (!Array.isArray(messageHistory) || messageHistory.length === 0) {
    return [];
  }

  return messageHistory.filter((entry) => {
    const sequence = entry?.sequence ?? 0;
    return Number.isFinite(sequence) && sequence > lastProcessedSequence;
  }) as PendingSocketMessageEntry[];
}

/**
 * Return non-empty string identifiers from a loose socket/session object.
 */
function collectStringIds(value: unknown, keys: string[]): Set<string> {
  const ids = new Set<string>();
  if (!value || typeof value !== 'object') {
    return ids;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw !== 'string') {
      continue;
    }
    const normalized = raw.trim();
    if (normalized) {
      ids.add(normalized);
    }
  }

  return ids;
}

/**
 * Check whether a lightweight session_changed event targets the open chat.
 */
export function sessionChangedMatchesSelectedSession(
  message: unknown,
  selectedSession: unknown,
): boolean {
  const eventIds = collectStringIds(message, [
    'sessionId',
    'ozwSessionId',
    'ozw_session_id',
    'providerSessionId',
    'provider_session_id',
    'sourceSessionId',
    'source_session_id',
  ]);
  if (eventIds.size === 0) {
    return false;
  }

  const sessionIds = collectStringIds(selectedSession, [
    'id',
    'ozwSessionId',
    'ozw_session_id',
    'providerSessionId',
    'provider_session_id',
    'sourceSessionId',
    'source_session_id',
  ]);

  for (const sessionId of sessionIds) {
    if (eventIds.has(sessionId)) {
      return true;
    }
  }

  return false;
}

export interface ProjectsUpdatedMessage {
  type: string;
  projects?: Record<string, unknown>[];
  changedFile?: string;
}

export interface ReduceProjectsUpdatedParams {
  messages: ProjectsUpdatedMessage[];
  projects: Record<string, unknown>[];
  selectedProject: Record<string, unknown> | null;
  selectedSession: Record<string, unknown> | null;
  activeSessions: Set<string>;
  getProjectSessions: (project: Record<string, unknown>) => Record<string, unknown>[];
  isUpdateAdditive: (
    currentProjects: Record<string, unknown>[],
    updatedProjects: Record<string, unknown>[],
    selectedProject: Record<string, unknown> | null,
    selectedSession: Record<string, unknown> | null,
  ) => boolean;
}

export interface ReduceProjectsUpdatedResult {
  projects: Record<string, unknown>[];
  selectedProject: Record<string, unknown> | null;
  selectedSession: Record<string, unknown> | null;
  externalMessageUpdateCount: number;
}

/**
 * Apply a batch of `projects_updated` messages using evolving local snapshots.
 * This preserves ordering when multiple project payloads arrive before React rerenders.
 */
export function reduceProjectsUpdatedMessages({
  messages,
  projects,
  selectedProject,
  selectedSession,
  activeSessions,
  getProjectSessions,
  isUpdateAdditive,
}: ReduceProjectsUpdatedParams): ReduceProjectsUpdatedResult {
  let currentProjects: Record<string, unknown>[] = Array.isArray(projects) ? projects : [];
  let currentSelectedProject = selectedProject || null;
  let currentSelectedSession = selectedSession || null;
  let externalMessageUpdateCount = 0;

  const isTemporarySessionId = (sessionId: unknown): boolean =>
    typeof sessionId === 'string' && (sessionId.startsWith('new-session-') || /^c\d+$/.test(sessionId));

  for (const latestMessage of Array.isArray(messages) ? messages : []) {
    if (!latestMessage || latestMessage.type !== 'projects_updated') {
      continue;
    }

    if (!Array.isArray(latestMessage.projects)) {
      continue;
    }

    if (latestMessage.changedFile && currentSelectedSession && currentSelectedProject) {
      const normalized = String(latestMessage.changedFile).replace(/\\/g, '/');
      const changedFileParts = normalized.split('/');

      if (changedFileParts.length >= 2) {
        const filename = changedFileParts[changedFileParts.length - 1];
        const changedSessionId = filename.replace('.jsonl', '');

        if (changedSessionId === (currentSelectedSession as Record<string, unknown>)?.id && !activeSessions.has(currentSelectedSession.id as string)) {
          externalMessageUpdateCount += 1;
        }
      }
    }

    const hasActiveSession =
      (currentSelectedSession && activeSessions.has(currentSelectedSession.id as string)) ||
      Array.from(activeSessions).some((id) => isTemporarySessionId(id));

    const updatedProjects = latestMessage.projects as Record<string, unknown>[];

    if (
      hasActiveSession &&
      !isUpdateAdditive(
        currentProjects,
        updatedProjects,
        currentSelectedProject,
        currentSelectedSession,
      )
    ) {
      continue;
    }

    currentProjects = updatedProjects;

    if (!currentSelectedProject) {
      continue;
    }

    const updatedSelectedProject = updatedProjects.find(
      (project) => project.name === currentSelectedProject?.name,
    );

    if (!updatedSelectedProject) {
      continue;
    }

    currentSelectedProject = updatedSelectedProject;

    if (!currentSelectedSession) {
      continue;
    }

    const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
      (session) => session.id === currentSelectedSession?.id,
    );

    /**
     * Keep temporary manual sessions stable while background project refreshes
     * stream in. They are route-backed client placeholders, so they do not
     * appear in `projects_updated` payloads until the backend creates a real
     * session id.
     */
    if (!updatedSelectedSession && isTemporarySessionId(currentSelectedSession?.id)) {
      continue;
    }

    /**
     * A projects_updated payload is a sidebar snapshot, not an authoritative
     * instruction to close the currently open chat. The selected session can be
     * absent because the refreshed list is paginated or because another session
     * changed recency. Preserve the open chat to avoid clearing and rehydrating
     * the message pane on unrelated background updates.
     */
    if (!updatedSelectedSession && currentSelectedSession) {
      continue;
    }

    currentSelectedSession = updatedSelectedSession || null;
  }

  return {
    projects: currentProjects,
    selectedProject: currentSelectedProject,
    selectedSession: currentSelectedSession,
    externalMessageUpdateCount,
  };
}
