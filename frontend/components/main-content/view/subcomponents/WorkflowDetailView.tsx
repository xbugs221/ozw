/**
 * PURPOSE: Render the workflow detail page as the compact stage table while
 * keeping workflow detail data fresh for session and artifact links.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Project, ProjectWorkflow, SessionProvider } from '../../../../types/app';
import { api } from '../../../../utils/api';
import { buildFallbackStageInspections } from '../../workflow-detail/workflowDetailViewModel';
import { WorkflowStageTable } from '../../workflow-detail/WorkflowStageTable';

type WorkflowDetailViewProps = {
  project: Project;
  workflow: ProjectWorkflow;
  onNavigateToSession: (sessionId: string, options?: { provider?: SessionProvider; projectName?: string; projectPath?: string; workflowId?: string; workflowStageKey?: string; routePath?: string; routeSearch?: Record<string, string> }) => void;
  onOpenArtifactFile: (filePath: string) => void;
  onOpenArtifactDirectory: (directoryPath: string) => void;
  onContinueWorkflow?: (workflow: ProjectWorkflow) => Promise<void> | void;
};

const workflowDetailCache = new Map<string, ProjectWorkflow>();

type FreshWorkflowState = { identityKey: string; workflow: ProjectWorkflow };

function buildWorkflowDetailIdentityKey(project: Project, workflow: ProjectWorkflow): string {
  /** Build the route identity used to ignore stale detail refreshes. */
  return [project.fullPath || project.path || project.name, workflow.id].join(':');
}

function buildWorkflowDetailCacheKey(project: Project, workflow: ProjectWorkflow): string {
  /** Build a refresh cache key from the workflow fields that affect detail data. */
  const stageSignature = (workflow.stageStatuses || []).map((stage) => stage.key + ':' + stage.status).join('|');
  return [project.fullPath || project.path || project.name, workflow.id, workflow.updatedAt || '', workflow.runState || '', workflow.stage || '', workflow.gateDecision || '', stageSignature].join(':');
}

export default function WorkflowDetailView({ project, workflow, onNavigateToSession, onOpenArtifactFile, onOpenArtifactDirectory }: WorkflowDetailViewProps) {
  const [freshWorkflow, setFreshWorkflow] = useState<FreshWorkflowState | null>(null);
  const currentWorkflowIdentityKey = buildWorkflowDetailIdentityKey(project, workflow);
  const currentWorkflow = freshWorkflow?.identityKey === currentWorkflowIdentityKey ? freshWorkflow.workflow : workflow;

  useEffect(() => {
    /** Re-read workflow detail when route-selected workflow metadata changes. */
    let cancelled = false;
    const identityKey = buildWorkflowDetailIdentityKey(project, workflow);
    const cacheKey = buildWorkflowDetailCacheKey(project, workflow);
    const cachedWorkflow = workflowDetailCache.get(cacheKey);
    if (cachedWorkflow) {
      setFreshWorkflow({ identityKey, workflow: cachedWorkflow });
      return () => { cancelled = true; };
    }
    setFreshWorkflow((current) => (current?.identityKey === identityKey ? current : null));
    api.projectWorkflow(project.name, workflow.id, project.fullPath || project.path || '')
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const nextWorkflow = await response.json();
        workflowDetailCache.set(cacheKey, nextWorkflow);
        setFreshWorkflow({ identityKey, workflow: nextWorkflow });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [project.fullPath, project.name, project.path, workflow.id, workflow.updatedAt, workflow.gateDecision, workflow.runState]);

  const stageInspections = useMemo(() => (
    currentWorkflow.stageInspections && currentWorkflow.stageInspections.length > 0
      ? currentWorkflow.stageInspections
      : buildFallbackStageInspections(currentWorkflow)
  ), [currentWorkflow]);

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 md:px-6">
        <div className="rounded-lg border border-border/50 bg-card p-4">
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-foreground">{currentWorkflow.title}</h2>
            <WorkflowStageTable project={project} workflow={currentWorkflow} stageInspections={stageInspections} onNavigateToSession={onNavigateToSession} onOpenArtifactFile={onOpenArtifactFile} onOpenArtifactDirectory={onOpenArtifactDirectory} />
          </div>
        </div>
      </div>
    </div>
  );
}
