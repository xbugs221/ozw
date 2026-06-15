/**
 * PURPOSE: Project runner state metadata and warnings into frontend-safe workflow
 * diagnostics without exposing raw state parsing to UI code.
 */
import type { Stats } from 'node:fs';
import { formatFlowStatePathForDiagnostics } from '../flow-runtime-paths.js';

type AnyRecord = Record<string, any>;
type WorkflowArtifact = AnyRecord;
type WorkflowSessionRef = AnyRecord;
type RunnerProcess = AnyRecord;
type StageStatus = AnyRecord;


function pick(object: AnyRecord | null | undefined, snakeKey: string): any {
  /** Return a snake_case runner field value. */
  return object?.[snakeKey];
}

export function buildWorkflowDiagnostics({ state, statePath, stateStat, rawStatus, rawStage, runnerError, runnerProcesses, warnings, workflowOwnedSessions }: { state: AnyRecord; statePath: string; stateStat: Stats; rawStatus: string; rawStage: string; runnerError: string; runnerProcesses: RunnerProcess[]; warnings: string[]; workflowOwnedSessions: WorkflowSessionRef[] }) {
  /** Build the stable diagnostics object consumed by workflow detail views. */
  return {
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
}
