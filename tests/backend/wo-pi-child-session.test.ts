// @ts-nocheck -- Test isolation: strict types deferred.
/**
 * PURPOSE: Verify wo read model generates provider-aware child sessions from
 * sessions-only state.json (no explicit processes), and deduplicates when
 * explicit processes and sessions role map share the same session id.
 *
 * Covers:
 * - Spec 场景：Pi executor sessions-only 状态可进入子会话
 * - Spec 场景：sessions-only 状态不伪造进程
 * - Spec 场景：explicit process 与 role session 去重
 * - Spec 场景：只接受 Codex/Pi provider role map
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

import { buildWorkflowReadModel } from '../../backend/domains/workflows/workflow-read-model.ts';

async function writeWoState(runDir, state) {
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, 'state.json'),
    JSON.stringify(state, null, 2),
    'utf8',
  );
}

test('sessions-only pi:executor generates child session with correct provider and stage', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-pi-child-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-pi-exec');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-pi-exec',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      sessions: {
        'pi:executor': 'pi-thread-1',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-pi-exec',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    // sessions-only: childSessions must include the Pi executor session
    const piChild = model.childSessions.find((s) => s.id === 'pi-thread-1');
    assert.ok(piChild, 'pi:executor should be in childSessions');
    assert.equal(piChild.provider, 'pi');
    assert.equal(piChild.role, 'executor');
    assert.equal(piChild.stageKey, 'execution');
    assert.equal(piChild.address, 'execution');

    // sessions-only: runnerProcesses must be empty
    assert.deepEqual(model.runnerProcesses, []);

    // No unknown stage warnings
    assert.ok(!model.diagnostics.warnings.some((w) => w.includes('Unknown runner stage')));
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('sessions-only multi-provider sessions all generate child sessions', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-multi-prov-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-multi');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-multi',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running', review_1: 'running' },
      sessions: {
        'codex:executor': 'codex-exec-1',
        'pi:executor': 'pi-exec-1',
        'codex:reviewer': 'codex-review-1',
        'pi:reviewer': 'pi-review-1',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-multi',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    // All four session ids should be in childSessions
    const ids = model.childSessions.map((s) => s.id);
    assert.ok(ids.includes('codex-exec-1'), 'codex:executor should be in childSessions');
    assert.ok(ids.includes('pi-exec-1'), 'pi:executor should be in childSessions');
    assert.ok(ids.includes('codex-review-1'), 'codex:reviewer should be in childSessions');
    assert.ok(ids.includes('pi-review-1'), 'pi:reviewer should be in childSessions');

    // Each child session should have correct provider
    const codexExec = model.childSessions.find((s) => s.id === 'codex-exec-1');
    assert.equal(codexExec.provider, 'codex');
    assert.equal(codexExec.stageKey, 'execution');

    const piExec = model.childSessions.find((s) => s.id === 'pi-exec-1');
    assert.equal(piExec.provider, 'pi');
    assert.equal(piExec.stageKey, 'execution');

    const codexReview = model.childSessions.find((s) => s.id === 'codex-review-1');
    assert.equal(codexReview.provider, 'codex');
    assert.equal(codexReview.stageKey, 'review_1');

    const piReview = model.childSessions.find((s) => s.id === 'pi-review-1');
    assert.equal(piReview.provider, 'pi');
    assert.equal(piReview.stageKey, 'review_1');

    // Route path uniqueness: same-stage sessions with different providers
    // must have distinct routePaths so the browser can resolve the correct one.
    const routePaths = model.childSessions.map((s) => s.routePath);
    const uniqueRoutes = new Set(routePaths);
    assert.equal(uniqueRoutes.size, 4, 'All four child sessions must have distinct routePaths');

    // First provider for each stage claims the stage address.
    // Order depends on Object.entries iteration (insertion order).
    assert.equal(codexExec.address, 'execution');
    assert.ok(codexExec.routePath.endsWith('/sessions/execution'));
    assert.equal(piExec.address, 'by-id/pi-exec-1');
    assert.ok(piExec.routePath.endsWith('/sessions/by-id/pi-exec-1'));

    assert.equal(codexReview.address, 'review_1');
    assert.ok(codexReview.routePath.endsWith('/sessions/review_1'));
    assert.equal(piReview.address, 'by-id/pi-review-1');
    assert.ok(piReview.routePath.endsWith('/sessions/by-id/pi-review-1'));
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('explicit process and sessions role map deduplicate shared session id', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-dedup-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-dedup');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-dedup',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      sessions: {
        'pi:executor': 'pi-thread-1',
      },
      processes: [
        { stage: 'execution', role: 'executor', status: 'running', session_id: 'pi-thread-1', pid: 12345 },
      ],
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-dedup',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    // childSessions should have exactly one entry for pi-thread-1
    const piChildren = model.childSessions.filter((s) => s.id === 'pi-thread-1');
    assert.equal(piChildren.length, 1, 'pi-thread-1 should appear exactly once in childSessions');

    // runnerProcesses should contain the process entry
    assert.equal(model.runnerProcesses.length, 1);
    assert.equal(model.runnerProcesses[0].pid, 12345);
    assert.equal(model.runnerProcesses[0].sessionId, 'pi-thread-1');

    // The child session should still have correct provider
    const piChild = piChildren[0];
    assert.equal(piChild.provider, 'pi');
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('stage-key sessions (review_1, fix_1) generate child sessions', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-stage-keys-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-stages');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-stages',
      contract_version: 'v1',
      status: 'running',
      stage: 'fix_1',
      stages: { execution: 'completed', review_1: 'completed', fix_1: 'running' },
      sessions: {
        review_1: 'review-session-1',
        fix_1: 'fix-session-1',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-stages',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    const reviewChild = model.childSessions.find((s) => s.id === 'review-session-1');
    assert.ok(reviewChild, 'review_1 session should be in childSessions');
    assert.equal(reviewChild.stageKey, 'review_1');
    assert.equal(reviewChild.role, 'review_1');

    const fixChild = model.childSessions.find((s) => s.id === 'fix-session-1');
    assert.ok(fixChild, 'fix_1 session should be in childSessions');
    assert.equal(fixChild.stageKey, 'fix_1');
    assert.equal(fixChild.role, 'fix_1');
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('legacy opencode session refs are ignored by workflow child session routing', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-opencode-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-oc');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-oc',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      sessions: {
        'opencode:executor': 'oc-thread-1',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-oc',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    assert.equal(
      model.childSessions.some((s) => s.id === 'oc-thread-1'),
      false,
      'opencode:executor must not be exposed as a clickable child session',
    );
    assert.equal(
      model.diagnostics.workflowOwnedSessions.some((s) => s.sessionId === 'oc-thread-1'),
      false,
      'opencode:executor must not be treated as an owned workflow session',
    );
    assert.equal(
      model.workflowRoleSummary.rows.some((row) => row.sessionRef?.sessionId === 'oc-thread-1'),
      false,
      'opencode:executor must not be linked from workflow role summary',
    );

    // runnerProcesses must be empty for sessions-only
    assert.deepEqual(model.runnerProcesses, []);
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('explicit process claims address so sessions-only different provider uses by-id', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-explicit-claim-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-claim');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-claim',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      processes: [
        { stage: 'execution', role: 'executor', status: 'running', session_id: 'codex-exec', pid: 100 },
      ],
      sessions: {
        'codex:executor': 'codex-exec',
        'pi:executor': 'pi-exec',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-claim',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    const ids = model.childSessions.map((s) => s.id);
    assert.ok(ids.includes('codex-exec'), 'codex-exec should be in childSessions');
    assert.ok(ids.includes('pi-exec'), 'pi-exec should be in childSessions');
    assert.equal(ids.length, 2, 'Exactly two child sessions');

    // codex-exec from explicit process should own the execution address
    const codexChild = model.childSessions.find((s) => s.id === 'codex-exec');
    assert.equal(codexChild.address, 'execution');
    assert.ok(codexChild.routePath.endsWith('/sessions/execution'));
    assert.equal(codexChild.provider, 'codex');

    // pi-exec from sessions-only should use by-id because execution is claimed
    const piChild = model.childSessions.find((s) => s.id === 'pi-exec');
    assert.equal(piChild.address, 'by-id/pi-exec');
    assert.ok(piChild.routePath.endsWith('/sessions/by-id/pi-exec'));
    assert.equal(piChild.provider, 'pi');

    assert.notEqual(codexChild.routePath, piChild.routePath,
      'Explicit and sessions-only different-provider sessions must have distinct routePaths');

    assert.equal(model.runnerProcesses.length, 1);
    assert.equal(model.runnerProcesses[0].sessionId, 'codex-exec');
    assert.equal(model.runnerProcesses[0].pid, 100);
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('execution subagent process does not claim execution stage session link', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-exec-subagent-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-exec-subagent');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-exec-subagent',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      processes: [
        {
          stage: 'execution',
          role: 'subagent:implementation_context:1',
          status: 'running',
          session_id: 'implementation-subagent-thread',
          pid: 101,
        },
      ],
      sessions: {
        'codex:executor': 'main-executor-thread',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-exec-subagent',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    const executorChild = model.childSessions.find((s) => s.id === 'main-executor-thread');
    assert.ok(executorChild, 'main executor session should be routable');
    assert.equal(executorChild.address, 'execution');
    assert.ok(executorChild.routePath.endsWith('/sessions/execution'));

    const subagentChild = model.childSessions.find((s) => s.id === 'implementation-subagent-thread');
    assert.ok(subagentChild, 'execution subagent process should still be routable');
    assert.equal(subagentChild.address, 'execution/subagent:implementation_context:1');
    assert.ok(subagentChild.routePath.endsWith('/sessions/execution/subagent%3Aimplementation_context%3A1'));

    const executionLine = model.workflowDisplay.lines.find((line) => line.id === 'execution');
    assert.equal(executionLine?.sessionRef?.sessionId, 'main-executor-thread',
      '执行阶段 display line must link the executor session, not the subagent process');

    const executorRow = model.workflowRoleSummary.rows.find((row) => row.key === 'executor');
    assert.equal(executorRow?.sessionRef?.sessionId, 'main-executor-thread',
      'executor role row must link the main executor session');
    assert.equal(executorRow?.sessionRef?.routePath, executorChild.routePath);
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('reviewer/fixer role sessions map to current multi-round stages, not review_1/fix_1', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-multi-round-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-rounds');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-rounds',
      contract_version: 'v1',
      status: 'running',
      stage: 'review_6',
      stages: {
        execution: 'completed',
        review_1: 'completed',
        fix_1: 'completed',
        review_2: 'completed',
        fix_2: 'completed',
        review_3: 'completed',
        fix_3: 'completed',
        review_4: 'completed',
        fix_4: 'completed',
        review_5: 'completed',
        fix_5: 'completed',
        review_6: 'running',
      },
      sessions: {
        'codex:reviewer': 'codex-reviewer-latest',
        'pi:fixer': 'pi-fixer-latest',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-rounds',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    // Reviewer must map to the active review_N stage (review_6), not review_1
    const reviewerChild = model.childSessions.find((s) => s.id === 'codex-reviewer-latest');
    assert.ok(reviewerChild, 'codex:reviewer should be in childSessions');
    assert.equal(reviewerChild.stageKey, 'review_6',
      'Reviewer must map to active review_6, not review_1');
    assert.equal(reviewerChild.address, 'review_6');
    assert.equal(reviewerChild.provider, 'codex');

    // Fixer must map to the latest completed fix_N (fix_5), not fix_1
    const fixerChild = model.childSessions.find((s) => s.id === 'pi-fixer-latest');
    assert.ok(fixerChild, 'pi:fixer should be in childSessions');
    assert.equal(fixerChild.stageKey, 'fix_5',
      'Fixer must map to latest completed fix_5, not fix_1');
    assert.equal(fixerChild.address, 'fix_5');
    assert.equal(fixerChild.provider, 'pi');

    // Stage inspections for review_6 should contain the reviewer session
    const review6Inspection = model.stageInspections.find((s) => s.stageKey === 'review_6');
    assert.ok(review6Inspection, 'Stage inspection for review_6 should exist');
    const review6AgentIds = (review6Inspection.substages?.[0]?.agentSessions || []).map((a) => a.id);
    assert.ok(review6AgentIds.includes('codex-reviewer-latest'),
      'review_6 agentSessions must include codex-reviewer-latest');

    // Stage inspections for fix_5 should contain the fixer session
    const fix5Inspection = model.stageInspections.find((s) => s.stageKey === 'fix_5');
    assert.ok(fix5Inspection, 'Stage inspection for fix_5 should exist');
    const fix5AgentIds = (fix5Inspection.substages?.[0]?.agentSessions || []).map((a) => a.id);
    assert.ok(fix5AgentIds.includes('pi-fixer-latest'),
      'fix_5 agentSessions must include pi-fixer-latest');

    // review_1 should NOT have the reviewer session
    const review1Inspection = model.stageInspections.find((s) => s.stageKey === 'review_1');
    if (review1Inspection) {
      const r1AgentIds = (review1Inspection.substages?.[0]?.agentSessions || []).map((a) => a.id);
      assert.ok(!r1AgentIds.includes('codex-reviewer-latest'),
        'review_1 agentSessions must NOT include reviewer when review_6 is active');
    }
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('fixer maps to active repair_N when no fix_N stage exists', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-repair-round-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-repair');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-repair',
      contract_version: 'v1',
      status: 'running',
      stage: 'repair_3',
      stages: {
        execution: 'completed',
        review_1: 'completed',
        repair_1: 'completed',
        review_2: 'completed',
        repair_2: 'completed',
        review_3: 'completed',
        repair_3: 'running',
      },
      sessions: {
        'pi:fixer': 'pi-fixer-repair',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-repair',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    const fixerChild = model.childSessions.find((s) => s.id === 'pi-fixer-repair');
    assert.ok(fixerChild, 'pi:fixer should be in childSessions');
    assert.equal(fixerChild.stageKey, 'repair_3',
      'Fixer must map to active repair_3 when no fix_N stages exist');
    assert.equal(fixerChild.address, 'repair_3');
    assert.equal(fixerChild.provider, 'pi');
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});
