/**
 * PURPOSE: Project workflow artifact sources into one deduplicated artifact read
 * model for detail pages and stage inspections.
 */
import path from 'path';
import { promises as fs } from 'fs';
import { resolveFlowRunsRoot } from '../flow-runtime-paths.js';
import { buildPathReadModel, buildPlanningArtifacts, scanRunDirFixedArtifacts } from './artifact-reader.js';
import type { WorkflowArtifactRef, WorkflowStageStatus, WorkflowState } from './workflow-state-schema.js';

type WorkflowArtifact = WorkflowArtifactRef;
type StageStatus = WorkflowStageStatus;


function mergeArtifacts(pathArtifacts: WorkflowArtifact[], scannedArtifacts: WorkflowArtifact[]): WorkflowArtifact[] {
  const merged = [...pathArtifacts];
  const pathLabels = new Set(pathArtifacts.map((a) => a.label));
  for (const scanned of scannedArtifacts) {
    if (!pathLabels.has(scanned.label)) {
      merged.push(scanned);
    }
  }
  return merged;
}



export async function buildWorkflowArtifacts(projectPath: string, runDirName: string, runId: string, changeName: string, stageStatuses: StageStatus[], state: WorkflowState, warnings: string[]): Promise<{ artifacts: WorkflowArtifact[]; logsByKey: Map<string, string>; planningArtifacts: WorkflowArtifact[] }> {
  /** Build path, run-directory, planning, archive, and inferred QA artifacts. */
  const { artifacts: pathArtifacts, logsByKey } = await buildPathReadModel(projectPath, state, warnings);
  const runDir = path.join(resolveFlowRunsRoot(projectPath), runDirName);
  const scannedArtifacts = await scanRunDirFixedArtifacts(runDir, runId, warnings);
  const artifacts: WorkflowArtifact[] = mergeArtifacts(pathArtifacts as WorkflowArtifact[], scannedArtifacts as WorkflowArtifact[]);
  const planningArtifacts = await buildPlanningArtifacts(projectPath, changeName) as WorkflowArtifact[];
  if (planningArtifacts.length > 0) {
    const pathLabels = new Set(artifacts.map((a) => a.label));
    for (const planningArtifact of planningArtifacts) {
      if (!pathLabels.has(planningArtifact.label)) artifacts.push(planningArtifact);
    }
  }
  const archiveStage = stageStatuses.find((stage) => stage.key === 'archive');
  if (archiveStage && String(archiveStage.status || '').toLowerCase() !== 'pending' && !artifacts.some((artifact) => artifact.type === 'delivery-summary')) {
    artifacts.push({ id: 'delivery-summary:delivery-summary.md', label: 'delivery-summary.md', type: 'delivery-summary', stage: 'archive', relativePath: 'delivery-summary.md', path: 'delivery-summary.md', exists: false });
  }
  const artifactLabels = new Set(artifacts.map((a) => a.label));
  for (const stage of stageStatuses) {
    const qaStageMatch = /^qa_(\d+)$/.exec(stage.key);
    if (!qaStageMatch || String(stage.status || '').toLowerCase() === 'pending') continue;
    const qaLabel = 'qa-' + qaStageMatch[1] + '.json';
    if (artifactLabels.has(qaLabel)) continue;
    const qaPath = path.join(runDir, qaLabel);
    let exists = true;
    try { await fs.access(qaPath); } catch { exists = false; warnings.push('Expected qa-N artifact not found: ' + qaPath); }
    artifacts.push({ id: 'stage-inferred:' + runId + ':' + qaLabel, label: qaLabel, type: 'qa-result', semanticType: 'qa-result', stage: stage.key, relativePath: qaPath, path: qaPath, exists, source: 'stage-inferred' });
  }
  return { artifacts, logsByKey, planningArtifacts };
}
