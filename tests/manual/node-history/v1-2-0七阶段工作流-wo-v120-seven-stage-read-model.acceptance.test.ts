// @ts-nocheck -- Proposal acceptance test: execution phase owns final strictness.
/**
 * PURPOSE: Verify ozw reads wo v1.2.0 seven-stage workflow state through the
 * real wo read-model boundary instead of legacy execution/review-only rules.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listWorkflowReadModels } from '../../../backend/domains/workflows/workflow-read-model.ts';
import { resolveFlowRunsRoot } from '../../../backend/domains/workflows/flow-runtime-paths.ts';

async function withTempWoProject(callback) {
  /**
   * Create an isolated project and XDG state root so the test exercises the
   * same user-state run discovery path that ozw uses for real wo runs.
   */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-wo-v120-'));
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

async function writeRunState(projectPath, runId, state) {
  /**
   * Persist one sealed wo state file under the real user-state run root.
   */
  const runRoot = path.join(resolveFlowRunsRoot(projectPath), runId);
  await fs.mkdir(runRoot, { recursive: true });
  await fs.writeFile(
    path.join(runRoot, 'state.json'),
    JSON.stringify({ run_id: runId, ...state }, null, 2),
    'utf8',
  );
}

test('wo v1.2.0 seven-stage state is ordered, labeled, and displayed as the main workflow path', async () => {
  await withTempWoProject(async ({ projectPath }) => {
    await writeRunState(projectPath, 'run-seven-stage', {
      change_name: '56-适配wo-v1.2.0七阶段工作流',
      status: 'running',
      stage: 'qa',
      stages: {
        planning: 'completed',
        acceptance: 'completed',
        execution: 'completed',
        review_1: 'completed',
        fix_1: 'completed',
        review_2: 'completed',
        qa: 'running',
        archive: 'pending',
      },
      sessions: {},
    });

    const [workflow] = await listWorkflowReadModels(projectPath);

    assert.deepEqual(
      workflow.stageStatuses.map((stage) => stage.key),
      ['planning', 'acceptance', 'execution', 'review_1', 'fix_1', 'review_2', 'qa', 'archive'],
    );
    assert.match(workflow.stageStatuses.find((stage) => stage.key === 'acceptance')?.label || '', /验收|计划/);
    assert.match(workflow.stageStatuses.find((stage) => stage.key === 'qa')?.label || '', /QA|验收|测试/i);
    assert.ok(
      !workflow.diagnostics.warnings.some((warning) => /Unknown runner stage: (acceptance|qa)/.test(warning)),
      'acceptance and qa must be known wo v1.2.0 stages',
    );
    assert.deepEqual(
      workflow.workflowDisplay.lines.map((line) => line.text),
      ['planning', 'acceptance', 'start', 'review', '1 fix review', 'qa'],
    );
  });
});

test('acceptance and qa sessions route to their own workflow stage addresses', async () => {
  await withTempWoProject(async ({ projectPath }) => {
    await writeRunState(projectPath, 'run-seven-stage-sessions', {
      change_name: '56-适配wo-v1.2.0七阶段工作流',
      status: 'running',
      stage: 'qa',
      stages: {
        planning: 'completed',
        acceptance: 'completed',
        execution: 'completed',
        qa: 'running',
      },
      sessions: {
        'codex:planner': 'planner-session',
        'codex:acceptance': 'acceptance-session',
        'codex:executor': 'executor-session',
        'codex:qa': 'qa-session',
      },
    });

    const [workflow] = await listWorkflowReadModels(projectPath);
    const acceptanceSession = workflow.childSessions.find((session) => session.id === 'acceptance-session');
    const qaSession = workflow.childSessions.find((session) => session.id === 'qa-session');

    assert.ok(acceptanceSession, 'acceptance session must be exposed as a workflow child session');
    assert.equal(acceptanceSession.stageKey, 'acceptance');
    assert.equal(acceptanceSession.address, 'acceptance');
    assert.equal(acceptanceSession.routePath, '/runs/run-seven-stage-sessions/sessions/acceptance');

    assert.ok(qaSession, 'qa session must be exposed as a workflow child session');
    assert.equal(qaSession.stageKey, 'qa');
    assert.equal(qaSession.address, 'qa');
    assert.equal(qaSession.routePath, '/runs/run-seven-stage-sessions/sessions/qa');
  });
});
