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
import {
  inferRole,
} from './stage-taxonomy.js';
import {
  buildPathReadModel,
  buildPlanningArtifacts,
  scanRunDirFixedArtifacts,
} from './artifact-reader.js';
import {
  acceptedProviderFromSessionKey,
  buildChildSessions,
  isKnownProvider,
} from './session-refs.js';
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
const KNOWN_PROCESS_FIELDS = new Set([
  'stage',
  'stageKey',
  'stage_key',
  'role',
  'status',
  'sessionId',
  'session_id',
  'provider',
  'pid',
  'exitCode',
  'exit_code',
  'failed',
  'logPath',
  'log_path',
]);

/**
 * Return a snake_case runner field value.
 */
function pick(object: AnyRecord | null | undefined, snakeKey: string): any {
  return object?.[snakeKey];
}

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
function normalizeRelativePath(projectPath: string, value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const normalized = raw.replace(/\\/g, '/');
  if (!path.isAbsolute(raw)) {
    return normalized;
  }
  return path.relative(projectPath, raw).replace(/\\/g, '/');
}

/**
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
function pickProcessStage(process: RunnerProcess): string {
  return String(
    pick(process, 'stage')
    || pick(process, 'stage_key')
    || process?.stageKey
    || '',
  ).trim();
}

/**
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
function buildWorkflowOwnedSessionRefs(state: AnyRecord): WorkflowSessionRef[] {
  const sessions = pick(state, 'sessions') || {};
  if (!sessions || typeof sessions !== 'object') {
    return [];
  }
  const refs: WorkflowSessionRef[] = [];
  for (const [key, value] of Object.entries(sessions)) {
    const sessionId = String(value || '').trim();
    if (!sessionId) {
      continue;
    }
    const parsed = acceptedProviderFromSessionKey(key);
    if (!parsed.accepted) {
      continue;
    }
    refs.push({
      key,
      role: parsed.role,
      provider: parsed.provider,
      sessionId,
    });
  }
  return refs;
}

/**
 * Normalize runner process rows from explicit processes only.
 * Sessions-only state never generates synthetic process rows.
 */
function buildRunnerProcesses(
  state: AnyRecord,
  stageStatuses: StageStatus[],
  logsByKey: Map<string, string>,
  warnings: string[],
): RunnerProcess[] {
  const explicit = pick(state, 'processes');
  if (!Array.isArray(explicit) || explicit.length === 0) {
    return [];
  }
  const sessions = pick(state, 'sessions') || {};

  /**
   * Resolve process provider using process metadata first, then the matching
   * provider-qualified state.sessions key for this stage/role.
   */
  function resolveProcessProvider(process: RunnerProcess, stage: string, role: string, sessionId: string): string {
    const explicitProvider = String(pick(process, 'provider') || process?.provider || '').trim();
    if (isKnownProvider(explicitProvider)) {
      return explicitProvider;
    }
    if (explicitProvider) {
      warnings.push(`Unsupported runner process provider ${explicitProvider}; child session link omitted for ${sessionId || stage}.`);
      return explicitProvider;
    }
    const inferredRole = inferRole(stage);
    const roleCandidates = new Set([role, inferredRole, stage].map((value) => String(value || '').trim()).filter(Boolean));
    if (stage === 'execution') roleCandidates.add('executor');
    if (stage === 'archive') roleCandidates.add('archiver');
    if (/^review_\d+$/.test(stage)) roleCandidates.add('reviewer');
    if (/^qa(?:_\d+)?$/.test(stage)) roleCandidates.add('qa');
    if (/^(?:fix|repair)_\d+$/.test(stage)) roleCandidates.add('fixer');

    const valueMatches = [];
    for (const [key, value] of Object.entries(sessions && typeof sessions === 'object' ? sessions : {})) {
      if (String(value || '').trim() !== sessionId) {
        continue;
      }
      const parsed = acceptedProviderFromSessionKey(key);
      if (!parsed.accepted) {
        continue;
      }
      if (roleCandidates.has(parsed.role)) {
        return parsed.provider;
      }
      valueMatches.push(parsed.provider);
    }
    return valueMatches[0] || 'codex';
  }

  return explicit.map((process) => {
    const unknownFields = Object.keys(process && typeof process === 'object' ? process : {})
      .filter((key) => !KNOWN_PROCESS_FIELDS.has(key));
    unknownFields.forEach((key) => {
      warnings.push(`Unknown runner process field: ${key}`);
    });
    const stage = pickProcessStage(process);
    const role = String(pick(process, 'role') || inferRole(stage)).trim();
    const sessionId = String(pick(process, 'session_id') || process?.sessionId || '').trim() || undefined;
    const logPath = normalizeRelativePath('', pick(process, 'log_path') || process?.logPath || logsByKey.get(`${stage}_${role}_log`) || logsByKey.get(`${role}_log`) || logsByKey.get(`${stage}_log`));
    return {
      stage,
      role,
      status: String(pick(process, 'status') || '').trim() || undefined,
      sessionId,
      provider: sessionId ? resolveProcessProvider(process, stage, role, sessionId) : undefined,
      pid: Number.isInteger(process?.pid) ? process.pid : undefined,
      exitCode: Number.isInteger(pick(process, 'exit_code') ?? process?.exitCode) ? (pick(process, 'exit_code') ?? process?.exitCode) : undefined,
      failed: process?.failed === true,
      logPath: logPath || undefined,
    };
  }).map((process) => Object.fromEntries(Object.entries(process).filter(([, value]) => value !== undefined && value !== '')));
}

/**
 * Group DAG review targets by their owning workflow stage.
 */
/**
 * Merge run-dir-scanned artifacts with path-based artifacts, deduplicating by label.
 */
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

/**
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
function mergeRuntimeStatusState(state: AnyRecord, statusState: unknown): AnyRecord {
  if (!statusState || typeof statusState !== 'object') {
    return state;
  }
  return {
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
  };
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
  const runId = String(pick(state, 'run_id') || runDirName || '').trim();
  const statusResult = await runWoStatus(projectPath, runId);
  if (statusResult.ok) {
    state = mergeRuntimeStatusState(state, statusResult.data);
  } else {
    warnings.push(`oz flow status json unavailable: ${statusResult.error}`);
  }
  const changeName = String(pick(state, 'change_name') || '').trim();
  const rawStatus = String(pick(state, 'status') || '').trim();
  const rawStage = String(pick(state, 'stage') || '').trim();
  const updatedAt = String(pick(state, 'updated_at') || stateStat?.mtime?.toISOString?.() || runDirName || '').trim();
  const { artifacts: pathArtifacts, logsByKey } = await buildPathReadModel(projectPath, state, warnings);

  // Scan run directory for fixed artifact files
  const runDir = path.join(resolveFlowRunsRoot(projectPath), runDirName);
  const scannedArtifacts = await scanRunDirFixedArtifacts(runDir, runId, warnings);

  let artifacts: WorkflowArtifact[] = mergeArtifacts(
    pathArtifacts as WorkflowArtifact[],
    scannedArtifacts as WorkflowArtifact[],
  );

  // Inject planning artifacts from oz change documents
  const planningArtifacts = await buildPlanningArtifacts(projectPath, changeName) as WorkflowArtifact[];
  if (planningArtifacts.length > 0) {
    const pathLabels = new Set(artifacts.map((a) => a.label));
    for (const planningArtifact of planningArtifacts) {
      if (!pathLabels.has(planningArtifact.label)) {
        artifacts.push(planningArtifact);
      }
    }
  }

  const stageStatuses = buildStageStatuses(state, rawStage, rawStatus, warnings);
  const archiveStage = stageStatuses.find((stage) => stage.key === 'archive');
  if (archiveStage && String(archiveStage.status || '').toLowerCase() !== 'pending' && !artifacts.some((artifact) => artifact.type === 'delivery-summary')) {
    artifacts.push({
      id: 'delivery-summary:delivery-summary.md',
      label: 'delivery-summary.md',
      type: 'delivery-summary',
      stage: 'archive',
      relativePath: 'delivery-summary.md',
      path: 'delivery-summary.md',
      exists: false,
    });
  }

  // Infer expected qa-N.json artifacts from qa_N stages when not already present
  // (paths reference or run-dir scan). Missing files add diagnostics and a
  // exists:false artifact so the UI can suppress broken links.
  // TODO: Replace with generic stage→artifact inference when oz flow formalizes artifact-stage bindings.
  {
    const artifactLabels = new Set(artifacts.map((a) => a.label));
    for (const stage of stageStatuses) {
      const qaStageMatch = /^qa_(\d+)$/.exec(stage.key);
      if (!qaStageMatch) {
        continue;
      }
      if (String(stage.status || '').toLowerCase() === 'pending') {
        continue;
      }
      const qaLabel = `qa-${qaStageMatch[1]}.json`;
      if (artifactLabels.has(qaLabel)) {
        continue;
      }
      const qaPath = path.join(runDir, qaLabel);
      let exists = true;
      try {
        await fs.access(qaPath);
      } catch {
        exists = false;
        warnings.push(`Expected qa-N artifact not found: ${qaPath}`);
      }
      artifacts.push({
        id: `stage-inferred:${runId}:${qaLabel}`,
        label: qaLabel,
        type: 'qa-result',
        semanticType: 'qa-result',
        stage: stage.key,
        relativePath: qaPath,
        path: qaPath,
        exists,
        source: 'stage-inferred',
      });
    }
  }
  const runnerProcesses = buildRunnerProcesses(state, stageStatuses, logsByKey, warnings);
  const childSessions = buildChildSessions(
    runId,
    runnerProcesses,
    warnings,
    stageStatuses as any,
    pick(state, 'sessions') || {},
    pick(state, 'workflow_config'),
  ) as WorkflowSessionRef[];
  const workflowDisplay = {
    lines: buildWorkflowDisplayLines(state, stageStatuses, childSessions, runnerProcesses, warnings),
  };
  const workflowRoleSummary = buildWorkflowRoleSummary(state, childSessions);
  const dagNodes = pick(state, 'dag_nodes') || {};
  const hasExistingPlanningArtifact = planningArtifacts.some((artifact) => artifact.exists !== false);
  const workflowStatusSummary = buildWorkflowStatusSummary(state, childSessions, artifacts, dagNodes, hasExistingPlanningArtifact);
  const runnerError = String(pick(state, 'error') || '').trim();

  const workflowDag = await buildWorkflowDag({
    projectPath,
    runDirName,
    state,
    changeName,
    childSessions,
    artifacts,
    stageStatuses,
    warnings,
  });

  // Merge DAG review target sessions into workflow-owned session refs so that
  // project-list summaries (which strip workflowDag.nodes) still filter them.
  // Use composite key `${provider}:${sessionId}` to preserve cross-provider ownership.
  const dagSessionMap = new Map<string, WorkflowSessionRef>();
  for (const node of workflowDag?.nodes || []) {
    for (const target of node.reviewTargets || []) {
      if (target.kind === 'session' && target.sessionId) {
        const provider = target.provider || 'codex';
        const compositeKey = `${provider}:${target.sessionId}`;
        if (!dagSessionMap.has(compositeKey)) {
          dagSessionMap.set(compositeKey, { sessionId: target.sessionId, provider });
        }
      }
    }
  }
  const baseOwnedSessions = buildWorkflowOwnedSessionRefs(state);
  const baseOwnedCompositeIds = new Set(baseOwnedSessions.map((s) => `${s.provider || 'codex'}:${s.sessionId}`));
  const workflowOwnedSessions = [
    ...baseOwnedSessions,
    ...Array.from(dagSessionMap.values()).filter((s) => !baseOwnedCompositeIds.has(`${s.provider || 'codex'}:${s.sessionId}`)),
  ];

  const diagnostics = {
    statePath: formatFlowStatePathForDiagnostics(statePath),
    stateMtime: stateStat?.mtime?.toISOString?.() || null,
    rawStatus,
    rawStage,
    woContractVersion: String(pick(state, 'contract_version') || ''),
    woContractOk: true,
    runnerError,
    pathCount: Object.keys(state?.paths || {}).length,
    sessionCount: Object.keys(state?.sessions || {}).length,
    workflowOwnedSessions,
    workflowOwnedSessionIds: workflowOwnedSessions.map((session) => session.sessionId),
    processCount: Array.isArray(state?.processes) ? state.processes.length : runnerProcesses.length,
    warnings,
  };
  const stageInspections = buildStageInspections(state, stageStatuses, childSessions, artifacts, runnerError, diagnostics, workflowDag);

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
    hasUnreadActivity: state.hasUnreadActivity === true || mapRunState(rawStatus) === 'running',
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
