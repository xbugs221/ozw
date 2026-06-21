/**
 * PURPOSE: Render the project-level manual session list and workflow checklist
 * in the main content area before the user opens a concrete page.
 */
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
const ChevronDown = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>;
const ChevronRight = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>;
const Clock = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>;
const FolderOpen = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>;
const MessageSquarePlus = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>;
const Star = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26 12,2"/></svg>;
const Trash2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
const X = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import type { Project, ProjectSession, ProjectWorkflow, SessionProvider } from '../../../types/app';
import type { ProjectOverviewPanelProps } from '../types/types';
import {
  compareSessionsByCardSortMode,
  createSessionViewModel,
  type SessionCardSortMode,
} from '../../sidebar/utils/utils';
import { formatTimeAgo } from '../../../utils/dateUtils';
import { getSessionActivityTime } from '../../../utils/sessionActivityTime';
import { api } from '../../../utils/api';
import { getSessionRouteNumber } from '../../../utils/sessionCardDisplay';
import {
  buildWorkflowOverviewGroups,
  getWorkflowUpdatedAt,
  isWorkflowCompleted,
  type WorkflowOverviewGroup,
} from '../../../utils/workflowGroups';
import { isWorkflowOwnedSession } from '../../../utils/workflowSessions';
import SessionProviderLogo from '../../llm-logo-provider/SessionProviderLogo';
import SessionActionIconMenu from '../../session-actions/SessionActionIconMenu';
import WorkflowStageProgress from '../../workflow/WorkflowStageProgress';
import WorkflowActionDialog from '../../workflow/WorkflowActionDialog';
import { ProjectOverviewWorkflowGroups } from './ProjectOverviewWorkflowGroups';
import { ProjectOverviewSessionCards } from './ProjectOverviewSessionCards';
import { ProjectOverviewActions } from './ProjectOverviewActions';
import {
  getSessionActivitySignature,
  getSessionProjectName,
  getViewedSessionKey,
  hasUnreadSessionActivity,
  readViewedSessionSignature,
  writeViewedSessionSignature,
} from '../view/subcomponents/sessionActivityState';

const ITEM_ACTION_LONG_PRESS_MS = 450;
const DEFAULT_VISIBLE_WORKFLOW_GROUPS = 1;
const DEFAULT_VISIBLE_MANUAL_SESSION_CARDS = 10;
type WorkflowCardSortMode = 'created' | 'updated' | 'title' | 'provider';

const normalizeActionSessionProvider = (provider: unknown): SessionProvider => (
  provider === 'pi' ? 'pi' : 'codex'
);

const CARD_SORT_OPTIONS: Array<{ value: SessionCardSortMode; label: string }> = [
  { value: 'created', label: '创建时间' },
  { value: 'updated', label: '最近消息' },
  { value: 'title', label: '标题' },
  { value: 'provider', label: 'Provider' },
];

type OverviewActionMenuState =
  | {
    isOpen: false;
    x: number;
    y: number;
  }
  | {
    isOpen: true;
    x: number;
    y: number;
    kind: 'workflow';
    workflowId: string;
    workflowTitle: string;
  }
  | {
    isOpen: true;
    x: number;
    y: number;
    kind: 'session';
    sessionId: string;
    sessionTitle: string;
    sessionProvider: SessionProvider;
    sessionProjectName: string;
  };

type OverviewActionMenuTarget =
  | {
    kind: 'workflow';
    workflowId: string;
    workflowTitle: string;
  }
  | {
    kind: 'session';
    sessionId: string;
    sessionTitle: string;
    sessionProvider: SessionProvider;
    sessionProjectName: string;
  };

function getSessionSelectionKey(
  session: ProjectSession,
  projectName: string,
  provider = normalizeActionSessionProvider(session.__provider),
): string {
  /**
   * Create a stable key so Codex and Pi sessions with the same id do not
   * collide when selected together on the project homepage.
   */
  return `${session.__projectName || projectName}::${provider}::${session.id}`;
}

function getResolvedSessionSelectionKey(
  session: ProjectSession,
  projectName: string,
): string {
  /**
   * Build the UI-state key from the same normalized project/provider identity
   * used by API updates and context-menu actions.
   */
  return getSessionSelectionKey(
    session,
    getSessionProjectName(projectName, session),
    normalizeActionSessionProvider(session.__provider),
  );
}

/**
 * Keep manual session card titles focused on the user's initial request.
 */
function getManualSessionCardTitle(sessionName: string): string {
  const normalizedName = sessionName.trim();
  return Array.from(normalizedName).slice(0, 20).join('') || sessionName;
}

/**
 * Sort workflow overview cards by stable runner read-model fields.
 */
function compareWorkflowBySortMode(
  workflowA: ProjectWorkflow,
  workflowB: ProjectWorkflow,
  mode: WorkflowCardSortMode,
): number {
  if (mode === 'updated') {
    return getWorkflowUpdatedAt(workflowB) - getWorkflowUpdatedAt(workflowA);
  }

  if (mode === 'title') {
    return String(workflowA.title || '').localeCompare(String(workflowB.title || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }

  if (mode === 'provider') {
    const leftProvider = String(workflowA.provider || workflowA.ownerProvider || workflowA.childSessions?.[0]?.provider || '');
    const rightProvider = String(workflowB.provider || workflowB.ownerProvider || workflowB.childSessions?.[0]?.provider || '');
    return leftProvider.localeCompare(rightProvider) || String(workflowA.title || '').localeCompare(String(workflowB.title || ''));
  }

  return getWorkflowUpdatedAt(workflowB) - getWorkflowUpdatedAt(workflowA)
    || String(workflowA.title || workflowA.runId || workflowA.id || '').localeCompare(String(workflowB.title || workflowB.runId || workflowB.id || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
}

/**
 * Batch-aware workflow group component for the auto workflow overview.
 * Shows the latest batch summary followed by its proposal rows.
 */
function BatchWorkflowGroup({
  group,
  isLatest,
  project,
  selectedWorkflow,
  currentTime,
  t,
  onSelectWorkflow,
  onOpenActionMenu,
  bindLongPress,
  handleProtectedClick,
}: {
  group: WorkflowOverviewGroup;
  isLatest: boolean;
  project: Project;
  selectedWorkflow?: ProjectWorkflow | null;
  currentTime: Date;
  t: ReturnType<typeof useTranslation>['t'];
  onSelectWorkflow: (project: Project, workflow: ProjectWorkflow) => void;
  onOpenActionMenu: (state: {
    isOpen: true;
    x: number;
    y: number;
    kind: 'workflow';
    workflowId: string;
    workflowTitle: string;
  }) => void;
  bindLongPress: (state: {
    kind: 'workflow';
    workflowId: string;
    workflowTitle: string;
  }) => {
    onTouchStart: (event: React.TouchEvent<HTMLElement>) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
    onTouchMove: () => void;
  };
  handleProtectedClick: (callback: () => void) => void;
}) {
  const { batch, workflows } = group;
  const progressCurrent = batch && typeof batch.displayCurrentIndex === 'number'
    ? batch.displayCurrentIndex
    : batch
      ? Math.min(Math.max(batch.currentIndex + 1, batch.total > 0 ? 1 : 0), batch.total)
      : workflows.filter(isWorkflowCompleted).length;
  const progressTotal = batch?.total || workflows.length;
  const progressLabel = `${progressCurrent}/${progressTotal}`;
  const latestTimestamp = group.latestUpdatedAt > 0 ? new Date(group.latestUpdatedAt).toISOString() : '';

  return (
    <div
      data-testid={`batch-group-${group.id}`}
      className="space-y-2"
    >
      <div
        className="space-y-1 text-sm"
        data-testid={`batch-header-${group.id}`}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate font-medium text-foreground">
            {isLatest ? '最新批量' : '历史批量'}：{group.label.replace(/^批量任务\s*/, '')}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="shrink-0 text-muted-foreground">{progressLabel}</span>
          {latestTimestamp && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="shrink-0 text-muted-foreground">
                {formatTimeAgo(latestTimestamp, currentTime, t)}
              </span>
            </>
          )}
        </div>
        {batch?.error && (
          <div
            className="whitespace-pre-wrap break-words rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs leading-5 text-destructive"
            data-testid={`batch-error-${group.id}`}
          >
            {batch.error}
          </div>
        )}
      </div>
      <div className="space-y-2">
        {workflows.map((workflow) => renderWorkflowCard(
          workflow, selectedWorkflow, currentTime, t,
          onSelectWorkflow, onOpenActionMenu, bindLongPress, handleProtectedClick, project,
        ))}
      </div>
    </div>
  );
}

/**
 * Render a single workflow card used by both batch groups and ungrouped runs.
 */
function renderWorkflowCard(
  workflow: ProjectWorkflow,
  selectedWorkflow: ProjectWorkflow | null | undefined,
  currentTime: Date,
  t: ReturnType<typeof useTranslation>['t'],
  onSelectWorkflow: (project: Project, workflow: ProjectWorkflow) => void,
  onOpenActionMenu: (state: {
    isOpen: true;
    x: number;
    y: number;
    kind: 'workflow';
    workflowId: string;
    workflowTitle: string;
  }) => void,
  bindLongPress: (state: {
    kind: 'workflow';
    workflowId: string;
    workflowTitle: string;
  }) => {
    onTouchStart: (event: React.TouchEvent<HTMLElement>) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
    onTouchMove: () => void;
  },
  handleProtectedClick: (callback: () => void) => void,
  project: Project | null,
) {
  const isSelected = selectedWorkflow?.id === workflow.id;
  const isPendingBatchItem = Boolean(workflow.isPendingBatchItem);
  const workflowActionState = {
    kind: 'workflow' as const,
    workflowId: workflow.id,
    workflowTitle: workflow.title,
  };
  return (
    <div
      key={workflow.id}
      className={[
        'flex min-w-0 flex-col rounded-md border shadow-sm transition-colors',
        isSelected
          ? 'border-primary bg-primary/10'
          : isPendingBatchItem
            ? 'border-border/60 bg-muted/30'
            : isWorkflowCompleted(workflow)
            ? 'border-emerald-500/20 bg-emerald-500/[0.03]'
            : 'border-sky-500/20 bg-card',
      ].join(' ')}
      onContextMenu={(event) => {
        event.preventDefault();
        if (isPendingBatchItem) {
          return;
        }
        onOpenActionMenu({
          isOpen: true,
          ...workflowActionState,
          x: event.clientX,
          y: event.clientY,
        });
      }}
      {...(isPendingBatchItem ? {} : bindLongPress(workflowActionState))}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col items-start gap-1 px-3 py-2 text-left disabled:cursor-default"
        disabled={isPendingBatchItem}
        onClick={() => handleProtectedClick(() => {
          if (project && !isPendingBatchItem) onSelectWorkflow(project, workflow);
        })}
      >
        <div className="w-full min-w-0 truncate text-sm font-medium text-foreground">{workflow.title}</div>
        <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden text-xs leading-none text-muted-foreground">
          <span className="shrink-0">
            {isPendingBatchItem
              ? '待启动'
              : workflow.updatedAt
              ? formatTimeAgo(workflow.updatedAt, currentTime, t)
              : '未知时间'}
          </span>
          <WorkflowStageProgress stageStatuses={workflow.stageStatuses} size="sm" />
        </div>
      </button>
    </div>
  );
}

export default function ProjectOverviewPanel({
  project,
  selectedSession,
  selectedWorkflow,
  sessions,
  displayMode = 'all',
  onNewSession,
  onSelectSession,
  onSelectWorkflow,
}: ProjectOverviewPanelProps) {
  const navigate = useNavigate();
  const { t } = useTranslation(['sidebar', 'common']);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [showHiddenItems, setShowHiddenItems] = useState(false);
  /** 卡片排序只改变展示顺序，不参与 cN/wN 编号。 */
  const [sessionSortMode, setSessionSortMode] = useState<SessionCardSortMode>('created');
  /** 卡片排序只改变展示顺序，不参与 cN/wN 编号。 */
  const [workflowSortMode, setWorkflowSortMode] = useState<WorkflowCardSortMode>('created');
  const [optimisticSessionUiState, setOptimisticSessionUiState] = useState<Record<string, Pick<ProjectSession, 'favorite' | 'pending' | 'hidden'>>>({});
  const projectConfigPath = project.fullPath || project.path || '';
  const workflowEntries = [...(project.workflows || [])]
    .sort((workflowA, workflowB) => compareWorkflowBySortMode(workflowA, workflowB, workflowSortMode));
  const workflows = workflowEntries;

  const batchGroups = useMemo(
    () => buildWorkflowOverviewGroups(workflows, project.batches || []),
    [project.batches, workflows],
  );
  const sessionEntries = [...sessions]
    .map((session) => ({
      ...session,
      ...(optimisticSessionUiState[getSessionSelectionKey(session, project.name)] || {}),
      ...(optimisticSessionUiState[getResolvedSessionSelectionKey(session, project.name)] || {}),
      hidden: optimisticSessionUiState[getResolvedSessionSelectionKey(session, project.name)]?.hidden
        ?? optimisticSessionUiState[getSessionSelectionKey(session, project.name)]?.hidden
        ?? session.hidden,
    }))
    .filter((session) => {
      if (selectedSession?.workflowId && selectedSession.id === session.id) {
        return false;
      }
      return !isWorkflowOwnedSession(project, session);
    })
    .sort((sessionA, sessionB) => compareSessionsByCardSortMode(sessionA, sessionB, sessionSortMode, t));
  const visibleSessions = sessionEntries
    .filter((session) => showHiddenItems || session.hidden !== true);
  const hiddenSessionCount = sessionEntries.filter((session) => session.hidden === true).length;
  const [workflowExpanded, setWorkflowExpanded] = useState(() => displayMode === 'all' || displayMode === 'workflows');
  const [showAllWorkflowGroups, setShowAllWorkflowGroups] = useState(false);
  const [showAllManualSessionCards, setShowAllManualSessionCards] = useState(false);
  const [sessionExpanded, setSessionExpanded] = useState(() => displayMode === 'all' || displayMode === 'sessions');
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [workflowActionDialogOpen, setWorkflowActionDialogOpen] = useState(false);
  const [sessionCreateError, setSessionCreateError] = useState('');
  const [actionMenu, setActionMenu] = useState<OverviewActionMenuState>({ isOpen: false, x: 0, y: 0 });
  const [isSessionSelectionMode, setSessionSelectionMode] = useState(false);
  const [selectedSessionKeys, setSelectedSessionKeys] = useState<Set<string>>(() => new Set());
  const [viewedSessionSignatures, setViewedSessionSignatures] = useState<Record<string, string | null>>({});
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const lastSelectedSessionKeyRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);
  const displayedSessions = showAllManualSessionCards
    ? visibleSessions
    : visibleSessions.slice(0, DEFAULT_VISIBLE_MANUAL_SESSION_CARDS);
  const hiddenManualSessionCardCount = Math.max(visibleSessions.length - displayedSessions.length, 0);
  const sessionActivityRefreshKey = useMemo(
    () => sessions
      .map((session) => [
        session.__provider,
        session.id,
        getSessionActivityTime(session),
      ].join(':'))
      .join('|'),
    [sessions],
  );

  useEffect(() => {
    setCurrentTime(new Date());
  }, [sessionActivityRefreshKey]);

  useEffect(() => {
    if (!actionMenu.isOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (actionMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setActionMenu((current) => (current.isOpen ? { isOpen: false, x: 0, y: 0 } : current));
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionMenu({ isOpen: false, x: 0, y: 0 });
      }
    };

    const handleScroll = () => {
      setActionMenu({ isOpen: false, x: 0, y: 0 });
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [actionMenu.isOpen]);

  useEffect(() => {
    /**
     * Refresh local read receipts for visible session cards after project data changes.
     */
    const nextSignatures: Record<string, string | null> = {};
    displayedSessions.forEach((session) => {
      const sessionProjectName = getSessionProjectName(project.name, session);
      const sessionKey = getViewedSessionKey(sessionProjectName, session);
      nextSignatures[sessionKey] = readViewedSessionSignature(sessionKey)
        || getSessionActivitySignature(session);
    });
    setViewedSessionSignatures(nextSignatures);
  }, [project.name, sessions, showHiddenItems, optimisticSessionUiState, showAllManualSessionCards]);

  useEffect(() => {
    /**
     * Drop selections that no longer exist after refresh, hide, or delete.
     */
    const availableKeys = new Set(sessionEntries.map((session) => getResolvedSessionSelectionKey(session, project.name)));
    setSelectedSessionKeys((current) => {
      const next = new Set([...current].filter((key) => availableKeys.has(key)));
      if (next.size === current.size && [...next].every((key) => current.has(key))) {
        return current;
      }
      return next;
    });
  }, [project.name, sessionEntries]);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const closeActionMenu = () => {
    setActionMenu({ isOpen: false, x: 0, y: 0 });
  };

  const openActionMenu = (nextState: OverviewActionMenuState) => {
    setActionMenu(nextState);
  };

  const bindLongPress = (nextState: OverviewActionMenuTarget) => ({
    onTouchStart: (event: React.TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = touch?.clientX ?? bounds.left + bounds.width / 2;
      const y = touch?.clientY ?? bounds.top + bounds.height / 2;

      clearLongPressTimer();
      longPressTimerRef.current = setTimeout(() => {
        suppressNextClickRef.current = true;
        openActionMenu({ ...nextState, isOpen: true, x, y });
        clearLongPressTimer();
      }, ITEM_ACTION_LONG_PRESS_MS);
    },
    onTouchEnd: clearLongPressTimer,
    onTouchCancel: clearLongPressTimer,
    onTouchMove: clearLongPressTimer,
  });

  const handleProtectedClick = (callback: () => void) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    callback();
  };

  const selectedSessions = sessionEntries.filter((session) => selectedSessionKeys.has(
    getResolvedSessionSelectionKey(session, project.name),
  ));
  const allVisibleSessionsSelected = displayedSessions.length > 0
    && displayedSessions.every((session) => selectedSessionKeys.has(getResolvedSessionSelectionKey(session, project.name)));
  const allSelectedSessionsFavorite = selectedSessions.length > 0
    && selectedSessions.every((session) => session.favorite === true);
  const allSelectedSessionsPending = selectedSessions.length > 0
    && selectedSessions.every((session) => session.pending === true);
  const allSelectedSessionsHidden = selectedSessions.length > 0
    && selectedSessions.every((session) => session.hidden === true);

  const enableSessionSelectionMode = () => {
    /**
     * Enter batch-selection mode without changing the current visible sessions.
     */
    setSessionSelectionMode(true);
    closeActionMenu();
  };

  const toggleSessionSelection = (
    session: ProjectSession & { __provider: SessionProvider },
    event?: React.MouseEvent<HTMLElement>,
  ) => {
    /**
     * Toggle one card or extend the selection range when Shift is held.
     */
    const sessionKey = getResolvedSessionSelectionKey(session, project.name);
    if (event?.shiftKey && lastSelectedSessionKeyRef.current) {
      const visibleKeys = displayedSessions.map((visibleSession) => getResolvedSessionSelectionKey(visibleSession, project.name));
      const anchorIndex = visibleKeys.indexOf(lastSelectedSessionKeyRef.current);
      const targetIndex = visibleKeys.indexOf(sessionKey);
      if (anchorIndex !== -1 && targetIndex !== -1) {
        const [startIndex, endIndex] = anchorIndex < targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex];
        setSelectedSessionKeys((current) => {
          const next = new Set(current);
          visibleKeys.slice(startIndex, endIndex + 1).forEach((key) => next.add(key));
          return next;
        });
        lastSelectedSessionKeyRef.current = sessionKey;
        return;
      }
    }

    setSelectedSessionKeys((current) => {
      const next = new Set(current);
      if (next.has(sessionKey)) {
        next.delete(sessionKey);
      } else {
        next.add(sessionKey);
      }
      return next;
    });
    lastSelectedSessionKeyRef.current = sessionKey;
  };

  const selectAllVisibleSessions = () => {
    /**
     * Select or clear every currently visible manual session card.
     */
    setSelectedSessionKeys((current) => {
      const next = new Set(current);
      if (allVisibleSessionsSelected) {
        displayedSessions.forEach((session) => next.delete(getResolvedSessionSelectionKey(session, project.name)));
      } else {
        displayedSessions.forEach((session) => next.add(getResolvedSessionSelectionKey(session, project.name)));
      }
      return next;
    });
  };

  const clearSelectedSessions = () => {
    /**
     * Reset the batch toolbar state.
     */
    setSelectedSessionKeys(new Set());
    lastSelectedSessionKeyRef.current = null;
  };

  const exitSessionSelectionMode = () => {
    /**
     * Leave batch-selection mode and restore normal card navigation.
     */
    clearSelectedSessions();
    setSessionSelectionMode(false);
  };

  const handleSessionCardClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    session: ProjectSession & { __provider: SessionProvider },
  ) => {
    /**
     * Route card clicks to either navigation or selection based on mode.
     */
    handleProtectedClick(() => {
      if (isSessionSelectionMode) {
        toggleSessionSelection(session, event);
        return;
      }

      const sessionProjectName = getSessionProjectName(project.name, session);
      const sessionKey = getViewedSessionKey(sessionProjectName, session);
      const activitySignature = getSessionActivitySignature(session);
      writeViewedSessionSignature(sessionKey, activitySignature);
      setViewedSessionSignatures((current) => ({
        ...current,
        [sessionKey]: activitySignature,
      }));
      onSelectSession(session);
    });
  };

  const handleCreateSession = async (provider: SessionProvider) => {
    /**
     * Ask the shared session launcher to create a manual draft after the user
     * picks the provider for the new conversation.
     */
    setSessionCreateError('');
    setProviderPickerOpen(false);
    const result = await Promise.resolve(onNewSession(project, provider, { promptForLabel: false }));
    if (result && result.ok === false) {
      setSessionCreateError(result.error);
      setProviderPickerOpen(true);
    }
  };

  const handleDeleteSession = async (
    sessionProjectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => {
    closeActionMenu();
    if (!window.confirm(`确定删除“${sessionTitle}”吗？此操作无法撤销。`)) {
      return;
    }

    try {
      const response = provider === 'codex'
        ? await api.deleteCodexSession(sessionId, project.fullPath || project.path || '')
        : await api.deleteSession(sessionProjectName, sessionId, provider);
      if (!response.ok) {
        return;
      }
      await window.refreshProjects?.();
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  };

  const handleBatchDeleteSessions = async () => {
    /**
     * Delete every selected manual session through the same provider-specific
     * endpoints used by the one-card context menu.
     */
    closeActionMenu();
    if (selectedSessions.length === 0) {
      return;
    }

    if (!window.confirm(`确定删除选中的 ${selectedSessions.length} 个会话吗？此操作无法撤销。`)) {
      return;
    }

    try {
      const responses = await Promise.all(selectedSessions.map((session) => (
        session.__provider === 'codex'
          ? api.deleteCodexSession(session.id, session.projectPath || project.fullPath || project.path || '')
          : api.deleteSession(session.__projectName || project.name, session.id, session.__provider)
      )));
      if (responses.every((response) => response.ok)) {
        clearSelectedSessions();
      }
      await window.refreshProjects?.();
    } catch (error) {
      console.error('Error deleting selected sessions:', error);
    }
  };

  /**
   * Rename a session summary/title without changing the underlying jsonl filename.
   */
  const handleRenameSession = async (
    sessionProjectName: string,
    sessionId: string,
    provider: SessionProvider,
    currentTitle: string,
  ) => {
    const nextTitle = window.prompt('请输入新的会话名称', currentTitle);
    if (nextTitle == null) {
      return;
    }

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle || trimmedTitle === currentTitle.trim()) {
      closeActionMenu();
      return;
    }

    const response = provider === 'codex'
      ? await api.renameCodexSession(sessionId, trimmedTitle, project.fullPath || project.path || '')
      : await api.renameSession(sessionProjectName, sessionId, trimmedTitle, project.fullPath || project.path || '');

    if (response.ok) {
      await window.refreshProjects?.();
    }
    closeActionMenu();
  };

  /**
   * Toggle a session between favorite and normal priority.
   */
  const handleToggleSessionFavorite = (
    sessionProjectName: string,
    sessionId: string,
    provider: SessionProvider,
    session: ProjectSession,
  ) => {
    const nextState = {
      provider,
      projectPath: projectConfigPath,
      favorite: session.favorite !== true,
      pending: session.pending === true,
      hidden: session.hidden === true,
    };
    setOptimisticSessionUiState((current) => ({
      ...current,
      [getSessionSelectionKey(session, project.name, provider)]: {
        favorite: nextState.favorite,
        pending: nextState.pending,
        hidden: nextState.hidden,
      },
      [getResolvedSessionSelectionKey(session, project.name)]: {
        favorite: nextState.favorite,
        pending: nextState.pending,
        hidden: nextState.hidden,
      },
    }));
    void api.updateSessionUiState(sessionProjectName, sessionId, nextState);
    closeActionMenu();
  };

  /**
   * Toggle a session's pending marker.
   */
  const handleToggleSessionPending = (
    sessionProjectName: string,
    sessionId: string,
    provider: SessionProvider,
    session: ProjectSession,
  ) => {
    const nextState = {
      provider,
      projectPath: projectConfigPath,
      favorite: session.favorite === true,
      pending: session.pending !== true,
      hidden: session.hidden === true,
    };
    setOptimisticSessionUiState((current) => ({
      ...current,
      [getSessionSelectionKey(session, project.name, provider)]: {
        favorite: nextState.favorite,
        pending: nextState.pending,
        hidden: nextState.hidden,
      },
      [getResolvedSessionSelectionKey(session, project.name)]: {
        favorite: nextState.favorite,
        pending: nextState.pending,
        hidden: nextState.hidden,
      },
    }));
    void api.updateSessionUiState(sessionProjectName, sessionId, nextState);
    closeActionMenu();
  };

  /**
   * Hide a session from both the homepage and sidebar lists.
   */
  const handleHideSession = (
    sessionProjectName: string,
    sessionId: string,
    provider: SessionProvider,
    session: ProjectSession,
  ) => {
    const nextState = {
      provider,
      projectPath: projectConfigPath,
      favorite: session.favorite === true,
      pending: session.pending === true,
      hidden: session.hidden !== true,
    };
    setOptimisticSessionUiState((current) => ({
      ...current,
      [getSessionSelectionKey(session, project.name, provider)]: {
        favorite: nextState.favorite,
        pending: nextState.pending,
        hidden: nextState.hidden,
      },
      [getResolvedSessionSelectionKey(session, project.name)]: {
        favorite: nextState.favorite,
        pending: nextState.pending,
        hidden: nextState.hidden,
      },
    }));
    void api.updateSessionUiState(sessionProjectName, sessionId, nextState);
    closeActionMenu();
  };

  const handleBatchUpdateSelectedSessions = async (
    nextState: Pick<ProjectSession, 'favorite' | 'pending' | 'hidden'>,
  ) => {
    /**
     * Apply one batch metadata operation to the selected manual sessions while
     * preserving any flags that are not part of this operation.
     */
    if (selectedSessions.length === 0) {
      return;
    }

    const optimisticUpdates = selectedSessions.flatMap((session) => ({
      keys: [
        getSessionSelectionKey(session, project.name),
        getResolvedSessionSelectionKey(session, project.name),
      ],
      state: {
        favorite: nextState.favorite ?? session.favorite === true,
        pending: nextState.pending ?? session.pending === true,
        hidden: nextState.hidden ?? session.hidden === true,
      },
    }));
    setOptimisticSessionUiState((current) => {
      const next = { ...current };
      optimisticUpdates.forEach(({ keys, state }) => {
        keys.forEach((key) => {
          next[key] = state;
        });
      });
      return next;
    });
    const writeUpdates = () => Promise.all(selectedSessions.map((session) => {
      const provider = normalizeActionSessionProvider(session.__provider);
      const sessionProjectName = getSessionProjectName(project.name, session);
      return api.updateSessionUiState(
        sessionProjectName,
        session.id,
        {
          provider,
          projectPath: projectConfigPath,
          favorite: nextState.favorite ?? session.favorite === true,
          pending: nextState.pending ?? session.pending === true,
          hidden: nextState.hidden ?? session.hidden === true,
        },
      );
    }));
    if (nextState.hidden !== undefined) {
      await writeUpdates();
      await window.refreshProjects?.();
    } else {
      window.setTimeout(() => {
        void writeUpdates();
      }, 1000);
    }
  };

  const activeWorkflowActionItem = actionMenu.isOpen && actionMenu.kind === 'workflow'
    ? workflows.find((workflow) => workflow.id === actionMenu.workflowId) || null
    : null;
  const activeSessionActionItem = actionMenu.isOpen && actionMenu.kind === 'session'
    ? sessionEntries.find((session) => (
      session.id === actionMenu.sessionId
      && session.__provider === actionMenu.sessionProvider
      && (session.__projectName || project.name) === actionMenu.sessionProjectName
    )) || null
    : null;
  const showWorkflowSection = displayMode === 'all' || displayMode === 'workflows';
  const showSessionSection = displayMode === 'all' || displayMode === 'sessions';
  const visibleBatchGroups = showAllWorkflowGroups
    ? batchGroups
    : batchGroups.slice(0, DEFAULT_VISIBLE_WORKFLOW_GROUPS);
  const hiddenWorkflowGroupCount = Math.max(0, batchGroups.length - visibleBatchGroups.length);

  return (
    <div data-testid="project-workspace-overview" className="h-full min-h-0 overflow-y-auto">
      <div className="flex w-full min-w-0 flex-col p-3 sm:p-4 md:p-6">
        {showWorkflowSection && (
        <ProjectOverviewWorkflowGroups>
        <section
          data-testid="project-overview-workflows"
          className={showSessionSection ? 'w-full pb-6' : 'w-full'}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              className="flex items-center gap-2 text-left"
              onClick={() => setWorkflowExpanded((value) => !value)}
            >
              {workflowExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <div>
                <h3 className="text-base font-semibold text-foreground">自动工作流</h3>
                <p className="text-sm text-muted-foreground">{workflows.length} 条需求正在跟进</p>
              </div>
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={workflowSortMode}
                onChange={(event) => setWorkflowSortMode(event.target.value as WorkflowCardSortMode)}
                className="h-9 min-w-[9.5rem] rounded-md border border-input bg-transparent py-1 pl-3 pr-10 text-sm text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                aria-label="工作流排序"
              >
                {CARD_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {hiddenSessionCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => setShowHiddenItems((current) => !current)}
                >
                  {showHiddenItems ? '收起已隐藏项' : `显示已隐藏项 (${hiddenSessionCount})`}
                </Button>
              )}
              <Button variant="outline" className="h-9 gap-2 self-start" onClick={() => setWorkflowActionDialogOpen(true)}>
                工作流操作
              </Button>
            </div>
          </div>
          <ProjectOverviewActions>
            <WorkflowActionDialog
              project={project}
              isOpen={workflowActionDialogOpen}
              onClose={() => setWorkflowActionDialogOpen(false)}
              onNewSession={onNewSession}
              onRefresh={() => window.refreshProjects?.()}
              navigateTo={navigate}
            />
          </ProjectOverviewActions>
          {workflowExpanded && (
            <div className="mt-4 space-y-4">
              {batchGroups.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  暂无自动工作流
                </div>
              ) : (
                <>
                  {visibleBatchGroups.map((group, index) => (
                    <BatchWorkflowGroup
                      key={group.id}
                      group={group}
                      isLatest={index === 0}
                      project={project}
                      selectedWorkflow={selectedWorkflow}
                      currentTime={currentTime}
                      t={t}
                      onSelectWorkflow={onSelectWorkflow}
                      onOpenActionMenu={(state) => openActionMenu(state)}
                      bindLongPress={bindLongPress}
                      handleProtectedClick={handleProtectedClick}
                    />
                  ))}
                  {hiddenWorkflowGroupCount > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 w-full border border-dashed border-border/70"
                      onClick={() => setShowAllWorkflowGroups(true)}
                    >
                      查看历史工作流批次 ({hiddenWorkflowGroupCount})
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </section>
        </ProjectOverviewWorkflowGroups>
        )}

        {showSessionSection && (
        <ProjectOverviewSessionCards>
        <section
          data-testid="project-overview-manual-sessions"
          className={showWorkflowSection ? 'w-full border-t border-border/60 pt-6' : 'w-full'}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              className="flex items-center gap-2 text-left"
              onClick={() => setSessionExpanded((value) => !value)}
            >
              {sessionExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <div>
                <h3 className="text-base font-semibold text-foreground">手动会话</h3>
                <p className="text-sm text-muted-foreground">{visibleSessions.length} 个可直接进入的会话</p>
              </div>
            </button>
            <div className="flex flex-col items-start gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={sessionSortMode}
                  onChange={(event) => setSessionSortMode(event.target.value as SessionCardSortMode)}
                  className="h-9 min-w-[9.5rem] rounded-md border border-input bg-transparent py-1 pl-3 pr-10 text-sm text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                  aria-label="手动会话排序"
                >
                  {CARD_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <Button
                  className="h-9 gap-2 self-start"
                  onClick={() => {
                    setSessionCreateError('');
                    setProviderPickerOpen((value) => !value);
                  }}
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  {t('sessions.newSession')}
                </Button>
                <Button
                  type="button"
                  variant={isSessionSelectionMode ? 'secondary' : 'outline'}
                  className="h-9"
                  data-testid="project-overview-session-selection-toggle"
                  onClick={isSessionSelectionMode ? exitSessionSelectionMode : enableSessionSelectionMode}
                >
                  {isSessionSelectionMode ? '退出选择' : '多选'}
                </Button>
              </div>
              {providerPickerOpen && (
                <div
                  data-testid="project-new-session-provider-picker"
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-2"
                >
                  <span className="text-xs text-muted-foreground">选择会话提供方</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="project-new-session-provider-codex"
                    onClick={() => handleCreateSession('codex')}
                  >
                    Codex
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="project-new-session-provider-pi"
                    onClick={() => handleCreateSession('pi')}
                  >
                    Pi
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setProviderPickerOpen(false)}
                  >
                    取消
                  </Button>
                </div>
              )}
              {sessionCreateError && (
                <div
                  data-testid="project-new-session-error"
                  className="max-w-xl rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive break-words"
                >
                  {sessionCreateError}
                </div>
              )}
            </div>
          </div>
          {sessionExpanded && (
            <div className="mt-4 space-y-3">
              {isSessionSelectionMode && displayedSessions.length > 0 && (
                <div
                  data-testid="project-overview-session-bulk-toolbar"
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-sm"
                >
                  <label className="flex items-center gap-2 text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={allVisibleSessionsSelected}
                      onChange={selectAllVisibleSessions}
                    />
                    全选可见
                  </label>
                  <span className="text-muted-foreground">已选 {selectedSessions.length} 个</span>
                  {selectedSessions.length > 0 && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        data-testid="project-overview-bulk-favorite"
                        onClick={() => void handleBatchUpdateSelectedSessions({
                          favorite: !allSelectedSessionsFavorite,
                        })}
                      >
                        {allSelectedSessionsFavorite ? '取消收藏' : '收藏'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        data-testid="project-overview-bulk-pending"
                        onClick={() => void handleBatchUpdateSelectedSessions({
                          pending: !allSelectedSessionsPending,
                        })}
                      >
                        {allSelectedSessionsPending ? '取消待处理' : '待办'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        data-testid="project-overview-bulk-hide"
                        onClick={() => void handleBatchUpdateSelectedSessions({
                          hidden: !allSelectedSessionsHidden,
                        })}
                      >
                        {allSelectedSessionsHidden ? '取消隐藏' : '隐藏'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        data-testid="project-overview-bulk-delete"
                        onClick={() => void handleBatchDeleteSessions()}
                      >
                        删除
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        data-testid="project-overview-bulk-clear"
                        onClick={exitSessionSelectionMode}
                      >
                        <X className="h-4 w-4" />
                        退出
                      </Button>
                    </>
                  )}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                {visibleSessions.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground sm:col-span-2 lg:col-span-4 xl:col-span-5">
                    {t('sessions.noSessions')}
                  </div>
                ) : (
                  displayedSessions.map((session) => {
                    const sessionView = createSessionViewModel(session, currentTime, t);
                    const sessionCardTitle = getManualSessionCardTitle(sessionView.sessionName);
                    const isSelected = selectedSession?.id === session.id;
                    const isBatchSelected = selectedSessionKeys.has(getResolvedSessionSelectionKey(session, project.name));
                    const sessionProjectName = session.__projectName || project.name;
                    const activityProjectName = getSessionProjectName(project.name, session);
                    const activitySessionKey = getViewedSessionKey(activityProjectName, session);
                    const activitySignature = getSessionActivitySignature(session);
                    const hasUnreadActivity = hasUnreadSessionActivity({
                      isSelected,
                      viewedSignature: viewedSessionSignatures[activitySessionKey] ?? null,
                      activitySignature,
                    });
                    const sessionActionState: OverviewActionMenuTarget = {
                      kind: 'session',
                      sessionId: session.id,
                      sessionTitle: sessionCardTitle,
                      sessionProvider: session.__provider,
                      sessionProjectName,
                    };
                    return (
                      <div
                        key={`${session.__provider}-${session.id}`}
                        className={[
                          'relative min-w-0 rounded-md border transition-colors',
                          isSelected || isBatchSelected ? 'border-primary bg-primary/10' : 'border-border/50 bg-background hover:bg-accent/40',
                          session.hidden === true ? 'opacity-60' : '',
                        ].join(' ')}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          openActionMenu({
                            isOpen: true,
                            ...sessionActionState,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                        {...bindLongPress(sessionActionState)}
                      >
                        {isSessionSelectionMode && (
                          <span
                            className={[
                              'absolute left-3 top-3 z-10 flex h-4 w-4 items-center justify-center rounded border text-[10px]',
                              isBatchSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background',
                            ].join(' ')}
                            aria-hidden="true"
                          >
                            {isBatchSelected ? '✓' : ''}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-pressed={isSessionSelectionMode ? isBatchSelected : undefined}
                          data-testid="project-overview-session-card"
                          data-provider={session.__provider}
                          className={[
                            'flex h-full w-full min-w-0 flex-col items-start gap-1.5 px-3 py-2.5 text-left',
                            isSessionSelectionMode ? 'pl-10' : '',
                          ].join(' ')}
                          onClick={(event) => handleSessionCardClick(event, session)}
                        >
                          <span className="w-full min-w-0 truncate text-sm font-medium text-foreground">
                            {sessionCardTitle}
                          </span>
                          <div className="flex w-full min-w-0 items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
                            {hasUnreadActivity && (
                              <span
                                className="inline-flex h-2 w-2 shrink-0 rounded-full bg-yellow-400 shadow-sm"
                                title="有未读新消息"
                              />
                            )}
                            {(() => {
                              const routeNumber = getSessionRouteNumber(session);
                              return routeNumber ? (
                                <span className="shrink-0 font-medium text-muted-foreground">
                                  #{routeNumber}
                                </span>
                              ) : null;
                            })()}
                            <span className="min-w-0 truncate">
                              {sessionView.sessionTime
                                ? formatTimeAgo(sessionView.sessionTime, currentTime, t)
                                : '未知时间'}
                            </span>
                            <SessionProviderLogo
                              provider={session.__provider}
                              model={session.model || null}
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            />
                            {session.favorite === true && (
                              <Star className="h-3 w-3 shrink-0 fill-current text-yellow-500" />
                            )}
                            {session.pending === true && (
                              <Clock className="h-3 w-3 shrink-0 text-amber-500" />
                            )}
                          </div>
                      </button>
                    </div>
                  );
                })
                )}
              </div>
              {hiddenManualSessionCardCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full border border-dashed border-border/70"
                  onClick={() => setShowAllManualSessionCards(true)}
                >
                  显示更多手动会话 ({hiddenManualSessionCardCount})
                </Button>
              )}
              {showAllManualSessionCards && visibleSessions.length > DEFAULT_VISIBLE_MANUAL_SESSION_CARDS && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full border border-dashed border-border/70"
                  onClick={() => setShowAllManualSessionCards(false)}
                >
                  收起手动会话
                </Button>
              )}
            </div>
          )}
        </section>
        </ProjectOverviewSessionCards>
        )}

        {actionMenu.isOpen && actionMenu.kind === 'session' && activeSessionActionItem && (
          <SessionActionIconMenu
            ref={actionMenuRef}
            style={{ left: actionMenu.x, top: actionMenu.y }}
            isFavorite={activeSessionActionItem.favorite === true}
            isPending={activeSessionActionItem.pending === true}
            isHidden={activeSessionActionItem.hidden === true}
            labels={{
              rename: '改名',
              favorite: '收藏',
              unfavorite: '取消收藏',
              pending: '待办',
              unpending: '取消待处理',
              hide: '隐藏',
              unhide: '取消隐藏',
              delete: '删除',
            }}
            testIds={{
              rename: 'project-overview-context-rename',
              favorite: 'project-overview-context-favorite',
              pending: 'project-overview-context-pending',
              hide: 'project-overview-context-hide',
              delete: 'project-overview-context-delete',
            }}
            onRename={() => {
              const actionProvider = normalizeActionSessionProvider(activeSessionActionItem.__provider);
              void handleRenameSession(
                activeSessionActionItem.__projectName || project.name,
                activeSessionActionItem.id,
                actionProvider,
                createSessionViewModel(activeSessionActionItem, currentTime, t).sessionName,
              );
            }}
            onToggleFavorite={() => {
              const actionProvider = normalizeActionSessionProvider(activeSessionActionItem.__provider);
              handleToggleSessionFavorite(
                activeSessionActionItem.__projectName || project.name,
                activeSessionActionItem.id,
                actionProvider,
                activeSessionActionItem,
              );
            }}
            onTogglePending={() => {
              const actionProvider = normalizeActionSessionProvider(activeSessionActionItem.__provider);
              handleToggleSessionPending(
                activeSessionActionItem.__projectName || project.name,
                activeSessionActionItem.id,
                actionProvider,
                activeSessionActionItem,
              );
            }}
            onToggleHidden={() => {
              const actionProvider = normalizeActionSessionProvider(activeSessionActionItem.__provider);
              handleHideSession(
                activeSessionActionItem.__projectName || project.name,
                activeSessionActionItem.id,
                actionProvider,
                activeSessionActionItem,
              );
            }}
            onDelete={() => void handleDeleteSession(
              actionMenu.sessionProjectName,
              actionMenu.sessionId,
              actionMenu.sessionTitle,
              actionMenu.sessionProvider,
            )}
          />
        )}

        {actionMenu.isOpen && actionMenu.kind === 'workflow' && activeWorkflowActionItem && (
          <div
            ref={actionMenuRef}
            className="fixed z-[80] min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-lg"
            style={{ left: actionMenu.x, top: actionMenu.y }}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onSelectWorkflow(project, activeWorkflowActionItem);
                closeActionMenu();
              }}
            >
              <ChevronRight className="h-4 w-4" />
              打开详情
            </button>
          </div>
        )}

        <section className="mt-6 border-t border-dashed border-border/60 pt-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            先从右侧列表进入会话或需求，再继续对应页面操作。
          </div>
        </section>
      </div>
    </div>
  );
}
