/**
 * PURPOSE: Project workflow-owned sessions from oz flow state, runner process
 * rows, and DAG review targets into provider-aware read-model session refs.
 */
import { acceptedProviderFromSessionKey, buildChildSessions } from './session-refs.js';
import { pick, type WorkflowJsonRecord, type WorkflowRunnerProcess, type WorkflowSessionRef, type WorkflowStageStatus, type WorkflowState } from './workflow-state-schema.js';

type RunnerProcess = WorkflowRunnerProcess;
type StageStatus = WorkflowStageStatus;

function buildWorkflowOwnedSessionRefs(state: WorkflowState): WorkflowSessionRef[] {
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



export function buildWorkflowChildSessions(runId: string, runnerProcesses: RunnerProcess[], warnings: string[], stageStatuses: StageStatus[], state: WorkflowState): WorkflowSessionRef[] {
  /** Build child session rows from state.sessions and explicit runner processes. */
  return buildChildSessions(runId, runnerProcesses, warnings, stageStatuses, state.sessions || {}, state.workflow_config) as WorkflowSessionRef[];
}

export function buildWorkflowOwnedSessions(state: WorkflowState, workflowDag: WorkflowJsonRecord): WorkflowSessionRef[] {
  /** Merge direct state session refs with DAG review target session refs. */
  const dagSessionMap = new Map<string, WorkflowSessionRef>();
  const nodes = Array.isArray(workflowDag?.nodes) ? workflowDag.nodes : [];
  for (const node of nodes) {
    for (const target of node.reviewTargets || []) {
      if (target.kind === 'session' && target.sessionId) {
        const provider = target.provider || 'codex';
        const compositeKey = provider + ':' + target.sessionId;
        if (!dagSessionMap.has(compositeKey)) dagSessionMap.set(compositeKey, { sessionId: target.sessionId, provider });
      }
    }
  }
  const baseOwnedSessions = buildWorkflowOwnedSessionRefs(state);
  const baseOwnedCompositeIds = new Set(baseOwnedSessions.map((session) => (session.provider || 'codex') + ':' + session.sessionId));
  return [...baseOwnedSessions, ...Array.from(dagSessionMap.values()).filter((session) => !baseOwnedCompositeIds.has((session.provider || 'codex') + ':' + session.sessionId))];
}
