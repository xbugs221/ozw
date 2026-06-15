/**
 * PURPOSE: Render workflow stage inspection rows with stable test ids and
 * provider-aware child-session navigation separate from the detail shell.
 */
import type { Project, ProjectWorkflow, SessionProvider, WorkflowChildSession, WorkflowStageInspection } from '../../../types/app';
import { buildWorkflowSessionRouteOptions, getWorkflowStageTreeTitle } from './workflowDetailViewModel';
import { getDisplaySubstageSessions, getExecutionSessionDisplayLabel, getPrimaryStageSession, getWorkflowSessionDisplayLabel } from './workflowStageTableViewModel';
import { WorkflowArtifactList } from './WorkflowArtifactList';

type WorkflowStageTreeProps = {
  project: Project;
  workflow: ProjectWorkflow;
  stageInspections: WorkflowStageInspection[];
  onNavigateToSession: (sessionId: string, options?: { provider?: SessionProvider; projectName?: string; projectPath?: string; workflowId?: string; workflowStageKey?: string; routePath?: string; routeSearch?: Record<string, string> }) => void;
  onOpenArtifactFile: (filePath: string) => void;
  onOpenArtifactDirectory: (directoryPath: string) => void;
};

function StageSessionLink({ project, workflow, stage, session, onNavigateToSession }: { project: Project; workflow: ProjectWorkflow; stage: WorkflowStageInspection; session: WorkflowChildSession; onNavigateToSession: WorkflowStageTreeProps['onNavigateToSession'] }) {
  /** Render a child-session link using the compact business labels expected by workflow tests. */
  const label = stage.stageKey === 'execution' ? getExecutionSessionDisplayLabel(session) : getWorkflowSessionDisplayLabel(session);
  return <button type="button" className="text-left text-sm font-medium text-primary underline decoration-current underline-offset-2" onClick={() => onNavigateToSession(session.id, buildWorkflowSessionRouteOptions(project, workflow, session))}>{label}</button>;
}

export function WorkflowStageTree({ project, workflow, stageInspections, onNavigateToSession, onOpenArtifactFile, onOpenArtifactDirectory }: WorkflowStageTreeProps) {
  /** Render the legacy stage tree contract from projected stage inspections. */
  if (stageInspections.length === 0) return null;
  return (
    <section className="space-y-2" data-testid="workflow-status-tree" aria-label="workflow status tree">
      {stageInspections.map((stage) => {
        const primarySession = getPrimaryStageSession(stage);
        const substageSessions = stage.substages.flatMap((substage) => getDisplaySubstageSessions(substage, primarySession?.id));
        const visibleFiles = stage.substages.flatMap((substage) => substage.files || []).filter((artifact) => artifact.exists !== false);
        return (
          <div key={stage.stageKey} className="space-y-2 rounded-md border border-border/50 bg-background/70 px-3 py-2" data-testid={'workflow-status-tree-row-' + stage.stageKey}>
            <div className="flex flex-wrap items-center gap-2">
              {primarySession ? <button type="button" className="text-left text-sm font-semibold text-primary underline decoration-current underline-offset-2" onClick={() => {
                const routeOptions = buildWorkflowSessionRouteOptions(project, workflow, {
                  ...primarySession,
                  address: undefined,
                  routePath: undefined,
                });
                onNavigateToSession(primarySession.id, {
                  ...routeOptions,
                  routePath: `/runs/${encodeURIComponent(workflow.runId || workflow.id)}/sessions/${encodeURIComponent(stage.stageKey || primarySession.stageKey || primarySession.id)}`,
                });
              }}>{getWorkflowStageTreeTitle(stage)}</button> : <span className="text-sm font-semibold text-foreground">{getWorkflowStageTreeTitle(stage)}</span>}
              <span className="text-xs text-muted-foreground">{stage.status}</span>
            </div>
            {stage.note ? <div className="text-xs text-muted-foreground">{stage.note}</div> : null}
            {substageSessions.length > 0 ? <div className="flex flex-wrap gap-2">{substageSessions.map((session) => <StageSessionLink key={(session.provider || 'codex') + ':' + session.id + ':' + session.stageKey} project={project} workflow={workflow} stage={stage} session={session} onNavigateToSession={onNavigateToSession} />)}</div> : null}
            <WorkflowArtifactList project={project} artifacts={visibleFiles} onOpenArtifactFile={onOpenArtifactFile} onOpenArtifactDirectory={onOpenArtifactDirectory} />
          </div>
        );
      })}
    </section>
  );
}
