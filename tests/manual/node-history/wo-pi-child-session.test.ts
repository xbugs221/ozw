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
 * - Spec 场景：非 Pi provider role map 同样可路由
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

import { buildWorkflowReadModel } from '../../../backend/domains/workflows/workflow-read-model.ts';

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

test('explicit subagent processes render under their declared workflow stages', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-subagent-process-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-subagent-process');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-subagent-process',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: {},
      processes: [
        {
          stage: 'planning',
          role: 'subagent:planning_context:需求分析员:0',
          provider: 'pi',
          status: 'completed',
          session_id: 'plan-subagent-session',
        },
        {
          stage: 'execution',
          role: 'subagent:implementation_context:代码库侦察员:0',
          provider: 'pi',
          status: 'running',
          session_id: 'implementation-subagent-session',
        },
        {
          stage: 'review_1',
          role: 'subagent:review:目标核对审核员:1',
          provider: 'pi',
          status: 'pending',
          session_id: 'review-subagent-session',
        },
      ],
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-subagent-process',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    assert.deepEqual(
      model.stageStatuses.map((stage) => stage.key),
      ['planning', 'execution', 'review_1'],
      'process stages should create renderable workflow buckets even when state.stages is empty',
    );
    assert.equal(model.childSessions.find((s) => s.id === 'plan-subagent-session')?.stageKey, 'planning');
    assert.equal(model.childSessions.find((s) => s.id === 'implementation-subagent-session')?.stageKey, 'execution');
    assert.equal(model.childSessions.find((s) => s.id === 'review-subagent-session')?.stageKey, 'review_1');
    assert.equal(
      model.stageInspections.find((stage) => stage.stageKey === 'planning')
        ?.substages[0]?.agentSessions.some((session) => session.id === 'plan-subagent-session'),
      true,
    );
    assert.equal(
      model.stageInspections.find((stage) => stage.stageKey === 'review_1')
        ?.substages[0]?.agentSessions.some((session) => session.id === 'review-subagent-session'),
      true,
    );
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('sessions-only subagent context roles infer stage instead of falling back to execution', async () => {
  const projectPath = path.join(os.tmpdir(), `ozw-subagent-sessions-${Date.now()}`);
  const runDir = path.join(projectPath, '.wo', 'runs', 'run-subagent-sessions');
  const statePath = path.join(runDir, 'state.json');

  try {
    await writeWoState(runDir, {
      run_id: 'run-subagent-sessions',
      contract_version: 'v1',
      status: 'running',
      stage: 'execution',
      stages: {},
      sessions: {
        'pi:subagent:planning_context:需求分析员:0': 'plan-context-session',
        'pi:subagent:implementation_context:代码库侦察员:0': 'implementation-context-session',
        'pi:subagent:review:目标核对审核员:2': 'review-round-two-session',
      },
      paths: {},
    });

    const stat = await fs.stat(statePath);
    const stateObj = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const model = await buildWorkflowReadModel({
      projectPath,
      runDirName: 'run-subagent-sessions',
      state: stateObj,
      statePath,
      stateStat: stat,
    });

    const planningSession = model.childSessions.find((s) => s.id === 'plan-context-session');
    const implementationSession = model.childSessions.find((s) => s.id === 'implementation-context-session');
    assert.equal(planningSession?.stageKey, 'planning');
    assert.equal(implementationSession?.stageKey, 'execution');
    assert.equal(model.childSessions.find((s) => s.id === 'review-round-two-session')?.stageKey, 'review_2');
    assert.ok(
      model.stageStatuses.some((stage) => stage.key === 'planning'),
      'sessions-only planning subagents should create a planning stage row',
    );
    assert.ok(
      model.stageStatuses.some((stage) => stage.key === 'review_2'),
      'sessions-only review subagents should create the requested review stage row',
    );
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

test('opencode:executor generates child session with correct provider', async () => {
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

    const ocChild = model.childSessions.find((s) => s.id === 'oc-thread-1');
    assert.ok(ocChild, 'opencode:executor should be in childSessions');
    assert.equal(ocChild.provider, 'opencode');
    assert.equal(ocChild.stageKey, 'execution');

    // runnerProcesses must be empty for sessions-only
    assert.deepEqual(model.runnerProcesses, []);
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});
