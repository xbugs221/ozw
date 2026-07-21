/**
 * PURPOSE: Render the current project's workspace navigation with fixed
 * workflow/session grouping and project-scoped item actions.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
const Clock = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>;
const Edit3 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>;
const Eye = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const MessageSquare = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
const Star = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26 12,2"/></svg>;
const Trash2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
const Workflow = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="8.5" y="14" width="7" height="7" rx="1"/><path d="M6.5 10v2a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2"/></svg>;
import { useTranslation } from 'react-i18next';
import type { Project, ProjectSession, ProjectWorkflow, SessionProvider } from '../../types/app';
import { api } from '../../utils/api';
import { formatTimeAgo } from '../../utils/dateUtils';
import { createSessionViewModel, getAllSessions, sortSessions } from '../sidebar/utils/utils';
import type { SessionWithProvider } from '../sidebar/types/types';
import { buildProjectRoute } from '../../utils/projectRoute';
import { isWorkflowOwnedSession } from '../../utils/workflowSessions';
import { getSessionRouteNumber } from '../../utils/sessionCardDisplay';
import type { NewSessionHandler } from '../main-content/types/types';
import { useResizableWidth } from '../../hooks/useResizableWidth';
import WorkflowActionDialog from '../workflow/WorkflowActionDialog';
import { isWorkflowCompleted } from '../../utils/workflowGroups';
import SessionProviderLogo from '../llm-logo-provider/SessionProviderLogo';

type ProjectWorkspaceNavProps = {
  project: Project;
  selectedSession: ProjectSession | null;
  selectedWorkflow: ProjectWorkflow | null;
  onSessionSelect: (session: ProjectSession) => void;
  onWorkflowSelect: (project: Project, workflow: ProjectWorkflow) => void;
  onNewSession: NewSessionHandler;
  onRefresh: () => Promise<void> | void;
};

type ActionMenuState =
  | { isOpen: false; x: number; y: number }
  | {
    isOpen: true;
    x: number;
    y: number;
    kind: 'workflow';
    workflowId: string;
  }
  | {
    isOpen: true;
    x: number;
    y: number;
    kind: 'session';
    sessionId: string;
    provider: SessionProvider;
    projectName: string;
  };

function comparePriority(
  left: { favorite?: boolean; pending?: boolean },
  right: { favorite?: boolean; pending?: boolean },
): number {
  const leftFavorite = left.favorite === true ? 1 : 0;
  const rightFavorite = right.favorite === true ? 1 : 0;
  if (leftFavorite !== rightFavorite) {
    return rightFavorite - leftFavorite;
  }

  const leftPending = left.pending === true ? 1 : 0;
  const rightPending = right.pending === true ? 1 : 0;
  if (leftPending !== rightPending) {
    return rightPending - leftPending;
  }

  return 0;
}

export default function ProjectWorkspaceNav({
  project,
  selectedSession,
  selectedWorkflow,
  onSessionSelect,
  onWorkflowSelect,
  onNewSession,
  onRefresh,
}: ProjectWorkspaceNavProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const navigate = useNavigate();
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [actionMenu, setActionMenu] = useState<ActionMenuState>({ isOpen: false, x: 0, y: 0 });
  const [manualSessionTitleWrapped, setManualSessionTitleWrapped] = useState(false);
  const [workflowActionDialogOpen, setWorkflowActionDialogOpen] = useState(false);
  /**
   * PURPOSE: Let users resize dense workflow/session navigation without
   * affecting the global project sidebar width.
   */
  const { width, resizeHandleProps } = useResizableWidth({
    storageKey: 'ozw:project-workspace-nav-width',
    defaultWidth: 288,
    minWidth: 224,
    maxWidth: 520,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!actionMenu.isOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (actionMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setActionMenu({ isOpen: false, x: 0, y: 0 });
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionMenu({ isOpen: false, x: 0, y: 0 });
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [actionMenu]);

  const workflows = useMemo(() => (
    [...(project.workflows || [])]
      .sort((left, right) => {
        return new Date(String(right.updatedAt || 0)).getTime() - new Date(String(left.updatedAt || 0)).getTime();
      })
  ), [project.workflows]);
  const activeWorkflows = useMemo(() => workflows.filter((workflow) => !isWorkflowCompleted(workflow)), [workflows]);

  const sessions = useMemo(() => sortSessions(
    getAllSessions(project, {})
      .filter((session) => {
        if (session.hidden === true) {
          return false;
        }
        const isCurrentWorkflowChildSession = selectedSession?.id === session.id && (
          Boolean(selectedSession?.workflowId)
          || Boolean((selectedWorkflow?.childSessions || []).some((childSession) => childSession.id === session.id))
        );
        if (isCurrentWorkflowChildSession) {
          return false;
        }
        return !isWorkflowOwnedSession(project, session);
      }),
    (session) => ({
      favorite: session.favorite === true,
      pending: session.pending === true,
      hidden: session.hidden === true,
    }),
    project.name,
  ), [project, selectedSession?.id, selectedSession?.workflowId, selectedWorkflow?.childSessions]);

  const activeWorkflow = actionMenu.isOpen && actionMenu.kind === 'workflow'
    ? activeWorkflows.find((workflow) => workflow.id === actionMenu.workflowId) || null
    : null;
  const activeSession = actionMenu.isOpen && actionMenu.kind === 'session'
    ? sessions.find((session) => (
      session.id === actionMenu.sessionId
      && session.__provider === actionMenu.provider
      && (session.__projectName || project.name) === actionMenu.projectName
    )) || null
    : null;

  const closeActionMenu = () => setActionMenu({ isOpen: false, x: 0, y: 0 });

  const refreshProject = async () => {
    await onRefresh();
    closeActionMenu();
  };

  /**
   * PURPOSE: Create a new manual session from the workspace sidebar.
   */
  const handleCreateManualSession = () => {
    onNewSession(project, 'codex');
  };

  const handleRenameSession = async (session: SessionWithProvider) => {
    const currentTitle = createSessionViewModel(session, currentTime, t).sessionName;
    const nextTitle = window.prompt('请输入新的会话名称', currentTitle);
    if (nextTitle == null) {
      closeActionMenu();
      return;
    }

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle || trimmedTitle === currentTitle.trim()) {
      closeActionMenu();
      return;
    }

    if (session.__provider === 'codex') {
      await api.renameCodexSession(session.id, trimmedTitle);
    } else {
      await api.renameSession(session.__projectName || project.name, session.id, trimmedTitle);
    }
    await refreshProject();
  };

  const handleDeleteSession = async (session: SessionWithProvider) => {
    const sessionTitle = createSessionViewModel(session, currentTime, t).sessionName;
    if (!window.confirm(`确定删除“${sessionTitle}”吗？此操作无法撤销。`)) {
      closeActionMenu();
      return;
    }
    if (session.__provider === 'codex') {
      await api.deleteCodexSession(session.id, session.projectPath || project.fullPath || project.path || '');
    } else {
      await api.deleteSession(session.__projectName || project.name, session.id, session.__provider);
    }
    await refreshProject();
  };

  const handleToggleSessionFavorite = async (session: SessionWithProvider) => {
    await api.updateSessionUiState(session.__projectName || project.name, session.id, {
      provider: session.__provider,
      favorite: session.favorite !== true,
      pending: session.pending === true,
      hidden: session.hidden === true,
    });
    await refreshProject();
  };

  const handleToggleSessionPending = async (session: SessionWithProvider) => {
    await api.updateSessionUiState(session.__projectName || project.name, session.id, {
      provider: session.__provider,
      favorite: session.favorite === true,
      pending: session.pending !== true,
      pendingExplicit: true,
      hidden: session.hidden === true,
    });
    await refreshProject();
  };

  return (
    <div
      data-testid="project-workspace-nav"
      className="relative flex h-full flex-shrink-0 flex-col border-r border-border/60 bg-background"
      style={{ width }}
    >
      <div className="border-b border-border/60 px-4 py-4">
        <button
          type="button"
          data-testid="project-workspace-home-link"
          className="max-w-full truncate text-left text-xl font-semibold leading-tight text-foreground transition-colors hover:text-primary"
          onClick={() => navigate(buildProjectRoute(project))}
        >
          {project.displayName}
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {activeWorkflows.length > 0 && (
          <section data-testid="project-workspace-workflows-group" className="space-y-2">
            <div className="flex items-center justify-between gap-3 px-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Workflow className="h-3.5 w-3.5" />
                <span>需求工作流</span>
              </div>
              <button
                type="button"
                data-testid="project-workspace-new-workflow"
                className="rounded-md border border-border/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setWorkflowActionDialogOpen(true)}
              >
                操作
              </button>
            </div>
            <WorkflowActionDialog
              project={project}
              isOpen={workflowActionDialogOpen}
              onClose={() => setWorkflowActionDialogOpen(false)}
              onNewSession={onNewSession}
              onRefresh={onRefresh}
              navigateTo={navigate}
            />
            {activeWorkflows.map((workflow) => {
              const isSelected = selectedWorkflow?.id === workflow.id;
              return (
                <div
                  key={workflow.id}
                  className={[
                    'rounded-md border',
                    isSelected ? 'border-primary bg-primary/10' : 'border-border/50 bg-card',
                  ].join(' ')}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setActionMenu({
                      isOpen: true,
                      x: event.clientX,
                      y: event.clientY,
                      kind: 'workflow',
                      workflowId: workflow.id,
                    });
                  }}
                >
                  <button
                    type="button"
                    className="flex w-full items-start px-3 py-3 text-left"
                    onClick={() => onWorkflowSelect(project, workflow)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{workflow.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{workflow.stage}</span>
                        <span
                          className="inline-flex h-2 w-2 rounded-full bg-amber-500"
                          title="工作流进行中"
                        />
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </section>
        )}

        <section data-testid="project-workspace-manual-sessions-group" className="space-y-2">
          <div className="flex items-center justify-between gap-3 px-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" />
                <span>手动会话</span>
              </div>
              <button
                type="button"
                data-testid="project-workspace-new-session"
                className="rounded-md border border-border/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={handleCreateManualSession}
              >
                新建
              </button>
            </div>
            <button
              type="button"
              className={[
                'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
                manualSessionTitleWrapped
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground',
              ].join(' ')}
              onClick={() => setManualSessionTitleWrapped((wrapped) => !wrapped)}
            >
              Wrap
            </button>
          </div>
          {sessions.map((session) => {
            const view = createSessionViewModel(session, currentTime, t);
            const isSelected = selectedSession?.id === session.id;
            return (
              <div
                key={`${session.__provider}-${session.id}`}
                className={[
                  'rounded-md border',
                  isSelected ? 'border-primary bg-primary/10' : 'border-border/50 bg-card',
                ].join(' ')}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setActionMenu({
                    isOpen: true,
                    x: event.clientX,
                    y: event.clientY,
                    kind: 'session',
                    sessionId: session.id,
                    provider: session.__provider,
                    projectName: session.__projectName || project.name,
                  });
                }}
              >
                <button
                  type="button"
                  className="flex w-full items-start px-2.5 py-2 text-left"
                  onClick={() => onSessionSelect(session)}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className={[
                        'text-sm font-medium text-foreground',
                        manualSessionTitleWrapped ? 'break-words whitespace-normal leading-snug' : 'truncate',
                      ].join(' ')}
                    >
                      {view.sessionName}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
                      {(() => {
                        const routeNumber = getSessionRouteNumber(session);
                        return routeNumber ? <span className="shrink-0 font-medium">#{routeNumber}</span> : null;
                      })()}
                      <span className="min-w-0 truncate">
                        {view.sessionTime ? formatTimeAgo(view.sessionTime, currentTime, t) : '未知时间'}
                      </span>
                      <SessionProviderLogo
                        provider={session.__provider}
                        model={session.model || null}
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      />
                      {session.favorite === true && <Star className="h-3 w-3 fill-current text-yellow-500" />}
                      {session.pending === true && <Clock className="h-3 w-3 text-amber-500" />}
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </section>
      </div>

      {actionMenu.isOpen && (
        <div
          ref={actionMenuRef}
          className="fixed z-[80] min-w-[170px] rounded-md border border-border bg-popover p-1 shadow-lg"
          style={{ left: actionMenu.x, top: actionMenu.y }}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
            onClick={() => {
              if (activeWorkflow) {
                onWorkflowSelect(project, activeWorkflow);
                closeActionMenu();
                return;
              }
              if (activeSession) {
                void handleRenameSession(activeSession);
              }
            }}
          >
            <Edit3 className="h-4 w-4" />
            {activeWorkflow ? '打开详情' : '改名'}
          </button>
          {!activeWorkflow && (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  if (activeSession) {
                    void handleToggleSessionFavorite(activeSession);
                  }
                }}
              >
                <Star className="h-4 w-4" />
                {activeSession?.favorite === true ? '取消收藏' : '收藏'}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  if (activeSession) {
                    void handleToggleSessionPending(activeSession);
                  }
                }}
              >
                <Clock className="h-4 w-4" />
                {activeSession?.pending === true ? '取消待处理' : '待办'}
              </button>
            </>
          )}
          {!activeWorkflow && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              onClick={() => {
                if (activeSession) {
                  void handleDeleteSession(activeSession);
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
              删除
            </button>
          )}
          {activeWorkflow && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onWorkflowSelect(project, activeWorkflow);
                closeActionMenu();
              }}
            >
              <Eye className="h-4 w-4" />
              打开详情
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        className="absolute inset-y-0 right-[-3px] z-10 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 focus-visible:bg-primary/50 focus-visible:outline-none"
        aria-label="调整左侧导航宽度"
        {...resizeHandleProps}
      />
    </div>
  );
}
