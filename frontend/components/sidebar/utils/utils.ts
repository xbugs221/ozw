// PURPOSE: Provide sidebar project/session formatting, filtering, and stable ordering helpers.
import type { TFunction } from 'i18next';
import type { Project, ProjectSession, ProjectWorkflow } from '../../../types/app';
import { normalizeBusinessTimestamp } from '../../../utils/dateUtils';
import { getSessionActivityTime } from '../../../utils/sessionActivityTime';
import type {
  AdditionalSessionsByProject,
  ProjectSortOrder,
  SettingsProject,
  SessionViewModel,
  SessionWithProvider,
} from '../types/types';
import {
  getSessionActivitySignature,
  getSessionProjectName,
  getViewedSessionKey,
  hasUnreadSessionActivity,
  readViewedSessionSignature,
} from '../../main-content/view/subcomponents/sessionActivityState';

type SessionUiState = {
  favorite?: boolean;
  pending?: boolean;
  hidden?: boolean;
};

export type SessionCardSortMode = 'created' | 'updated' | 'title' | 'provider';

export const readProjectSortOrder = (): ProjectSortOrder => {
  return 'name';
};

const pickSessionDisplayText = (value: unknown): string => {
  /**
   * PURPOSE: Guard against malformed payloads where label-like fields may be
   * objects/arrays and would otherwise be rendered as React children.
   */
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  if (Array.isArray(value)) {
    return value.map(pickSessionDisplayText).filter(Boolean).join(' ');
  }

  const dictValue = value as Record<string, unknown>;
  const nestedText = dictValue.label
    || dictValue.title
    || dictValue.summary
    || dictValue.name
    || dictValue.text;

  if (typeof nestedText === 'string' || typeof nestedText === 'number' || typeof nestedText === 'boolean') {
    return String(nestedText);
  }

  return '';
};

const getFirstSessionDisplayText = (fallback: string, ...candidates: unknown[]): string => {
  const next = candidates
    .map((candidate) => pickSessionDisplayText(candidate).trim())
    .find((text) => text.length > 0);

  return next || fallback;
};

export const getSessionDate = (session: SessionWithProvider): Date => {
  return normalizeBusinessTimestamp(getSessionActivityTime(session)) || new Date(0);
};

/**
 * Read the immutable creation route number used to keep manual sessions stable.
 */
const getSessionRouteIndex = (session: SessionWithProvider): number | null => {
  const routeIndex = Number(session.routeIndex);
  if (Number.isInteger(routeIndex) && routeIndex > 0) {
    return routeIndex;
  }

  const idMatch = String(session.id || '').match(/^c(\d+)$/);
  if (!idMatch) {
    return null;
  }

  const idRouteIndex = Number.parseInt(idMatch[1], 10);
  return Number.isInteger(idRouteIndex) && idRouteIndex > 0 ? idRouteIndex : null;
};

/**
 * Use creation time only as a fallback for old sessions that predate route indexes.
 */
const getSessionCreatedTime = (session: SessionWithProvider): number => (
  (normalizeBusinessTimestamp(session.createdAt || session.created_at)?.getTime() ?? 0)
);

/**
 * Compare two numbers while keeping invalid timestamps at the end.
 */
const compareDescendingNumber = (left: number, right: number): number => {
  const safeLeft = Number.isFinite(left) ? left : Number.NEGATIVE_INFINITY;
  const safeRight = Number.isFinite(right) ? right : Number.NEGATIVE_INFINITY;
  return safeRight - safeLeft;
};

/**
 * Sort manual sessions by fixed creation number, newest first.
 */
export const compareSessionsByCreationNumber = (
  sessionA: SessionWithProvider,
  sessionB: SessionWithProvider,
): number => {
  const routeIndexA = getSessionRouteIndex(sessionA);
  const routeIndexB = getSessionRouteIndex(sessionB);

  if (routeIndexA !== null || routeIndexB !== null) {
    return (routeIndexB ?? Number.NEGATIVE_INFINITY) - (routeIndexA ?? Number.NEGATIVE_INFINITY);
  }

  return getSessionCreatedTime(sessionB) - getSessionCreatedTime(sessionA);
};

/**
 * Sort session cards by the selected business field without changing route ids.
 */
export const compareSessionsByCardSortMode = (
  sessionA: SessionWithProvider,
  sessionB: SessionWithProvider,
  mode: SessionCardSortMode,
  t: TFunction,
): number => {
  if (mode === 'updated') {
    const byActivity = compareDescendingNumber(
      normalizeBusinessTimestamp(getSessionActivityTime(sessionA))?.getTime() ?? Number.NaN,
      normalizeBusinessTimestamp(getSessionActivityTime(sessionB))?.getTime() ?? Number.NaN,
    );
    return byActivity || compareSessionsByCreationNumber(sessionA, sessionB);
  }

  if (mode === 'title') {
    const byTitle = getSessionName(sessionA, t).localeCompare(getSessionName(sessionB, t), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    return byTitle || compareSessionsByCreationNumber(sessionA, sessionB);
  }

  if (mode === 'provider') {
    const byProvider = String(sessionA.__provider || '').localeCompare(String(sessionB.__provider || ''));
    return byProvider || compareSessionsByCreationNumber(sessionA, sessionB);
  }

  return compareSessionsByCreationNumber(sessionA, sessionB);
};

export const getSessionName = (session: SessionWithProvider, t: TFunction): string => {
  if (session.__provider === 'codex') {
    return getFirstSessionDisplayText(
      t('projects.codexSession'),
      session.label,
      session.routeTitle,
      session.title,
      session.summary,
      session.name,
    );
  }

  if (session.__provider === 'pi') {
    return getFirstSessionDisplayText(
      t('projects.piSession'),
      session.label,
      session.routeTitle,
      session.title,
      session.summary,
      session.name,
    );
  }

  return getFirstSessionDisplayText(
    t('projects.newSession'),
    session.label,
    session.routeTitle,
    session.title,
    session.summary,
    session.name,
  );
};

export const getSessionTime = (session: SessionWithProvider): string => {
  return getSessionActivityTime(session);
};

export const createSessionViewModel = (
  session: SessionWithProvider,
  currentTime: Date,
  t: TFunction,
): SessionViewModel => {
  const sessionDate = getSessionDate(session);

  return {
    isCodexSession: session.__provider === 'codex',
    isActive: isSessionActive(session, currentTime),
    sessionName: getSessionName(session, t),
    sessionTime: getSessionTime(session),
    messageCount: typeof session.messageCount === 'number' && Number.isFinite(session.messageCount)
      ? session.messageCount
      : null,
  };
};

export const isSessionActive = (
  session: SessionWithProvider,
  currentTime: Date,
): boolean => {
  const sessionDate = getSessionDate(session);
  const diffInMinutes = Math.floor((currentTime.getTime() - sessionDate.getTime()) / (1000 * 60));
  return diffInMinutes >= 0 && diffInMinutes < 10;
};

export const getReadableSessionIds = (session: ProjectSession): string[] => {
  /**
   * PURPOSE: Match read receipts written against either the ozw route id or
   * provider-native session ids discovered from history files.
   */
  return Array.from(new Set([
    session.id,
    typeof session.sessionId === 'string' ? session.sessionId : '',
    typeof session.providerSessionId === 'string' ? session.providerSessionId : '',
    typeof session.sourceSessionId === 'string' ? session.sourceSessionId : '',
    typeof session.thread === 'string' ? session.thread : '',
    typeof session.sessionFileName === 'string' ? session.sessionFileName.replace(/\.jsonl$/i, '') : '',
  ].filter(Boolean)));
};

export const getReadableProjectNames = (project: Project, session: ProjectSession): string[] => {
  /**
   * PURPOSE: Read current path-keyed receipts and legacy visible-name receipts
   * so sidebar attention follows the same unread state as session cards.
   */
  return Array.from(new Set([
    getSessionProjectName(project.name, session),
    project.name,
    project.displayName,
  ].filter(Boolean)));
};

export const readSidebarViewedSessionSignature = (project: Project, session: ProjectSession): string | null => {
  /**
   * PURPOSE: Resolve every supported receipt key before deciding whether a
   * manual session has unread activity.
   */
  return getReadableProjectNames(project, session)
    .flatMap((projectName) => getReadableSessionIds(session)
      .map((sessionId) => readViewedSessionSignature(getViewedSessionKey(projectName, { ...session, id: sessionId }))))
    .find((signature) => signature !== null) || null;
};

export const isSidebarAttentionSession = (
  project: Project,
  session: SessionWithProvider,
  selectedSession: ProjectSession | null,
  currentTime: Date,
): boolean => {
  /**
   * PURPOSE: Keep manual session attention limited to current, unread, or
   * actively changing sessions.
   */
  const isSelected = selectedSession?.id === session.id;
  if (isSelected) {
    return true;
  }

  const activitySignature = getSessionActivitySignature(session);
  const viewedSignature = readSidebarViewedSessionSignature(project, session);
  return hasUnreadSessionActivity({ isSelected, viewedSignature, activitySignature })
    || isSessionActive(session, currentTime);
};

export const isSidebarAttentionWorkflow = (
  workflow: ProjectWorkflow,
  selectedWorkflow?: ProjectWorkflow | null,
): boolean => {
  /**
   * PURPOSE: Keep workflow attention aligned with the contract: current route,
   * unread activity, or a running workflow.
   */
  const isSelected = selectedWorkflow?.id === workflow.id;
  const runState = String(workflow.runState || workflow.stage || '').toLowerCase();
  return isSelected
    || workflow.hasUnreadActivity === true
    || runState === 'running';
};

export const getAllSessions = (
  project: Project,
  additionalSessions: AdditionalSessionsByProject,
  includeHidden = false,
): SessionWithProvider[] => {
  const isVisibleByDefault = (session: { hidden?: boolean; archived?: boolean; status?: string }) =>
    !(
      session.hidden === true ||
      session.archived === true ||
      session.status === 'archived' ||
      session.status === 'hidden'
    );

  const codexSessions = (project.codexSessions || [])
    .filter((session) => includeHidden || isVisibleByDefault(session))
    .map((session) => ({
      ...session,
      __provider: 'codex' as const,
    }));

  const piSessions = (project.piSessions || [])
    .filter((session) => includeHidden || isVisibleByDefault(session))
    .map((session) => ({
      ...session,
      __provider: 'pi' as const,
    }));
  const claudeSessions = (project.claudeSessions || [])
    .filter((session) => includeHidden || isVisibleByDefault(session))
    .map((session) => ({ ...session, __provider: 'claude' as const }));

  const hermesSessions = (project.hermesSessions || [])
    .filter((session) => includeHidden || isVisibleByDefault(session))
    .map((session) => ({ ...session, __provider: 'hermes' as const }));

  return [...codexSessions, ...piSessions, ...claudeSessions, ...hermesSessions].sort(compareSessionsByCreationNumber);
};

/**
 * Keep manual session order fixed by creation number, independent from refresh time.
 */
export const sortSessions = (
  sessions: SessionWithProvider[],
  getSessionMeta: (session: SessionWithProvider, projectName: string) => SessionUiState,
  projectName: string,
  sortMode: SessionCardSortMode = 'created',
  t?: TFunction,
): SessionWithProvider[] => {
  /**
   * The selected card order is primary; flags only break ties for duplicated legacy entries.
   */
  return [...sessions].sort((sessionA, sessionB) => {
    const bySelectedMode = t
      ? compareSessionsByCardSortMode(sessionA, sessionB, sortMode, t)
      : compareSessionsByCreationNumber(sessionA, sessionB);
    if (bySelectedMode !== 0) {
      return bySelectedMode;
    }

    const metaA = getSessionMeta(sessionA, projectName);
    const metaB = getSessionMeta(sessionB, projectName);
    const aFavoriteScore = metaA.favorite === true ? 1 : 0;
    const bFavoriteScore = metaB.favorite === true ? 1 : 0;

    if (aFavoriteScore !== bFavoriteScore) {
      return bFavoriteScore - aFavoriteScore;
    }

    const aPendingScore = metaA.pending === true ? 1 : 0;
    const bPendingScore = metaB.pending === true ? 1 : 0;

    if (aPendingScore !== bPendingScore) {
      return bPendingScore - aPendingScore;
    }

    return String(sessionB.id || '').localeCompare(String(sessionA.id || ''));
  });
};

export const getProjectLastActivity = (
  project: Project,
  additionalSessions: AdditionalSessionsByProject,
): Date => {
  const sessions = getAllSessions(project, additionalSessions);
  if (sessions.length === 0) {
    return new Date(0);
  }

  return sessions.reduce((latest, session) => {
    const sessionDate = getSessionDate(session);
    return sessionDate > latest ? sessionDate : latest;
  }, new Date(0));
};

export const sortProjects = (
  projects: Project[],
  _projectSortOrder: ProjectSortOrder,
  _additionalSessions: AdditionalSessionsByProject,
): Project[] => {
  const sorted = [...projects];

  sorted.sort((projectA, projectB) => {
    const displayNameA = String(projectA.displayName || projectA.name || '').toLowerCase();
    const displayNameB = String(projectB.displayName || projectB.name || '').toLowerCase();
    const byDisplayName = displayNameA.localeCompare(displayNameB);
    if (byDisplayName !== 0) {
      return byDisplayName;
    }

    return String(projectA.name || '').localeCompare(String(projectB.name || ''));
  });

  return sorted;
};

export const normalizeProjectForSettings = (project: Project): SettingsProject => {
  const fallbackPath =
    typeof project.fullPath === 'string' && project.fullPath.length > 0
      ? project.fullPath
      : typeof project.path === 'string'
        ? project.path
        : '';

  return {
    name: project.name,
    displayName:
      typeof project.displayName === 'string' && project.displayName.trim().length > 0
        ? project.displayName
        : project.name,
    fullPath: fallbackPath,
    path:
      typeof project.path === 'string' && project.path.length > 0
        ? project.path
        : fallbackPath,
  };
};
