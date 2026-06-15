/**
 * PURPOSE: Render workflow runner process rows separately from the detail page
 * composition component.
 */
import type { Project, ProjectWorkflow, SessionProvider, WorkflowChildSession, WorkflowRunnerProcess } from '../../../types/app';
import { findWorkflowChildSession } from '../../../utils/workflowSessions';
import { buildWorkflowSessionRouteOptions } from './workflowDetailViewModel';

export function buildRunnerProcessSession(workflow: ProjectWorkflow, process: WorkflowRunnerProcess): WorkflowChildSession | null {
  /** Resolve process thread rows to workflow child-session route records. */
  if (!process.sessionId) return null;
  const provider = String(process.provider || '').trim();
  if (provider && provider !== 'codex' && provider !== 'pi') return null;
  return findWorkflowChildSession(workflow.childSessions, process.sessionId, { provider: process.provider, stageKey: process.stage }) || { id: process.sessionId, title: process.stage, provider: process.provider || 'codex', workflowId: workflow.id, stageKey: process.stage };
}

export function WorkflowRunnerProcesses({ project, workflow, onNavigateToSession, onOpenArtifactFile }: { project: Project; workflow: ProjectWorkflow; onNavigateToSession: (sessionId: string, options?: { provider?: SessionProvider; projectName?: string; projectPath?: string; workflowId?: string; workflowStageKey?: string; routePath?: string }) => void; onOpenArtifactFile: (filePath: string) => void }) {
  /** Show backend-projected runner process rows without parsing logs in React. */
  const processes = Array.isArray(workflow.runnerProcesses) ? workflow.runnerProcesses : [];
  if (processes.length === 0) return null;
  return <section className="space-y-2" data-testid="workflow-runner-processes"><h3 className="text-sm font-semibold text-foreground">进程</h3><div className="overflow-hidden rounded-md border border-border">{processes.map((process, index) => { const session = buildRunnerProcessSession(workflow, process); const meta = [process.role ? 'role=' + process.role : '', process.pid !== undefined ? 'pid=' + process.pid : '', process.exitCode !== undefined ? 'exit=' + process.exitCode : '', process.failed !== undefined ? 'failed=' + (process.failed ? 'true' : 'false') : ''].filter(Boolean).join(' '); return <div key={process.stage + '-' + process.role + '-' + (process.sessionId || index)} className="grid gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 md:grid-cols-[minmax(7rem,1fr)_minmax(6rem,0.8fr)_minmax(10rem,1.3fr)_auto]"><div className="font-medium text-foreground">{process.stage}</div><div className="text-muted-foreground">{process.status}</div><div className="min-w-0 text-muted-foreground">{session ? <button type="button" className="max-w-full truncate text-left text-indigo-600 underline" onClick={() => onNavigateToSession(session.id, buildWorkflowSessionRouteOptions(project, workflow, session))}>thread={process.sessionId}</button> : meta || 'pending'}{session && meta ? <span className="ml-2">{meta}</span> : null}</div><div className="flex justify-start md:justify-end">{process.logPath ? <button type="button" className="text-indigo-600 underline" onClick={() => onOpenArtifactFile(process.logPath || '')}>log</button> : null}</div></div>; })}</div></section>;
}
