// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify the wo read model correctly handles batch state files,
 * five-stage role summary with fixer, provider-prefixed sessions,
 * and run-directory fixed artifact scanning.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildBatchReadModel,
  buildBatchContextMap,
  buildWorkflowReadModel,
  listBatchReadModels,
  listWorkflowReadModels,
} from '../../../backend/domains/workflows/workflow-read-model.ts';
import { resolveFlowBatchesRoot, resolveFlowRunsRoot } from '../../../backend/domains/workflows/flow-runtime-paths.ts';

async function withTestEnv(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-batch-test-'));
  const projectPath = path.join(tempRoot, 'project');
  const homeDir = path.join(tempRoot, 'home');
  const stateHome = path.join(tempRoot, 'state');
  await fs.mkdir(projectPath, { recursive: true });
  const originalHome = process.env.HOME;
  const originalXdgStateHome = process.env.XDG_STATE_HOME;
  process.env.HOME = homeDir;
  process.env.XDG_STATE_HOME = stateHome;
  try {
    await callback({ tempRoot, projectPath });
  } finally {
    process.env.HOME = originalHome;
    if (originalXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalXdgStateHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test('batch read model constructs summary from batch state.json', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const batchesRoot = resolveFlowBatchesRoot(projectPath);
    const batchDir = path.join(batchesRoot, 'batch-001');
    await fs.mkdir(batchDir, { recursive: true });
    await fs.writeFile(path.join(batchDir, 'state.json'), JSON.stringify({
      batch_id: 'batch-001',
      status: 'running',
      current_index: 1,
      changes: ['change-a', 'change-b'],
      run_ids: {
        'change-a': 'run-a',
        'change-b': 'run-b',
      },
      error: '',
    }));

    const batches = await listBatchReadModels(projectPath);
    assert.equal(batches.length, 1);
    const batch = batches[0];
    assert.equal(batch.id, 'batch-001');
    assert.equal(batch.status, 'running');
    assert.equal(batch.currentIndex, 1);
    assert.equal(batch.displayCurrentIndex, 2);
    assert.equal(batch.total, 2);
    assert.deepEqual(batch.runIds, ['run-a', 'run-b']);
    assert.deepEqual(batch.changes, ['change-a', 'change-b']);
    assert.equal(batch.displayId, 'b1');
    assert.equal(batch.error, undefined);
  });
});

test('batch context map links runs to batch metadata', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const batchesRoot = resolveFlowBatchesRoot(projectPath);
    const batchDir = path.join(batchesRoot, 'batch-001');
    await fs.mkdir(batchDir, { recursive: true });
    await fs.writeFile(path.join(batchDir, 'state.json'), JSON.stringify({
      batch_id: 'batch-001',
      status: 'running',
      current_index: 1,
      changes: ['change-a', 'change-b'],
      run_ids: {
        'change-a': 'run-a',
        'change-b': 'run-b',
      },
    }));

    const batches = await listBatchReadModels(projectPath);
    const contextMap = buildBatchContextMap(batches);
    assert.equal(Object.keys(contextMap).length, 2);

    const runACtx = contextMap['run-a'];
    assert.equal(runACtx.batchId, 'batch-001');
    assert.equal(runACtx.batchDisplayId, 'b1');
    assert.equal(runACtx.batchIndex, 1);
    assert.equal(runACtx.batchTotal, 2);
    assert.equal(runACtx.batchStatus, 'running');

    const runBCtx = contextMap['run-b'];
    assert.equal(runBCtx.batchIndex, 2);
  });
});

test('runs get batch context attached from batch state', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const batchesRoot = resolveFlowBatchesRoot(projectPath);
    const batchDir = path.join(batchesRoot, 'batch-001');
    await fs.mkdir(batchDir, { recursive: true });
    await fs.writeFile(path.join(batchDir, 'state.json'), JSON.stringify({
      batch_id: 'batch-001',
      status: 'running',
      current_index: 1,
      changes: ['change-a', 'change-b'],
      run_ids: {
        'change-a': 'run-a',
        'change-b': 'run-b',
      },
    }));

    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDirA = path.join(runsRoot, 'run-a');
    await fs.mkdir(runDirA, { recursive: true });
    await fs.writeFile(path.join(runDirA, 'state.json'), JSON.stringify({
      run_id: 'run-a',
      change_name: 'change-a',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
    }));

    const workflows = await listWorkflowReadModels(projectPath);
    assert.equal(workflows.length, 1);
    const wf = workflows[0];
    assert.equal(wf.runId, 'run-a');
    assert.equal(wf.batchId, 'batch-001');
    assert.equal(wf.batchDisplayId, 'b1');
    assert.equal(wf.batchIndex, 1);
    assert.equal(wf.batchTotal, 2);
    assert.equal(wf.batchStatus, 'running');
  });
});

test('ungrouped runs do not have batch context', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-standalone');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-standalone',
      change_name: 'standalone-change',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
    }));

    const workflows = await listWorkflowReadModels(projectPath);
    assert.equal(workflows.length, 1);
    assert.equal(workflows[0].batchId, undefined);
    assert.equal(workflows[0].batchDisplayId, undefined);
  });
});

test('five-stage role summary includes fixer with proper count', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-full-stages');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-full-stages',
      change_name: 'change-a',
      status: 'done',
      stage: 'done',
      stages: {
        execution: 'completed',
        review_1: 'completed',
        fix_1: 'completed',
        review_2: 'completed',
        fix_2: 'completed',
        review_3: 'completed',
        archive: 'completed',
      },
      sessions: {
        'codex:executor': 'executor-session',
        'codex:reviewer': 'reviewer-session',
        'codex:fixer': 'fixer-session',
        'codex:archiver': 'archiver-session',
      },
    }));

    const workflows = await listWorkflowReadModels(projectPath);
    const rows = workflows[0].workflowRoleSummary.rows;
    assert.equal(rows.length, 7);

    const executor = rows.find((r) => r.key === 'executor');
    assert.equal(executor.label, '写');
    assert.equal(executor.checkCount, 1);

    const reviewer = rows.find((r) => r.key === 'reviewer');
    assert.equal(reviewer.label, '审');
    assert.equal(reviewer.checkCount, 3);

    const fixer = rows.find((r) => r.key === 'fixer');
    assert.equal(fixer.label, '修');
    assert.equal(fixer.checkCount, 2);
    assert.equal(fixer.sessionRef.sessionId, 'fixer-session');

    const archiver = rows.find((r) => r.key === 'archiver');
    assert.equal(archiver.label, '存');
    assert.equal(archiver.checkCount, 1);
  });
});

test('codex and pi provider links remain visible while legacy opencode is ignored', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-multi-provider');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-multi-provider',
      change_name: 'change-a',
      status: 'done',
      stage: 'done',
      stages: {
        execution: 'completed',
        review_1: 'completed',
        archive: 'completed',
      },
      sessions: {
        'pi:executor': 'pi-executor-session',
        'codex:reviewer': 'codex-reviewer-session',
        'opencode:archiver': 'opencode-archiver-session',
      },
    }));

    const workflows = await listWorkflowReadModels(projectPath);
    const rows = workflows[0].workflowRoleSummary.rows;

    const executor = rows.find((r) => r.key === 'executor');
    assert.equal(executor.sessionRef.sessionId, 'pi-executor-session');
    assert.equal(executor.sessionRef.provider, 'pi');
    assert.equal(executor.sessionRef.unlinked, undefined);

    const reviewer = rows.find((r) => r.key === 'reviewer');
    assert.equal(reviewer.sessionRef.sessionId, 'codex-reviewer-session');

    const archiver = rows.find((r) => r.key === 'archiver');
    assert.equal(archiver.sessionRef, null);
  });
});

test('wo state sessions role map is exposed for manual session filtering', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-sessions-only');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-sessions-only',
      change_name: 'change-a',
      status: 'running',
      stage: 'review_1',
      stages: {
        execution: 'completed',
        review_1: 'running',
      },
      sessions: {
        'codex:executor': 'codex-executor-session',
        'pi:reviewer': 'pi-reviewer-session',
        'opencode:fixer': 'opencode-fixer-session',
      },
    }));

    const workflows = await listWorkflowReadModels(projectPath);
    const diagnostics = workflows[0].runnerDiagnostics;
    assert.deepEqual(diagnostics.workflowOwnedSessionIds, [
      'codex-executor-session',
      'pi-reviewer-session',
    ]);
    assert.deepEqual(diagnostics.workflowOwnedSessions, [
      {
        key: 'codex:executor',
        role: 'executor',
        provider: 'codex',
        sessionId: 'codex-executor-session',
      },
      {
        key: 'pi:reviewer',
        role: 'reviewer',
        provider: 'pi',
        sessionId: 'pi-reviewer-session',
      },
    ]);
  });
});

test('legacy opencode provider sessions from wo state sessions are not exposed as workflow-owned sessions', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-opencode-sessions-only');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-opencode-sessions-only',
      change_name: 'change-a',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      sessions: {
        'opencode:executor': 'opencode-workflow-session',
      },
    }));

    const workflows = await listWorkflowReadModels(projectPath);
    assert.deepEqual(workflows[0].runnerDiagnostics.workflowOwnedSessionIds, []);
    assert.deepEqual(workflows[0].runnerDiagnostics.workflowOwnedSessions, []);
  });
});

test('unknown provider session reference is ignored', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-unknown-provider');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-unknown-provider',
      change_name: 'change-a',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      sessions: {
        'unknown:executor': 'unknown-executor-session',
      },
    }));

    const workflows = await listWorkflowReadModels(projectPath);
    const executorRow = workflows[0].workflowRoleSummary.rows.find((r) => r.key === 'executor');
    assert.equal(executorRow.sessionRef, null);
  });
});

test('run directory fixed artifacts are discovered', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-with-artifacts');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-with-artifacts',
      change_name: 'change-a',
      status: 'done',
      stage: 'done',
      stages: { execution: 'completed', review_1: 'completed', review_2: 'completed', fix_1: 'completed' },
      paths: {},
    }));
    // Create fixed artifact files in the run directory
    await fs.writeFile(path.join(runDir, 'review-1.json'), JSON.stringify({ result: 'pass' }));
    await fs.writeFile(path.join(runDir, 'review-2.json'), JSON.stringify({ result: 'pass' }));
    await fs.writeFile(path.join(runDir, 'fix-1.json'), JSON.stringify({ result: 'applied' }));
    await fs.writeFile(path.join(runDir, 'fix-1.md'), '# 修复说明\n\n已处理审核问题。\n', 'utf8');
    await fs.writeFile(path.join(runDir, 'repair-1.json'), JSON.stringify({ result: 'legacy' }));

    const workflows = await listWorkflowReadModels(projectPath);
    const artifacts = workflows[0].artifacts;
    assert.ok(artifacts.some((a) => a.label === 'review-1.json' && a.stage === 'review_1'));
    assert.ok(artifacts.some((a) => a.label === 'review-2.json' && a.stage === 'review_2'));
    assert.ok(artifacts.some((a) => a.label === 'fix-1.json' && a.stage === 'fix_1'));
    assert.ok(artifacts.some((a) => a.label === 'fix-1.md' && a.stage === 'fix_1'));
    assert.ok(artifacts.some((a) => a.label === 'repair-1.json' && a.stage === 'repair_1'));

    // All scanned artifacts should have absolute paths
    for (const artifact of artifacts.filter((a) => a.source === 'run-dir-scan')) {
      assert.ok(path.isAbsolute(artifact.path), `Expected absolute path for ${artifact.label}`);
      assert.equal(artifact.exists, true);
    }
  });
});

test('fixed artifacts from paths and run dir scan are merged without duplicates', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-path-and-scan');
    await fs.mkdir(runDir, { recursive: true });
    // Create review-1.json via paths
    await fs.writeFile(path.join(runDir, 'review-1.json'), JSON.stringify({ result: 'pass' }));
    await fs.writeFile(path.join(runDir, 'review-2.json'), JSON.stringify({ result: 'pass' }));
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-path-and-scan',
      change_name: 'change-a',
      status: 'done',
      stage: 'done',
      stages: { execution: 'completed', review_1: 'completed' },
      paths: {
        review_1: path.relative(projectPath, path.join(runDir, 'review-1.json')),
      },
    }));

    const workflows = await listWorkflowReadModels(projectPath);
    const review1Artifacts = workflows[0].artifacts.filter((a) => a.label === 'review-1.json');
    // Should be exactly one (from paths, not duplicated by scan)
    assert.equal(review1Artifacts.length, 1);
    // review-2.json should be discovered by scan
    assert.ok(workflows[0].artifacts.some((a) => a.label === 'review-2.json'));
  });
});
