/**
 * PURPOSE: Render the workflow stage matrix while delegating stage grouping to
 * the workflow stage table view model.
 */
import type { Project, ProjectWorkflow, SessionProvider, WorkflowArtifact, WorkflowChildSession, WorkflowStageInspection } from '../../../types/app';
import { buildWorkflowSessionRouteOptions, getLinkTone } from './workflowDetailViewModel';
import { resolveArtifactPath, resolveArtifactType } from './workflowArtifactLinks';
import { buildWorkflowStageTableColumns, type WorkflowStageTableEntry } from './workflowStageTableViewModel';

type WorkflowStageTableProps = {
  project: Project;
  workflow: ProjectWorkflow;
  stageInspections: WorkflowStageInspection[];
  onNavigateToSession: (sessionId: string, options?: { provider?: SessionProvider; projectName?: string; projectPath?: string; workflowId?: string; workflowStageKey?: string; routePath?: string; routeSearch?: Record<string, string> }) => void;
  onOpenArtifactFile: (filePath: string) => void;
  onOpenArtifactDirectory: (directoryPath: string) => void;
};

function renderWorkflowStageTableEntry(
  project: Project,
  workflow: ProjectWorkflow,
  entry: WorkflowStageTableEntry,
  onNavigateToSession: WorkflowStageTableProps['onNavigateToSession'],
  onOpenArtifactFile: WorkflowStageTableProps['onOpenArtifactFile'],
  onOpenArtifactDirectory: WorkflowStageTableProps['onOpenArtifactDirectory'],
) {
  /**
   * PURPOSE: Render one concrete workflow timeline item while preserving the
   * existing session and artifact navigation contracts.
   */
  if (entry.session) {
    return (
      <button
        type="button"
        className={['block max-w-full truncate text-left text-sm font-medium underline decoration-current underline-offset-2', getLinkTone(entry.status)].join(' ')}
        title={entry.label}
        onClick={() => onNavigateToSession(
          entry.session?.id || '',
          buildWorkflowSessionRouteOptions(project, workflow, entry.session as WorkflowChildSession),
        )}
      >
        {entry.label}
      </button>
    );
  }

  if (!entry.artifact) {
    return <span className="block truncate text-sm text-foreground">{entry.label}</span>;
  }

  const artifactPath = resolveArtifactPath(project, entry.artifact);
  const artifactType = resolveArtifactType(entry.artifact);
  if (!artifactPath || entry.artifact.exists === false) {
    return null;
  }

  return (
    <button
      type="button"
      className={['block max-w-full truncate text-left text-sm font-medium underline decoration-current underline-offset-2', getLinkTone(entry.status)].join(' ')}
      title={entry.label}
      onClick={() => {
        if (artifactType === 'directory') {
          onOpenArtifactDirectory(artifactPath);
          return;
        }
        onOpenArtifactFile(artifactPath);
      }}
    >
      {entry.label}
    </button>
  );
}

export function WorkflowStageTable({
  project,
  workflow,
  stageInspections,
  onNavigateToSession,
  onOpenArtifactFile,
  onOpenArtifactDirectory,
}: WorkflowStageTableProps) {
  /**
   * PURPOSE: Preview the workflow as a grouped stage matrix where each cell is
   * one clickable session or artifact link.
   */
  const columns = buildWorkflowStageTableColumns(stageInspections);
  const rowCount = Math.max(...columns.map((column) => column.entries.length), 0);
  if (columns.length === 0 || rowCount === 0) {
    return null;
  }

  return (
    <section data-testid="workflow-stage-table-preview">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[48rem] table-fixed border-collapse text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="border-r border-border px-3 py-2 font-medium last:border-r-0"
                  data-testid={`workflow-stage-table-column-${column.key}`}
                >
                  <span className="truncate">{column.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, rowIndex) => (
              <tr key={`workflow-stage-table-row-${rowIndex}`} className="border-t border-border">
                {columns.map((column) => {
                  const entry = column.entries[rowIndex];
                  return (
                  <td
                    key={`${column.key}-${rowIndex}`}
                    className="h-11 border-r border-border bg-background px-3 py-2 align-top last:border-r-0"
                    data-testid={`workflow-stage-table-cell-${column.key}-${rowIndex}`}
                  >
                    {entry
                      ? renderWorkflowStageTableEntry(
                        project,
                        workflow,
                        entry,
                        onNavigateToSession,
                        onOpenArtifactFile,
                        onOpenArtifactDirectory,
                      )
                      : null}
                  </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

