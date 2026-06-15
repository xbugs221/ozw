/**
 * PURPOSE: Render workflow artifact evidence lists from projected artifact link
 * data while keeping artifact opening behavior reusable.
 */
import type { Project, WorkflowArtifact } from '../../../types/app';
import { resolveArtifactPath, resolveArtifactType } from './workflowArtifactLinks';

export function WorkflowArtifactList({ project, artifacts, onOpenArtifactFile, onOpenArtifactDirectory }: { project: Project; artifacts: WorkflowArtifact[]; onOpenArtifactFile: (filePath: string) => void; onOpenArtifactDirectory: (directoryPath: string) => void }) {
  /** Render existing workflow artifacts as clickable evidence rows. */
  const visibleArtifacts = artifacts.filter((artifact) => artifact.exists !== false);
  if (visibleArtifacts.length === 0) return null;
  return <div className="space-y-1">{visibleArtifacts.map((artifact) => { const artifactPath = resolveArtifactPath(project, artifact); if (!artifactPath) return null; return <button key={artifact.id} type="button" className="block text-left text-sm text-primary underline" onClick={() => resolveArtifactType(artifact) === 'directory' ? onOpenArtifactDirectory(artifactPath) : onOpenArtifactFile(artifactPath)}>{artifact.label}</button>; })}</div>;
}
