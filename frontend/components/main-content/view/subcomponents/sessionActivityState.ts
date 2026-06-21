/**
 * PURPOSE: Share project home session-card activity signatures with the sidebar
 * so both surfaces agree on unread state and read receipts.
 */
import { getSessionActivityTime } from '../../../../utils/sessionActivityTime';

export interface Session {
  id: string;
  __provider?: string;
  provider?: string;
  __projectName?: string;
  lastActivity?: string;
  last_activity?: string;
  activityAt?: string;
  activity_at?: string;
  updated_at?: string;
  updatedAt?: string;
  time_updated?: string;
  timeUpdated?: string;
  modified_at?: string;
  modifiedAt?: string;
  timestamp?: string;
  created_at?: string;
  createdAt?: string;
  time_created?: string;
  timeCreated?: string;
  messageCount?: number | null;
  [key: string]: unknown;
}

export interface UnreadCheckParams {
  isSelected: boolean;
  viewedSignature: string | null;
  activitySignature: string;
}

export const VIEWED_SESSION_SIGNATURES_STORAGE_KEY = 'ozw:viewed-session-signatures';

function getSupportedSessionProvider(session: Session): string {
  /**
   * Convert missing or retired provider values to the default supported backend.
   */
  return session.__provider === 'pi' || session.provider === 'pi'
      ? 'pi'
      : 'codex';
}

export function getViewedSessionKey(projectName: string, session: Session): string {
  /**
   * Build the localStorage key for a session using its owning project name.
   */
  return [projectName, getSupportedSessionProvider(session), session.id].join(':');
}

export function getSessionProjectName(projectName: string, session: Session): string {
  /**
   * Prefer the session's source project so cross-project cards clear correctly.
   */
  return session.__projectName || projectName;
}

export function getSessionActivitySignature(session: Session): string {
  /**
   * Convert visible session activity into a stable read/unread comparison value.
   */
  const sessionTime = getSessionActivityTime(session);
  const messageCount = typeof session.messageCount === 'number' && Number.isFinite(session.messageCount)
    ? session.messageCount
    : 'unknown';
  return `${messageCount}:${String(sessionTime)}`;
}

export function readViewedSessionSignature(sessionKey: string): string | null {
  /**
   * Read a stored session activity signature from browser localStorage.
   */
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(VIEWED_SESSION_SIGNATURES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed?.[sessionKey] === 'string' ? parsed[sessionKey] as string : null;
  } catch {
    return null;
  }
}

export function writeViewedSessionSignature(sessionKey: string, signature: string): void {
  /**
   * Persist one read receipt while preserving other session signatures.
   */
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(VIEWED_SESSION_SIGNATURES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    window.localStorage.setItem(
      VIEWED_SESSION_SIGNATURES_STORAGE_KEY,
      JSON.stringify({ ...parsed, [sessionKey]: signature }),
    );
  } catch {
    // Ignore storage errors; unread state is a convenience signal.
  }
}

export function hasUnreadSessionActivity({ isSelected, viewedSignature, activitySignature }: UnreadCheckParams): boolean {
  /**
   * Match sidebar behavior: missing read receipt means current history is read.
   */
  return !isSelected && viewedSignature !== null && viewedSignature !== activitySignature;
}
