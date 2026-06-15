/**
 * PURPOSE: Convert sealed oz flow runner state files into ozw ProjectWorkflow
 * read models without reading or writing legacy workflow mirror config.
 */
import path from 'path';
import { promises as fs } from 'fs';
import type { Dirent, Stats } from 'node:fs';
import {
  formatFlowStatePathForDiagnostics,
  resolveFlowBatchesRoot,
  resolveFlowRunsRoot,
} from '../flow-runtime-paths.js';
import { buildWorkflowArtifacts } from './artifact-projection.js';
import { buildWorkflowChildSessions, buildWorkflowOwnedSessions } from './session-projection.js';
import { buildRunnerProcesses } from './process-projection.js';
import { buildWorkflowDiagnostics } from './diagnostics-projection.js';
import {
  buildWorkflowDag,
  runWoStatus,
} from './dag-read-model.js';
import {
  buildStageInspections,
  buildStageStatuses,
  buildWorkflowDisplayLines,
  buildWorkflowRoleSummary,
  buildWorkflowStatusSummary,
} from './status-summary.js';
import { normalizeWorkflowStateWithWarnings, pick, type WorkflowState } from './workflow-state-schema.js';

type AnyRecord = Record<string, any>;
type WorkflowArtifact = AnyRecord;
type WorkflowSessionRef = AnyRecord;
type RunnerProcess = AnyRecord;
type StageStatus = AnyRecord;
type BatchItem = {
  changeName?: string;
  batchIndex: number;
  status?: string;
  runId?: string;
};
type BatchReadModel = {
  id: string;
  status: string;
  currentIndex: number;
  displayCurrentIndex: number;
  total: number;
  runIds: string[];
  changes: string[];
  items: BatchItem[];
  error?: string;
  displayId: string;
};
type BatchContextMap = Record<string, AnyRecord>;
type BatchReadModelInput = {
  projectPath: string;
  batchDirName: string;
  state: AnyRecord;
  statePath: string;
  stateStat: Stats;
};
type WorkflowReadModelInput = {
  projectPath: string;
  runDirName: string;
  state: AnyRecord;
  statePath: string;
  stateStat: Stats;
  batchContext?: BatchContextMap;
};

const REVIEW_TITLES = {
  review_1: '需求与范围覆盖',
  review_2: '实现风险与回归',
  review_3: '验收与交付闭环',
};

/**
 * Return a filesystem-style error code when an unknown error carries one.
 */
function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
}

/**
 * Convert unknown errors into stable diagnostic text.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Convert arbitrary runner paths to project-relative slash paths.
 */
/**
 * Map runner status words/**
 * Map runner status words to the Web workflow state vocabulary.
 */
function mapRunState(status: unknown): string {
  const normalized = String(status || '').toLowerCase();
  if (['completed', 'done', 'archived', 'success', 'succeeded'].includes(normalized)) {
    return 'completed';
  }
  if (['failed', 'error', 'aborted', 'blocked'].includes(normalized)) {
    return 'blocked';
  }
  return 'running';
}

/**
 * Return the explicit stage from an oz flow process row, accepting current and
 * historical field spellings.
 */
/**
 * Normalize oz flow batch run_ids/**
 * Normalize oz flow batch run_ids from the real map contract or legacy arrays.
 */
function normalizeBatchRunIds(runIds: unknown, changes: string[]): string[] {
  if (Array.isArray(runIds)) {
    return runIds.map(String);
  }
  if (!runIds || typeof runIds !== 'object') {
    return [];
  }
  return changes
    .map((changeName) => (runIds as AnyRecord)[changeName])
    .filter((runId) => runId)
    .map(String);
}

/**
 * Resolve the run id attached to one batch change from current and legacy
 * oz flow state shapes.
 */
function pickBatchRunIdForChange(runIds: unknown, changes: string[], index: number): string {
  if (Array.isArray(runIds)) {
    return runIds[index] ? String(runIds[index]) : '';
  }
  if (runIds && typeof runIds === 'object') {
    const changeName = changes[index];
    return (runIds as AnyRecord)[changeName] ? String((runIds as AnyRecord)[changeName]) : '';
  }
  return '';
}

/**
 * Read one run state only to derive the batch item's business status.
 */
async function readBatchItemStatus(projectPath: string, runId: string): Promise<string> {
  if (!runId) {
    return 'pending';
  }
  try {
    const statePath = path.join(resolveFlowRunsRoot(projectPath), runId, 'state.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    return mapRunState(state?.status);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      console.error(`Failed to read batch run state ${runId}:`, errorMessage(error));
    }
    return 'running';
  }
}

/**
 * Build the full proposal item list in oz flow changes order.
 */
async function buildBatchItems(projectPath: string, changes: string[], runIdsState: unknown): Promise<BatchItem[]> {
  const items: BatchItem[] = [];
  for (let index = 0; index < changes.length; index += 1) {
    const changeName = String(changes[index] || '').trim();
    const runId = pickBatchRunIdForChange(runIdsState, changes, index);
    const status = await readBatchItemStatus(projectPath, runId);
    items.push({
      changeName,
      batchIndex: index + 1,
      status,
      ...(runId ? { runId } : {}),
    });
  }
  return items;
}

/**
 * Convert the 0-based oz flow current_index into the progress number users see.
 */
function displayBatchCurrentIndex(currentIndex: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(Math.max(currentIndex + 1, 1), total);
}

/**
 * Preserve oz flow state.sessions as provider-aware ids for frontend filtering.
 */
/**
 * Group DAG review targets/**
 * Group DAG review targets by their owning workflow stage.
 */
/**
 * Merge run-dir-scanned artifacts with path-based artifacts, deduplicating by label.
 */
/**
 * Read and build a batch read model/**
 * Read and build a batch read model from a batch state.json file.
 */
export async function buildBatchReadModel({
  projectPath,
  batchDirName,
  state,
}: BatchReadModelInput): Promise<BatchReadModel> {
  const batchId = String(state?.batch_id || batchDirName || '').trim();
  const status = String(state?.status || '').trim();
  const changes = Array.isArray(state?.changes) ? state.changes.map(String) : [];
  const currentIndex = Number.isInteger(state?.current_index) ? state.current_index : (changes.length > 0 ? changes.length - 1 : 0);
  const runIds = normalizeBatchRunIds(state?.run_ids, changes);
  const error = String(state?.error || '').trim();
  const total = Math.max(changes.length, runIds.length);
  const items = await buildBatchItems(projectPath, changes, state?.run_ids);

  return {
    id: batchId,
    status: mapRunState(status),
    currentIndex,
    displayCurrentIndex: displayBatchCurrentIndex(currentIndex, total),
    total,
    runIds,
    changes,
    items,
    error: error || undefined,
    // displayId is assigned after sorting all batches
    displayId: '',
  };
}

/**
 * Discover all batch state files for a project and return batch read models.
 */
export async function listBatchReadModels(projectPath: string): Promise<BatchReadModel[]> {
  if (!projectPath) {
    return [];
  }
  const batchesRoot = resolveFlowBatchesRoot(projectPath);
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(batchesRoot, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const batches: BatchReadModel[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const statePath = path.join(batchesRoot, entry.name, 'state.json');
    try {
      const stateStat = await fs.stat(statePath);
      const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
      batches.push(await buildBatchReadModel({
        projectPath,
        batchDirName: entry.name,
        state,
        statePath,
        stateStat,
      }));
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        console.error(`Failed to read batch state ${statePath}:`, errorMessage(error));
      }
    }
  }

  // Assign displayIds by sorting batches (newest first by dir name convention)
  batches.sort((left, right) => right.id.localeCompare(left.id));
  batches.forEach((batch, index) => {
    batch.displayId = `b${index + 1}`;
  });

  return batches;
}

/**
 * Build a map of runId -> batch context for quick lookup during run read model building.
 */
export function buildBatchContextMap(batches: BatchReadModel[]): BatchContextMap {
  const map: BatchContextMap = {};
  for (const batch of batches) {
    const items = Array.isArray(batch.items) && batch.items.length > 0
      ? batch.items
      : batch.runIds.map((runId: string, index: number) => ({ runId, batchIndex: index + 1 }));
    items.forEach((item) => {
      const runId = String(item?.runId || '').trim();
      if (!runId) {
        return;
      }
      map[runId] = {
        batchId: batch.id,
        batchDisplayId: batch.displayId,
        batchIndex: item.batchIndex,
        batchTotal: batch.total,
        batchStatus: batch.status,
      };
    });
  }
  return map;
}

/**
 * Merge equivalent runner status JSON over sealed state without discarding
 * fields that are only present in state.json.
 */
function mergeRuntimeStatusState(state: WorkflowState, statusState: unknown, warnings: string[]): WorkflowState {
  if (!statusState || typeof statusState !== 'object') {
    return state;
  }
  const normalized = normalizeWorkflowStateWithWarnings({
    ...state,
    ...statusState,
    workflow_config: {
      ...(state?.workflow_config || {}),
      ...((statusState as AnyRecord).workflow_config || {}),
    },
    paths: (statusState as AnyRecord).paths || state?.paths,
    sessions: (statusState as AnyRecord).sessions || state?.sessions,
    stages: (statusState as AnyRecord).stages || state?.stages,
    dag_nodes: (statusState as AnyRecord).dag_nodes || state?.dag_nodes,
  });
  warnings.push(...normalized.warnings.map((warning) => `Runtime status ${warning}`));
  return normalized.value;
}

/**
 * Convert one parsed state file into a ProjectWorkflow read model.
 */
export async function buildWorkflowReadModel({
  projectPath,
  runDirName,
  state,
  statePath,
  stateStat,
  batchContext,
}: WorkflowReadModelInput): Promise<AnyRecord> {
  const warnings: string[] = [];
  const normalizedState = normalizeWorkflowStateWithWarnings(state);
  let workflowState = normalizedState.value;
  warnings.push(...normalizedState.warnings);
  const runId = String(pick(workflowState, 'run_id') || runDirName || '').trim();
  const statusResult = await runWoStatus(projectPath, runId);
  if (statusResult.ok) {
    workflowState = mergeRuntimeStatusState(workflowState, statusResult.data, warnings);
  } else {
    warnings.push(`oz flow status json unavailable: ${statusResult.error}`);
  }
  const changeName = String(pick(workflowState, 'change_name') || '').trim();
  const rawStatus = String(pick(workflowState, 'status') || '').trim();
  const rawStage = String(pick(workflowState, 'stage') || '').trim();
  const updatedAt = String(pick(workflowState, 'updated_at') || stateStat?.mtime?.toISOString?.() || runDirName || '').trim();
  const stageStatuses = buildStageStatuses(workflowState, rawStage, rawStatus, warnings);
  const { artifacts, logsByKey, planningArtifacts } = await buildWorkflowArtifacts(
    projectPath,
    runDirName,
    runId,
    changeName,
    stageStatuses,
    workflowState,
    warnings,
  );
  const runnerProcesses = buildRunnerProcesses(workflowState, stageStatuses, logsByKey, warnings);
  const childSessions = buildWorkflowChildSessions(runId, runnerProcesses, warnings, stageStatuses, workflowState) as WorkflowSessionRef[];
  const workflowDisplay = {
    lines: buildWorkflowDisplayLines(workflowState, stageStatuses, childSessions, runnerProcesses, warnings),
  };
  const workflowRoleSummary = buildWorkflowRoleSummary(workflowState, childSessions);
  const dagNodes = pick(workflowState, 'dag_nodes') || {};
  const hasExistingPlanningArtifact = planningArtifacts.some((artifact) => artifact.exists !== false);
  const workflowStatusSummary = buildWorkflowStatusSummary(workflowState, childSessions, artifacts, dagNodes, hasExistingPlanningArtifact);
  const runnerError = String(pick(workflowState, 'error') || '').trim();

  const workflowDag = await buildWorkflowDag({
    projectPath,
    runDirName,
    state: workflowState,
    changeName,
    childSessions,
    artifacts,
    stageStatuses,
    warnings,
  });

  const workflowOwnedSessions = buildWorkflowOwnedSessions(workflowState, workflowDag);

  const diagnostics = buildWorkflowDiagnostics({
    state: workflowState,
    statePath,
    stateStat,
    rawStatus,
    rawStage,
    runnerError,
    runnerProcesses,
    warnings,
    workflowOwnedSessions,
  });
  const stageInspections = buildStageInspections(workflowState, stageStatuses, childSessions, artifacts, runnerError, diagnostics, workflowDag);

  const result: AnyRecord = {
    id: runId,
    title: changeName || runId,
    objective: changeName || runId,
    openspecChangeName: changeName,
    openspecChangeDetected: Boolean(changeName),
    adoptsExistingOpenSpec: Boolean(changeName),
    runner: 'go',
    runnerProvider: 'codex',
    runId,
    runnerError,
    failureReason: runnerError || undefined,
    stage: rawStage || 'execution',
    runState: mapRunState(rawStatus),
    updatedAt,
    stageStatuses,
    artifacts,
    childSessions,
    runnerProcesses,
    workflowDisplay,
    workflowRoleSummary,
    workflowStatusSummary,
    stageInspections,
    workflowDag,
    controlPlaneReadModel: { stages: stageInspections },
    controllerEvents: diagnostics.warnings.map((message) => ({
      type: 'runner_diagnostic',
      provider: 'codex',
      message,
    })),
    hasUnreadActivity: workflowState.hasUnreadActivity === true || mapRunState(rawStatus) === 'running',
    runnerDiagnostics: diagnostics,
    diagnostics,
  };

  // Attach batch context if this run belongs to a batch
  if (batchContext?.[runId]) {
    Object.assign(result, batchContext[runId]);
  }

  return result;
}

/**
 * Discover all oz flow state files and convert valid ones without one bad run
 * preventing other runs from rendering.
 */
export async function listWorkflowReadModels(projectPath: string): Promise<AnyRecord[]> {
  if (!projectPath) {
    return [];
  }

  // Load batch context first so we can attach it to individual runs
  let batchContext: BatchContextMap;
  try {
    const batches = await listBatchReadModels(projectPath);
    batchContext = buildBatchContextMap(batches);
  } catch (error) {
    console.error(`Failed to load batch context for ${projectPath}:`, errorMessage(error));
    batchContext = {};
  }

  const runsRoot = resolveFlowRunsRoot(projectPath);
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(runsRoot, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const workflows: AnyRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const statePath = path.join(runsRoot, entry.name, 'state.json');
    try {
      const stateStat = await fs.stat(statePath);
      const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
      workflows.push(await buildWorkflowReadModel({
        projectPath,
        runDirName: entry.name,
        state,
        statePath,
        stateStat,
        batchContext,
      }));
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        workflows.push({
          id: entry.name,
          title: entry.name,
          objective: entry.name,
          runner: 'go',
          runnerProvider: 'codex',
          runId: entry.name,
          runnerError: `Unreadable runner state: ${errorMessage(error)}`,
          stage: 'unknown',
          runState: 'blocked',
          updatedAt: entry.name,
          stageStatuses: [],
          artifacts: [],
          childSessions: [],
          runnerProcesses: [],
          runnerDiagnostics: {
            statePath: formatFlowStatePathForDiagnostics(statePath),
            stateMtime: null,
            rawStatus: '',
            rawStage: '',
            woContractVersion: '',
            woContractOk: false,
            runnerError: `Unreadable runner state: ${errorMessage(error)}`,
            pathCount: 0,
            sessionCount: 0,
            processCount: 0,
            warnings: [`Unreadable runner state: ${errorMessage(error)}`],
          },
        });
      }
    }
  }

  return workflows.sort((left, right) => {
    const timeDelta = Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || '');
    if (Number.isFinite(timeDelta) && timeDelta !== 0) {
      return timeDelta;
    }
    return String(left.title || left.runId || left.id).localeCompare(String(right.title || right.runId || right.id));
  });
}
