/**
 * PURPOSE: Keep workflow role summary rendering outside the detail composition
 * component while preserving artifact/session link contracts.
 */
import type { Project, ProjectWorkflow, SessionProvider } from '../../../types/app';
import { findWorkflowChildSession } from '../../../utils/workflowSessions';
import { buildWorkflowSessionRouteOptions } from './workflowDetailViewModel';

export function WorkflowRoleSummary({ project, workflow, onNavigateToSession }: { project: Project; workflow: ProjectWorkflow; onNavigateToSession: (sessionId: string, options?: { provider?: SessionProvider; projectName?: string; projectPath?: string; workflowId?: string; workflowStageKey?: string; routePath?: string }) => void; onOpenArtifactFile?: (filePath: string) => void }) {
  /** Render workflow role rows with provider-aware child-session navigation. */
  const rows = workflow.workflowRoleSummary?.rows || [];
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="workflow role summary">
      {rows.map((row) => {
        const sessionRef = row.sessionRef;
        const unlinked = sessionRef && (sessionRef as any).unlinked === true;
        const hasLink = Boolean(sessionRef?.sessionId) && !unlinked;
        return (
          <div key={row.key} className="flex min-h-8 items-center gap-3 rounded-md border border-border/50 bg-background/70 px-3 py-1.5 text-sm" data-testid={'workflow-role-row-' + row.key}>
            <span className="w-6 shrink-0 font-medium text-foreground">{row.label}</span>
            {hasLink && sessionRef ? (
              <button
                type="button"
                className="truncate text-left text-sm font-medium text-primary underline decoration-current underline-offset-2"
                title={sessionRef.label || sessionRef.sessionId}
                onClick={() => {
                  const childSession = findWorkflowChildSession(workflow.childSessions, sessionRef.sessionId, {
                    provider: sessionRef.provider,
                    stageKey: sessionRef.stageKey,
                    address: sessionRef.address,
                    routePath: sessionRef.routePath,
                  });
                  if (childSession) {
                    onNavigateToSession(sessionRef.sessionId, buildWorkflowSessionRouteOptions(project, workflow, childSession));
                    return;
                  }
                  onNavigateToSession(sessionRef.sessionId, {
                    provider: (sessionRef.provider || 'codex') as SessionProvider,
                    projectName: project.name,
                    projectPath: project.fullPath || project.path || '',
                    workflowId: workflow.id,
                  });
                }}
              >
                会话
              </button>
            ) : (
              <span className="text-muted-foreground">{unlinked ? sessionRef?.sessionId : row.placeholder || '—'}</span>
            )}
            {row.checkCount ? <span className="ml-auto text-green-500" data-testid={'workflow-role-checks-' + row.key}>x{row.checkCount}</span> : null}
          </div>
        );
      })}
    </section>
  );
}
