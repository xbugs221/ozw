/**
 * PURPOSE: Provide one project-scoped workflow action dialog for adopting
 * active oz changes, starting oz flow runs, and opening ordinary planning sessions.
 */
import { useEffect, useMemo, useState } from 'react';
const Check = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>;
const Loader2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4 animate-spin"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>;
const MessageSquarePlus = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>;
const RefreshCw = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
const Square = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>;
const X = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
import type { Project, ProjectWorkflow } from '../../types/app';
import { api } from '../../utils/api';
import { buildProjectWorkflowRoute } from '../../utils/projectRoute';
import type { NewSessionHandler } from '../main-content/types/types';

type WorkflowActionDialogProps = {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
  onNewSession: NewSessionHandler;
  onRefresh: () => Promise<void> | void;
  onWorkflowStarted?: (workflow: ProjectWorkflow) => void;
  navigateTo: (path: string) => void;
};

type LaunchStatus = 'waiting' | 'starting' | 'started' | 'failed';

type LaunchResult = {
  changeName: string;
  status: LaunchStatus;
  workflow?: ProjectWorkflow;
  error?: string;
};

const STATUS_LABELS: Record<LaunchStatus, string> = {
  waiting: '等待',
  starting: '启动中',
  started: '已启动',
  failed: '失败',
};

const PLANNING_PROMPT = [
  '请帮我规划一个新的 oz change。',
  '',
  '先讨论问题、范围、非目标和测试策略，等我确认后再创建 docs/changes/<change-name>/ 下的 proposal.md、design.md、spec.md、task.md 和 tests/。',
  '不要启动 oz flow run，不要创建运行态目录。',
].join('\n');

/**
 * Build a short user-facing error from a failed workflow creation response.
 */
async function readWorkflowCreateError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    return String(payload?.error || payload?.message || `HTTP ${response.status}`);
  } catch {
    return `HTTP ${response.status}`;
  }
}

export default function WorkflowActionDialog({
  project,
  isOpen,
  onClose,
  onNewSession,
  onRefresh,
  onWorkflowStarted,
  navigateTo,
}: WorkflowActionDialogProps) {
  const [changes, setChanges] = useState<string[]>([]);
  const [selectedChanges, setSelectedChanges] = useState<Set<string>>(() => new Set());
  const [results, setResults] = useState<LaunchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState('');

  const selectedCount = selectedChanges.size;
  const allSelected = changes.length > 0 && changes.every((changeName) => selectedChanges.has(changeName));

  const resultMap = useMemo(() => new Map(results.map((result) => [result.changeName, result])), [results]);

  const loadChanges = async () => {
    /**
     * Refresh adoptable changes after opening the dialog or finishing runs so
     * already-bound changes disappear from the startable list.
     */
    setIsLoading(true);
    setError('');
    try {
      const response = await api.projectOpenSpecChanges(project.name, project.fullPath || project.path);
      const payload = response.ok ? await response.json() : { changes: [] };
      const nextChanges = Array.isArray(payload?.changes) ? payload.changes.map(String) : [];
      setChanges(nextChanges);
      setSelectedChanges((current) => new Set([...current].filter((changeName) => nextChanges.includes(changeName))));
    } catch (loadError) {
      console.error('Error loading adoptable oz changes:', loadError);
      setChanges([]);
      setSelectedChanges(new Set());
      setError('无法读取可接手的 oz change。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setResults([]);
    setSelectedChanges(new Set());
    void loadChanges();
  }, [isOpen, project.name]);

  const toggleChange = (changeName: string) => {
    /**
     * Keep selection local to the currently adoptable list.
     */
    setSelectedChanges((current) => {
      const next = new Set(current);
      if (next.has(changeName)) {
        next.delete(changeName);
      } else {
        next.add(changeName);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedChanges(allSelected ? new Set() : new Set(changes));
  };

  const startSelectedWorkflows = async () => {
    /**
     * Start each selected change with the existing single-workflow endpoint so
     * each change keeps an independent success or failure state.
     */
    const targets = [...selectedChanges];
    if (targets.length === 0) {
      setError('请先选择至少一个 active change。');
      return;
    }

    setIsStarting(true);
    setError('');
    setResults(targets.map((changeName) => ({ changeName, status: 'waiting' })));

    const startedWorkflows: ProjectWorkflow[] = [];
    for (const changeName of targets) {
      setResults((current) => current.map((result) => (
        result.changeName === changeName ? { ...result, status: 'starting', error: undefined } : result
      )));

      try {
        const response = await api.createProjectWorkflow(
          project.name,
          { openspecChangeName: changeName },
          project.fullPath || project.path || '',
        );
        if (!response.ok) {
          throw new Error(await readWorkflowCreateError(response));
        }
        const workflow = await response.json();
        startedWorkflows.push(workflow);
        onWorkflowStarted?.(workflow);
        setResults((current) => current.map((result) => (
          result.changeName === changeName ? { ...result, status: 'started', workflow } : result
        )));
      } catch (startError) {
        console.error('Error starting workflow for oz change:', changeName, startError);
        setResults((current) => current.map((result) => (
          result.changeName === changeName
            ? { ...result, status: 'failed', error: startError instanceof Error ? startError.message : '启动失败' }
            : result
        )));
      }
    }

    await onRefresh();
    await loadChanges();
    setIsStarting(false);

    if (targets.length === 1 && startedWorkflows.length === 1) {
      onClose();
      navigateTo(buildProjectWorkflowRoute(project, startedWorkflows[0]));
    }
  };

  const startPlanningSession = async () => {
    /**
     * Open a regular Codex session with a planning prompt draft; this path does
     * not call the workflow creation API and therefore cannot start oz flow.
     */
    const result = await Promise.resolve(onNewSession(project, 'codex', {
      sessionSummary: '新规划：oz change',
      initialPrompt: PLANNING_PROMPT,
    }));
    if (result && result.ok === false) {
      setError(result.error);
      return;
    }
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="工作流操作">
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col rounded-md border border-border bg-background shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">工作流操作</h2>
            <p className="mt-1 text-sm text-muted-foreground">选择 active oz change 后启动对应 oz flow run，或先发起新的规划会话。</p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
            disabled={isStarting}
            aria-label="关闭工作流操作"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-foreground">可接手 active changes</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>已选 {selectedCount}</span>
              <button type="button" className="rounded-md border border-border px-2 py-1 hover:bg-accent" onClick={toggleAll} disabled={isLoading || isStarting || changes.length === 0}>
                {allSelected ? '取消全选' : '全选'}
              </button>
              <button type="button" className="rounded-md border border-border p-1 hover:bg-accent" onClick={() => void loadChanges()} disabled={isLoading || isStarting} aria-label="刷新 active changes">
                <RefreshCw className={['h-3.5 w-3.5', isLoading ? 'animate-spin' : ''].join(' ')} />
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">正在读取 active changes...</div>
          ) : changes.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              暂无可接手的 active oz change。
            </div>
          ) : (
            <div className="grid gap-2">
              {changes.map((changeName) => {
                const selected = selectedChanges.has(changeName);
                const result = resultMap.get(changeName);
                return (
                  <button
                    key={changeName}
                    type="button"
                    className={[
                      'flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      selected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-accent',
                    ].join(' ')}
                    onClick={() => toggleChange(changeName)}
                    disabled={isStarting}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{changeName}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {result ? STATUS_LABELS[result.status] : '等待'}
                      {selected ? <Check className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-2 rounded-md border border-border/60 p-3" data-testid="workflow-launch-results">
              <div className="text-sm font-medium text-foreground">启动结果</div>
              {results.map((result) => (
                <div key={result.changeName} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-foreground">{result.changeName}</span>
                    <span className="ml-2 text-muted-foreground">{STATUS_LABELS[result.status]}</span>
                    {result.error && <span className="ml-2 text-destructive">{result.error}</span>}
                  </div>
                  {result.workflow && (
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                      onClick={() => {
                        onClose();
                        navigateTo(buildProjectWorkflowRoute(project, result.workflow as ProjectWorkflow));
                      }}
                    >
                      进入详情
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-5 py-4">
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-accent"
            onClick={() => void startPlanningSession()}
            disabled={isStarting}
          >
            <MessageSquarePlus className="h-4 w-4" />
            发起新的规划
          </button>
          <div className="flex items-center gap-2">
            <button type="button" className="h-9 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent" onClick={onClose} disabled={isStarting}>
              取消
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              onClick={() => void startSelectedWorkflows()}
              disabled={isStarting || selectedCount === 0}
            >
              {isStarting && <Loader2 className="h-4 w-4 animate-spin" />}
              启动选中工作流
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
