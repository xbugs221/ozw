// @ts-nocheck -- Proposal tests execute through tsx against current source.
/**
 * PURPOSE: Lock the business contract for wo batch proposal visibility so
 * appended but not-yet-started changes remain visible in ozw workflow lists.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  listBatchReadModels,
  listWorkflowReadModels,
} from '../../../backend/domains/workflows/workflow-read-model.ts';
import {
  resolveFlowBatchesRoot,
  resolveFlowRunsRoot,
} from '../../../backend/domains/workflows/flow-runtime-paths.ts';
import {
  buildWorkflowOverviewGroups,
} from '../../../frontend/utils/workflowGroups.ts';

async function withTempWoProject(callback) {
  /**
   * Create an isolated project and XDG state home so the test uses the same
   * batch and run discovery paths as real ozw workflow reads.
   */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-wo-batch-proposals-'));
  const projectPath = path.join(tempRoot, 'project');
  const stateHome = path.join(tempRoot, 'state');
  const originalXdgStateHome = process.env.XDG_STATE_HOME;
  await fs.mkdir(projectPath, { recursive: true });
  process.env.XDG_STATE_HOME = stateHome;
  try {
    await callback({ projectPath });
  } finally {
    if (originalXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalXdgStateHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function writeBatchState(projectPath, state) {
  /**
   * Persist one wo batch state file with the real changes/run_ids map shape.
   */
  const batchDir = path.join(resolveFlowBatchesRoot(projectPath), state.batch_id);
  await fs.mkdir(batchDir, { recursive: true });
  await fs.writeFile(path.join(batchDir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
}

async function writeRunState(projectPath, runId, changeName, status = 'running') {
  /**
   * Persist one real run state so ozw can attach batch context to started
   * proposals without inventing workflow details for pending proposals.
   */
  const runDir = path.join(resolveFlowRunsRoot(projectPath), runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
    run_id: runId,
    change_name: changeName,
    status,
    stage: status === 'done' ? 'archive' : 'execution',
    stages: {
      execution: status === 'done' ? 'completed' : 'running',
      archive: status === 'done' ? 'completed' : 'pending',
    },
  }, null, 2), 'utf8');
}

function workflowFixture(id, title, overrides = {}) {
  /**
   * Build the minimum ProjectWorkflow shape consumed by the shared grouping
   * utility while keeping assertions focused on batch semantics.
   */
  return {
    id,
    runId: id,
    title,
    objective: title,
    stage: 'execution',
    runState: 'running',
    updatedAt: '2026-06-01T12:00:00.000Z',
    stageStatuses: [{ key: 'execution', label: '执行', status: 'active' }],
    artifacts: [],
    childSessions: [],
    ...overrides,
  };
}

test('batch read model exposes appended pending proposals from changes', async () => {
  await withTempWoProject(async ({ projectPath }) => {
    await writeBatchState(projectPath, {
      batch_id: 'batch-appended',
      status: 'running',
      current_index: 1,
      changes: ['change-a', 'change-b', 'change-c'],
      run_ids: {
        'change-a': 'run-a',
        'change-b': 'run-b',
      },
    });
    await writeRunState(projectPath, 'run-a', 'change-a', 'done');
    await writeRunState(projectPath, 'run-b', 'change-b', 'running');

    const [batch] = await listBatchReadModels(projectPath);

    assert.equal(batch.total, 3);
    assert.deepEqual(
      batch.items.map((item) => item.changeName),
      ['change-a', 'change-b', 'change-c'],
    );
    assert.deepEqual(
      batch.items.map((item) => item.runId || null),
      ['run-a', 'run-b', null],
    );
    assert.equal(batch.items[2].status, 'pending');

    const workflows = await listWorkflowReadModels(projectPath);
    assert.equal(workflows.length, 2, 'only started proposals have real workflow detail models');
  });
});

test('workflow grouping renders pending batch changes beside started runs', () => {
  const groups = buildWorkflowOverviewGroups(
    [
      workflowFixture('run-a', 'change-a', { batchId: 'batch-appended', batchIndex: 1, batchTotal: 3 }),
      workflowFixture('run-b', 'change-b', { batchId: 'batch-appended', batchIndex: 2, batchTotal: 3 }),
    ],
    [{
      id: 'batch-appended',
      displayId: 'b1',
      status: 'running',
      currentIndex: 1,
      displayCurrentIndex: 2,
      total: 3,
      runIds: ['run-a', 'run-b'],
      changes: ['change-a', 'change-b', 'change-c'],
      items: [
        { changeName: 'change-a', batchIndex: 1, status: 'completed', runId: 'run-a' },
        { changeName: 'change-b', batchIndex: 2, status: 'running', runId: 'run-b' },
        { changeName: 'change-c', batchIndex: 3, status: 'pending' },
      ],
    }],
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, '批量任务 b1');
  assert.equal(groups[0].workflows.length, 3);
  assert.deepEqual(groups[0].workflows.map((workflow) => workflow.title), ['change-a', 'change-b', 'change-c']);
  assert.equal(groups[0].workflows[2].runState, 'pending');
  assert.equal(groups[0].workflows[2].runId, undefined);
});

test('standalone workflow is grouped as a one-item batch instead of single task', () => {
  const [group] = buildWorkflowOverviewGroups([
    workflowFixture('run-one', 'single-change', {
      runState: 'completed',
      stageStatuses: [{ key: 'archive', label: '归档', status: 'completed' }],
    }),
  ]);

  assert.match(group.label, /^批量任务/);
  assert.notEqual(group.label, '单次任务');
  assert.equal(group.workflows.length, 1);
  assert.equal(group.batch?.total || group.workflows.length, 1);
  assert.equal(group.isSyntheticSingle, false);
});
