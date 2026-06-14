/**
 * PURPOSE: Build shared workflow group view models so the project overview and
 * sidebar both present batched oz flow runs as one business workflow entry.
 */
import type { ProjectWorkflow, WorkflowBatchInfo, WorkflowBatchItem } from '../types/app';

export type WorkflowOverviewGroup = {
  id: string;
  batch: WorkflowBatchInfo | null;
  workflows: ProjectWorkflow[];
  label: string;
  isSyntheticSingle: boolean;
  latestUpdatedAt: number;
  isCompleted: boolean;
};

/**
 * Resolve the effective timestamp for workflow recency sorting.
 */
export function getWorkflowUpdatedAt(workflow: ProjectWorkflow): number {
  /**
   * PURPOSE: Prefer runner activity time and keep invalid timestamps at the
   * end of recency lists.
   */
  const timestamp = new Date(String(workflow.updatedAt || 0)).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Decide whether a workflow has reached a terminal completed state.
 */
export function isWorkflowCompleted(workflow: ProjectWorkflow): boolean {
  /**
   * PURPOSE: Treat oz flow archive as the business terminal stage while
   * preserving legacy verification-only runs that predate qa/archive.
   */
  const stageStatusMap = new Map((workflow.stageStatuses || []).map((stage) => [stage.key, stage.status]));
  const hasV120TerminalStages = stageStatusMap.has('qa') || stageStatusMap.has('archive');
  return workflow.runState === 'completed'
    || workflow.stage === 'done'
    || stageStatusMap.get('archive') === 'completed'
    || (!hasV120TerminalStages && stageStatusMap.get('verification') === 'completed');
}

/**
 * Convert a batch item without a started run into a read-only placeholder card.
 */
function buildPendingWorkflowPlaceholder(batch: WorkflowBatchInfo, item: WorkflowBatchItem): ProjectWorkflow {
  /**
   * PURPOSE: Keep appended oz flow proposals visible without inventing a workflow
   * detail route or run state file that does not exist yet.
   */
  return {
    id: `${batch.id}-pending-${item.batchIndex}`,
    title: item.changeName,
    objective: item.changeName,
    stage: 'pending',
    runState: 'pending',
    updatedAt: '',
    stageStatuses: [{ key: 'pending', label: '待启动', status: 'pending' }],
    artifacts: [],
    childSessions: [],
    batchId: batch.id,
    batchDisplayId: batch.displayId,
    batchIndex: item.batchIndex,
    batchTotal: batch.total,
    batchStatus: batch.status,
    isPendingBatchItem: true,
  };
}

/**
 * Merge real run workflows with pending batch proposal items.
 */
function buildBatchWorkflows(batch: WorkflowBatchInfo | null, batchWorkflows: ProjectWorkflow[]): ProjectWorkflow[] {
  /**
   * PURPOSE: Use oz flow batch changes as the complete proposal order while
   * preserving real run read models wherever they exist.
   */
  const workflowByRunId = new Map(
    batchWorkflows
      .map((workflow) => [String(workflow.runId || workflow.id || '').trim(), workflow] as const)
      .filter(([runId]) => Boolean(runId)),
  );
  if (!batch?.items?.length) {
    return [...batchWorkflows].sort((left, right) => (left.batchIndex || 0) - (right.batchIndex || 0));
  }

  return batch.items.map((item) => {
    const runWorkflow = item.runId ? workflowByRunId.get(String(item.runId)) : null;
    return runWorkflow || buildPendingWorkflowPlaceholder(batch, item);
  });
}

/**
 * Create a one-item batch shell for standalone oz flow runs.
 */
function buildStandaloneBatch(workflow: ProjectWorkflow): WorkflowBatchInfo {
  /**
   * PURPOSE: Present single-proposal oz flow workflows as the same business concept
   * as batches, with total one and progress based on completion.
   */
  const completed = isWorkflowCompleted(workflow);
  return {
    id: `single-${workflow.id}`,
    displayId: '1/1',
    status: completed ? 'completed' : 'running',
    currentIndex: completed ? 0 : -1,
    displayCurrentIndex: completed ? 1 : 0,
    total: 1,
    runIds: [String(workflow.runId || workflow.id)],
    changes: [workflow.title],
    items: [{
      changeName: workflow.title,
      batchIndex: 1,
      status: completed ? 'completed' : 'running',
      runId: String(workflow.runId || workflow.id),
    }],
  };
}

/**
 * Build one visual hierarchy for batched and standalone workflows.
 */
export function buildWorkflowOverviewGroups(
  workflows: ProjectWorkflow[],
  batches: WorkflowBatchInfo[] = [],
): WorkflowOverviewGroup[] {
  /**
   * PURPOSE: Fold multiple run read models with the same batch id into one
   * user-facing workflow group while preserving standalone run navigation.
   */
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const batchedRuns = new Map<string, ProjectWorkflow[]>();
  const groups: WorkflowOverviewGroup[] = [];
  const groupedBatchIds = new Set<string>();

  for (const workflow of workflows) {
    const batchId = String(workflow.batchId || '').trim();
    if (!batchId) {
      const batch = buildStandaloneBatch(workflow);
      groups.push({
        id: batch.id,
        batch,
        workflows: [workflow],
        label: '批量任务 1/1',
        isSyntheticSingle: false,
        latestUpdatedAt: getWorkflowUpdatedAt(workflow),
        isCompleted: isWorkflowCompleted(workflow),
      });
      continue;
    }

    if (!batchedRuns.has(batchId)) {
      batchedRuns.set(batchId, []);
    }
    batchedRuns.get(batchId)!.push(workflow);
  }

  for (const [batchId, batchWorkflows] of batchedRuns) {
    const batch = batchById.get(batchId) || null;
    groupedBatchIds.add(batchId);
    const sortedWorkflows = buildBatchWorkflows(batch, batchWorkflows);
    const latestUpdatedAt = Math.max(...sortedWorkflows.map(getWorkflowUpdatedAt), 0);
    groups.push({
      id: batchId,
      batch,
      workflows: sortedWorkflows,
      label: `批量任务 ${batch?.displayId || batch?.id || batchId}`,
      isSyntheticSingle: false,
      latestUpdatedAt,
      isCompleted: batch?.status === 'completed' || sortedWorkflows.every(isWorkflowCompleted),
    });
  }

  for (const batch of batches) {
    if (groupedBatchIds.has(batch.id) || !batch.items?.length) {
      continue;
    }
    const pendingWorkflows = buildBatchWorkflows(batch, []);
    groups.push({
      id: batch.id,
      batch,
      workflows: pendingWorkflows,
      label: `批量任务 ${batch.displayId || batch.id}`,
      isSyntheticSingle: false,
      latestUpdatedAt: 0,
      isCompleted: batch.status === 'completed' && pendingWorkflows.every(isWorkflowCompleted),
    });
  }

  return groups.sort((left, right) => (
    right.latestUpdatedAt - left.latestUpdatedAt
    || left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' })
  ));
}

/**
 * Pick the run a grouped workflow row should open.
 */
export function getWorkflowGroupNavigationTarget(group: WorkflowOverviewGroup): ProjectWorkflow | null {
  /**
   * PURPOSE: Keep grouped sidebar rows navigable by opening the freshest run in
   * the batch when there is no batch-level detail route.
   */
  return [...group.workflows]
    .filter((workflow) => workflow.runId || !workflow.isPendingBatchItem)
    .sort((left, right) => (
      getWorkflowUpdatedAt(right) - getWorkflowUpdatedAt(left)
      || (right.batchIndex || 0) - (left.batchIndex || 0)
    ))[0] || null;
}
