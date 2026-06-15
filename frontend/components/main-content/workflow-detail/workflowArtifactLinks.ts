/**
 * PURPOSE: Resolve workflow artifact labels, paths, and link targets for the
 * detail page without coupling those rules to React rendering.
 */
import type { Project, ProjectWorkflow, WorkflowArtifact } from '../../../types/app';

export function resolveArtifactPath(project: Project, artifact: WorkflowArtifact): string | null {
  /**
   * Support both server-normalized absolute paths and older relative paths.
   */
  const artifactPath = typeof artifact.path === 'string' ? artifact.path.trim() : '';
  if (!artifactPath) {
    return null;
  }

  if (artifactPath.startsWith('/')) {
    return artifactPath;
  }

  const projectRoot = project.fullPath || project.path || '';
  if (!projectRoot) {
    return artifactPath;
  }

  return `${projectRoot.replace(/[/\\]+$/, '')}/${artifactPath.replace(/^[/\\]+/, '')}`;
}

export function resolveArtifactType(artifact: WorkflowArtifact): 'file' | 'directory' {
  /**
   * Treat directories explicitly and default everything else to file opening.
   */
  if (artifact.type === 'directory') {
    return 'directory';
  }

  return 'file';
}

export function getArtifactFileName(artifact: WorkflowArtifact): string {
  /**
   * Prefer the persisted relative path because oz flow artifacts are project-scoped,
   * then fall back to the normalized path and label for older records.
   */
  const artifactPath = artifact.relativePath || artifact.path || artifact.label || '';
  return artifactPath.split(/[\\/]/).filter(Boolean).at(-1) || artifact.label || artifact.id;
}

function getArtifactRound(artifact: WorkflowArtifact, stagePrefix: string): number {
  /**
   * Extract the oz flow review/fix round from either stage keys or generated artifact
   * filenames so the role row can link only the latest current-round artifact.
   */
  const stageMatch = String(artifact.stage || '').match(new RegExp(`^${stagePrefix}_(\\d+)$`));
  if (stageMatch) {
    return Number(stageMatch[1]);
  }
  const nameMatch = getArtifactFileName(artifact).match(new RegExp(`^${stagePrefix}-(\\d+)\\.(?:json|md|markdown)$`, 'i'));
  return nameMatch ? Number(nameMatch[1]) : 0;
}

function getArtifactExtension(artifact: WorkflowArtifact): string {
  /**
   * Read the visible artifact extension so equal-round candidates can prefer the
   * most useful format for a compact role row.
   */
  return getArtifactFileName(artifact).split('.').pop()?.toLowerCase() || '';
}

export function getLatestRoundArtifact(
  workflow: ProjectWorkflow,
  prefixes: string[],
  preferredExtensions: string[] = ['json', 'md', 'markdown'],
): WorkflowArtifact | null {
  /**
   * Pick one existing artifact for the latest review/fix round, ignoring
   * directories and missing path references that would open a broken link.
   */
  const candidates = (workflow.artifacts || [])
    .filter((artifact) => artifact.exists !== false && resolveArtifactType(artifact) === 'file')
    .map((artifact) => {
      const matchedPrefix = prefixes.find((prefix) => (
        new RegExp(`^${prefix}_\\d+$`).test(String(artifact.stage || ''))
        || new RegExp(`^${prefix}-\\d+\\.(?:json|md|markdown)$`, 'i').test(getArtifactFileName(artifact))
      ));
      return matchedPrefix ? { artifact, round: getArtifactRound(artifact, matchedPrefix) } : null;
    })
    .filter((candidate): candidate is { artifact: WorkflowArtifact; round: number } => Boolean(candidate && candidate.round > 0));

  const extensionPriority = (artifact: WorkflowArtifact) => {
    const index = preferredExtensions.indexOf(getArtifactExtension(artifact));
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  candidates.sort((left, right) => (
    right.round - left.round
    || extensionPriority(left.artifact) - extensionPriority(right.artifact)
    || getArtifactFileName(left.artifact).localeCompare(getArtifactFileName(right.artifact))
  ));
  return candidates[0]?.artifact || null;
}

export function getRoleSummaryArtifact(workflow: ProjectWorkflow, rowKey: string): WorkflowArtifact | null {
  /**
   * Map compact role rows to the one artifact that best represents the latest
   * visible work for that role.
   */
  if (rowKey === 'reviewer') {
    return getLatestRoundArtifact(workflow, ['review'], ['json', 'md', 'markdown']);
  }
  if (rowKey === 'executor') {
    return (workflow.artifacts || []).find((artifact) => (
      artifact.exists !== false
      && resolveArtifactType(artifact) === 'file'
      && (artifact.type === 'summary' || artifact.semanticType === 'summary' || artifact.semanticType === 'workflow_output')
    )) || null;
  }
  if (rowKey === 'acceptance') {
    return (workflow.artifacts || []).find((artifact) => (
      artifact.exists !== false
      && resolveArtifactType(artifact) === 'file'
      && (artifact.type === 'acceptance-summary' || artifact.semanticType === 'acceptance-summary')
    )) || null;
  }
  if (rowKey === 'fixer') {
    return getLatestRoundArtifact(workflow, ['repair', 'fix'], ['md', 'markdown', 'json']);
  }
  if (rowKey === 'archiver') {
    return (workflow.artifacts || []).find((artifact) => (
      resolveArtifactType(artifact) === 'file'
      && (artifact.type === 'delivery-summary' || artifact.semanticType === 'delivery-summary' || getArtifactFileName(artifact) === 'delivery-summary.json')
    )) || null;
  }
  if (rowKey === 'qa') {
    return getLatestRoundArtifact(workflow, ['qa'], ['json', 'md', 'markdown']);
  }
  return null;
}

