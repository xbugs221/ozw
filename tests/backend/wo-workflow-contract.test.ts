// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify ozw follows the oz flow workflow contract and renders flow
 * display lines from sealed state files.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listOpenSpecChanges } from '../../backend/domains/openspec/oz-client.ts';
import { startGoWorkflowRun } from '../../backend/domains/workflows/go-runner-client.ts';
import { listWorkflowReadModels } from '../../backend/domains/workflows/workflow-read-model.ts';
import { resolveFlowRunsRoot } from '../../backend/domains/workflows/flow-runtime-paths.ts';

async function writeExecutable(filePath, content) {
  /**
   * Create one fake CLI binary on PATH for contract-level workflow tests.
   */
  await fs.writeFile(filePath, content, { mode: 0o755 });
}

async function withFakePath(callback) {
  /**
   * Run a test with only fake oz commands prepended, proving old command
   * names are not required.
   */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-wo-contract-'));
  const binDir = path.join(tempRoot, 'bin');
  const projectPath = path.join(tempRoot, 'project');
  const homeDir = path.join(tempRoot, 'home');
  const stateHome = path.join(tempRoot, 'state');
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(projectPath, { recursive: true });
  const originalPath = process.env.PATH;
  const originalHome = process.env.HOME;
  const originalXdgStateHome = process.env.XDG_STATE_HOME;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
  process.env.HOME = homeDir;
  process.env.XDG_STATE_HOME = stateHome;
  try {
    await callback({ tempRoot, binDir, projectPath });
  } finally {
    process.env.PATH = originalPath;
    process.env.HOME = originalHome;
    if (originalXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalXdgStateHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test('oz list and oz flow run use the current command names and user-state run root', async () => {
  await withFakePath(async ({ binDir, projectPath }) => {
    const fakeRunsRoot = resolveFlowRunsRoot(projectPath);
    await writeExecutable(path.join(binDir, 'oz'), [
      '#!/bin/sh',
      'if [ "$1" = "list" ]; then echo \'{"changes":[{"name":"1-适配wo-oz并展示新版工作流输出"}]}\'; exit 0; fi',
      'if [ "$1" = "flow" ] && [ "$2" = "run" ]; then',
      '  run_id="run-a"',
      `  run_root="${fakeRunsRoot}"`,
      '  mkdir -p "$run_root/$run_id/logs"',
      '  cat > "$run_root/$run_id/state.json" <<JSON',
      '{"run_id":"run-a","change_name":"1-适配wo-oz并展示新版工作流输出","status":"running","stage":"execution","stages":{"execution":"running"},"sessions":{"execution":"codex-exec-thread"},"paths":{"executor_log":".wo/runs/run-a/logs/executor.log"}}',
      'JSON',
      '  echo \'{"run_id":"run-a","change_name":"1-适配wo-oz并展示新版工作流输出"}\'',
      '  exit 0',
      'fi',
      'echo "{}"',
    ].join('\n'));

    assert.deepEqual(await listOpenSpecChanges(projectPath), ['1-适配wo-oz并展示新版工作流输出']);
    const result = await startGoWorkflowRun(projectPath, '1-适配wo-oz并展示新版工作流输出');
    assert.equal(result.run_id, 'run-a');
    await assert.rejects(() => fs.access(path.join(projectPath, '.ozw', 'runs', 'run-a', 'state.json')));
    await assert.rejects(() => fs.access(path.join(projectPath, '.wo', 'runs', 'run-a', 'state.json')));

    const workflows = await listWorkflowReadModels(projectPath);
    assert.equal(workflows[0].runId, 'run-a');
    assert.equal(workflows[0].workflowDisplay.lines[0].text, 'start');
    assert.equal(workflows[0].workflowDisplay.lines[0].marker, '→');
  });
});

test('wo read model emits only happened display lines and session warnings', async () => {
  await withFakePath(async ({ projectPath }) => {
    const runRoot = resolveFlowRunsRoot(projectPath);
    await fs.mkdir(path.join(runRoot, 'run-review'), { recursive: true });
    await fs.writeFile(path.join(runRoot, 'run-review', 'state.json'), JSON.stringify({
      run_id: 'run-review',
      change_name: 'change-a',
      status: 'running',
      stage: 'review_1',
      stages: { execution: 'completed', review_1: 'running' },
      sessions: { execution: 'codex-exec-thread', review_1: 'codex-review-thread' },
    }));
    await fs.mkdir(path.join(runRoot, 'run-archive'), { recursive: true });
    await fs.writeFile(path.join(runRoot, 'run-archive', 'state.json'), JSON.stringify({
      run_id: 'run-archive',
      change_name: 'change-a',
      status: 'running',
      stage: 'archive',
      stages: { execution: 'completed', review_1: 'completed', archive: 'running' },
    }));
    await fs.mkdir(path.join(runRoot, 'run-repair'), { recursive: true });
    await fs.writeFile(path.join(runRoot, 'run-repair', 'state.json'), JSON.stringify({
      run_id: 'run-repair',
      change_name: 'change-a',
      status: 'running',
      stage: 'review_2',
      stages: { execution: 'completed', review_1: 'completed', repair_1: 'completed', review_2: 'running' },
      workflow_display: {
        lines: [
          { id: 'manual', marker: '→', text: 'review', raw_line: '→ review unknown-thread.jsonl', stage_key: 'review_1' },
        ],
      },
      processes: [
        { stage: 'review_1', role: 'reviewer', status: 'running', sessionId: 'actual-review-thread' },
      ],
    }));

    const byId = new Map((await listWorkflowReadModels(projectPath)).map((workflow) => [workflow.runId, workflow]));
    assert.deepEqual(byId.get('run-review').workflowDisplay.lines.map((line) => `${line.marker} ${line.text}`), ['✓ start', '→ review']);
    assert.deepEqual(byId.get('run-archive').workflowDisplay.lines.map((line) => line.text), ['start', 'review', 'archive']);
    assert.ok(!byId.get('run-archive').workflowDisplay.lines.some((line) => line.text === '1 fix'));
    assert.deepEqual(byId.get('run-repair').workflowDisplay.lines.map((line) => line.text), ['review']);
    assert.deepEqual(byId.get('run-repair').workflowDisplay.lines[0].sessionRef, {
      label: 'unknown-thread.jsonl',
      stageKey: 'review_1',
    });
    assert.ok(byId.get('run-repair').diagnostics.warnings.some((warning) => warning.includes('unknown-thread.jsonl')));
  });
});

test('wo read model ignores legacy project .wo runs when user-state runs exist', async () => {
  await withFakePath(async ({ projectPath }) => {
    const legacyRunRoot = path.join(projectPath, '.wo', 'runs', 'old-run');
    await fs.mkdir(legacyRunRoot, { recursive: true });
    await fs.writeFile(path.join(legacyRunRoot, 'state.json'), JSON.stringify({
      run_id: 'old-run',
      change_name: 'legacy-change',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
    }));

    const userStateRunRoot = path.join(resolveFlowRunsRoot(projectPath), 'new-run');
    await fs.mkdir(userStateRunRoot, { recursive: true });
    await fs.writeFile(path.join(userStateRunRoot, 'state.json'), JSON.stringify({
      run_id: 'new-run',
      change_name: 'new-change',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
    }));

    const workflows = await listWorkflowReadModels(projectPath);
    assert.deepEqual(workflows.map((workflow) => workflow.runId), ['new-run']);
  });
});

test('wo read model returns empty when only legacy project .wo runs exist', async () => {
  await withFakePath(async ({ projectPath }) => {
    const legacyRunRoot = path.join(projectPath, '.wo', 'runs', 'old-run');
    await fs.mkdir(legacyRunRoot, { recursive: true });
    await fs.writeFile(path.join(legacyRunRoot, 'state.json'), JSON.stringify({
      run_id: 'old-run',
      change_name: 'legacy-change',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
    }));

    assert.deepEqual(await listWorkflowReadModels(projectPath), []);
  });
});

test('wo read model sorts arbitrary review and repair rounds without unknown warnings', async () => {
  await withFakePath(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-many-rounds');
    const stages = { execution: 'completed' };
    for (let index = 1; index <= 6; index += 1) {
      stages[`review_${index}`] = 'completed';
      if (index <= 5) {
        stages[`repair_${index}`] = 'completed';
      }
    }
    stages.archive = 'completed';

    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-many-rounds',
      change_name: 'change-a',
      status: 'done',
      stage: 'done',
      stages,
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);
    assert.deepEqual(workflow.workflowDisplay.lines.map((line) => line.text), [
      'start',
      'review',
      '1 fix review',
      '2 fix review',
      '3 fix review',
      '4 fix review',
      '5 fix review',
      'archive',
    ]);
    assert.equal(workflow.runState, 'completed');
    assert.ok(!workflow.workflowDisplay.lines.some((line) => line.text === 'done'));
    assert.ok(!workflow.diagnostics.warnings.some((warning) => warning.includes('Unknown runner stage: review_4')));
    assert.ok(!workflow.diagnostics.warnings.some((warning) => warning.includes('Unknown runner stage: repair_4')));
  });
});

test('wo read model keeps workflow display text from state lines', async () => {
  await withFakePath(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-display-priority');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-display-priority',
      change_name: 'change-a',
      status: 'running',
      stage: 'review_2',
      stages: { execution: 'completed', review_1: 'completed', repair_1: 'completed', review_2: 'running' },
      workflow_display: {
        lines: [
          { marker: '✓', text: 'start', stage_key: 'execution' },
          { marker: '✓', text: 'review', stage_key: 'review_1' },
          { marker: '✓', text: '1 fix', stage_key: 'repair_1' },
          { marker: '→', text: '1 fix review', stage_key: 'review_2' },
        ],
      },
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);
    assert.deepEqual(workflow.workflowDisplay.lines.map((line) => `${line.marker} ${line.text}`), [
      '✓ start',
      '✓ review',
      '→ 1 fix review',
    ]);
    assert.ok(!workflow.workflowDisplay.lines.some((line) => line.text === '1 fix'));
    assert.ok(!workflow.workflowDisplay.lines.some((line) => line.text === 'review 2'));
  });
});

test('wo read model treats current fix stages as repair rounds', async () => {
  await withFakePath(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-fix-rounds');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-fix-rounds',
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
      },
      sessions: {
        'codex:executor': 'executor-session',
        'codex:reviewer': 'reviewer-session',
      },
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);
    assert.deepEqual(workflow.workflowDisplay.lines.map((line) => line.text), [
      'start',
      'review',
      '1 fix review',
      '2 fix review',
    ]);
    assert.ok(!workflow.workflowDisplay.lines.some((line) => line.text === '1 fix'));
    assert.ok(!workflow.workflowDisplay.lines.some((line) => line.text === 'fix_1'));
    // fix_1 阶段没有 explicit process，按新契约不应有子会话
    assert.equal(workflow.childSessions.find((session) => session.stageKey === 'fix_1')?.id, undefined);
    assert.ok(!workflow.diagnostics.warnings.some((warning) => warning.includes('Unknown runner stage: fix_1')));
  });
});

test('wo read model leaves unknown terminal state rows non-clickable', async () => {
  await withFakePath(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-blocked-after-fix');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-blocked-after-fix',
      change_name: 'change-a',
      status: 'blocked',
      stage: 'blocked_review_limit',
      stages: {
        execution: 'completed',
        review_1: 'completed',
        fix_1: 'completed',
        blocked_review_limit: 'blocked',
      },
      sessions: {
        'codex:executor': 'executor-session',
        'codex:reviewer': 'reviewer-session',
      },
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);
    assert.deepEqual(workflow.workflowDisplay.lines.map((line) => line.text), [
      'start',
      'review',
      '1 fix',
      'blocked_review_limit',
    ]);
    // 无 explicit process 时，fix 行不应有 sessionRef
    assert.equal(workflow.workflowDisplay.lines.find((line) => line.text === '1 fix')?.sessionRef, undefined);
    assert.equal(workflow.workflowDisplay.lines.find((line) => line.text === 'blocked_review_limit')?.sessionRef, undefined);
  });
});

test('wo read model links role jsonl checklist rows to frontend sessions', async () => {
  await withFakePath(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-role-sessions');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.mkdir(path.join(runRoot, 'logs'), { recursive: true });
    await fs.writeFile(path.join(runRoot, 'logs', 'executor.jsonl'), '');
    await fs.writeFile(path.join(runRoot, 'logs', 'reviewer.jsonl'), '');
    await fs.writeFile(path.join(runRoot, 'logs', 'archiver.jsonl'), '');
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-role-sessions',
      change_name: 'change-a',
      status: 'done',
      stage: 'done',
      stages: {
        execution: 'completed',
        review_1: 'completed',
        repair_1: 'completed',
        review_2: 'completed',
        archive: 'completed',
      },
      sessions: {
        'codex:executor': 'executor-session',
        'codex:reviewer': 'reviewer-session',
        'codex:archiver': 'archiver-session',
      },
      paths: {
        executor_log: '.wo/runs/run-role-sessions/logs/executor.jsonl',
        reviewer_log: '.wo/runs/run-role-sessions/logs/reviewer.jsonl',
        archiver_log: '.wo/runs/run-role-sessions/logs/archiver.jsonl',
      },
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);
    assert.deepEqual(workflow.workflowDisplay.lines.map((line) => line.text), [
      'start',
      'review',
      '1 fix review',
      'archive',
    ]);
    assert.equal(workflow.workflowDisplay.lines[0].sessionRef.label, 'executor-session.jsonl');
    // reviewer now maps to review_2 (latest completed review stage), not review_1
    assert.equal(workflow.workflowDisplay.lines[1].sessionRef, undefined,
      'review line now has no session ref because reviewer maps to review_2');
    // review_2 shows as '1 fix review', now carries the reviewer session
    assert.equal(workflow.workflowDisplay.lines[2].sessionRef?.label, 'reviewer-session.jsonl',
      '1 fix review line now has reviewer session because reviewer → review_2');
    assert.equal(workflow.workflowDisplay.lines[3].sessionRef.sessionId, 'archiver-session');
  });
});

test('wo read model emits 0.9 fixed role summary rows with check counts', async () => {
  await withFakePath(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-role-summary');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-role-summary',
      change_name: 'change-a',
      status: 'done',
      stage: 'done',
      stages: {
        execution: 'completed',
        review_1: 'completed',
        fix_1: 'completed',
        review_2: 'completed',
        fix_2: 'completed',
        archive: 'completed',
      },
      sessions: {
        'codex:executor': 'executor-session',
        'codex:reviewer': 'reviewer-session',
        'codex:archiver': 'archiver-session',
      },
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);
    const rows = workflow.workflowRoleSummary.rows;
    // v1.3.0: no acceptance data means no acceptance row (merged into planning)
    assert.equal(rows.length, 6);
    assert.equal(rows.find((r) => r.key === 'planning').label, '规');
    assert.equal(rows.find((r) => r.key === 'planning').placeholder, '未知');
    assert.equal(rows.find((r) => r.key === 'planning').sessionRef, null);
    assert.equal(rows.find((r) => r.key === 'executor').label, '写');
    assert.equal(rows.find((r) => r.key === 'executor').checkCount, 1);
    assert.equal(rows.find((r) => r.key === 'executor').sessionRef.sessionId, 'executor-session');
    assert.equal(rows.find((r) => r.key === 'executor').sessionRef.label, 'executor-session');
    assert.equal(rows.find((r) => r.key === 'reviewer').label, '审');
    assert.equal(rows.find((r) => r.key === 'reviewer').checkCount, 2);
    assert.equal(rows.find((r) => r.key === 'reviewer').sessionRef.sessionId, 'reviewer-session');
    assert.equal(rows.find((r) => r.key === 'reviewer').sessionRef.label, 'reviewer-session');
    assert.equal(rows.find((r) => r.key === 'fixer').label, '修');
    assert.equal(rows.find((r) => r.key === 'fixer').checkCount, 2);
    assert.equal(rows.find((r) => r.key === 'fixer').sessionRef, null);
    assert.equal(rows.find((r) => r.key === 'qa').label, '测');
    assert.equal(rows.find((r) => r.key === 'qa').checkCount, 0);
    assert.equal(rows.find((r) => r.key === 'qa').sessionRef, null);
    assert.equal(rows.find((r) => r.key === 'archiver').label, '存');
    assert.equal(rows.find((r) => r.key === 'archiver').checkCount, 1);
    assert.equal(rows.find((r) => r.key === 'archiver').sessionRef.sessionId, 'archiver-session');
    assert.equal(rows.find((r) => r.key === 'archiver').sessionRef.label, 'archiver-session');
  });
});

test('wo read model archiver row falls back to archiver session for archive stage', async () => {
  await withFakePath(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-archiver-mapping');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-archiver-mapping',
      change_name: 'change-a',
      status: 'done',
      stage: 'done',
      stages: { execution: 'completed', review_1: 'completed', archive: 'completed' },
      sessions: {
        'codex:executor': 'executor-session',
        'codex:reviewer': 'reviewer-session',
        'codex:archiver': 'archiver-session',
      },
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);
    const archiverRow = workflow.workflowRoleSummary.rows.find((r) => r.key === 'archiver');
    assert.equal(archiverRow.sessionRef.sessionId, 'archiver-session');
    assert.equal(archiverRow.checkCount, 1);
  });
});
