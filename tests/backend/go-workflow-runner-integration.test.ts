// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify Go-backed workflow integration through fake oz flow JSON
 * contracts instead of the retired Node auto-runner state machine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { resolveFlowRunStatePath, resolveFlowRunsRoot } from '../../backend/domains/workflows/flow-runtime-paths.ts';

/**
 * Run a test body with fake oz first in PATH and restore process env.
 */
async function withFakeGoWorkflowTools(testBody) {
  const previousPath = process.env.PATH;
  const previousHome = process.env.HOME;
  const previousXdgStateHome = process.env.XDG_STATE_HOME;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-go-workflow-'));
  const binDir = path.join(tempRoot, 'bin');
  const homeDir = path.join(tempRoot, 'home');
  const stateHome = path.join(tempRoot, 'state');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'oz'),
    [
      '#!/bin/sh',
      'PATH="/usr/bin:/bin:$PATH"',
      'case "$1" in',
      '  --version) echo "oz-fake";;',
      '  list) echo \'{"changes":[{"name":"go-change"}]}\';;',
      '  status) echo "{\"name\":\"$2\",\"status\":\"active\"}";;',
      '  instructions) echo \'{"schemaName":"spec-driven","state":"ready","contextFiles":["docs/changes/go-change/tasks.md"],"progress":{"total":1,"completed":0,"remaining":1},"tasks":[]}\';;',
      '  validate) echo \'{"ok":true}\';;',
      '  archive) echo \'{"ok":true}\';;',
      '  flow)',
      '    shift',
      '    run_id="run-abc"',
      '    repo_path="$(pwd -P)"',
      '    repo_base="$(basename "$repo_path" | tr "[:upper:]" "[:lower:]" | sed -E "s/[^a-z0-9]+/-/g; s/^-+//; s/-+$//")"',
      '    if [ -z "$repo_base" ]; then repo_base="repo"; fi',
      '    repo_hash="$(printf "%s" "$repo_path" | sha1sum | cut -c1-10)"',
      '    run_dir="${XDG_STATE_HOME}/oz/flow/repos/${repo_base}-${repo_hash}/runs/$run_id"',
      '    state="$run_dir/state.json"',
      '    write_state() {',
      '      mkdir -p "$run_dir/logs"',
      '      echo "runner log" > "$run_dir/logs/executor.log"',
      '      echo "archiver log" > "$run_dir/logs/archiver.log"',
      '      cat > "$state" <<JSON',
      '{"run_id":"run-abc","change_name":"go-change","status":"$1","stage":"$2","stages":{"execution":"$1","review_1":"pending","repair_1":"pending","archive":"pending"},"paths":{"executor_log":".wo/runs/run-abc/logs/executor.log","archiver_log":".wo/runs/run-abc/logs/archiver.log"},"sessions":{"executor":"codex-exec-thread"},"error":"$3"}',
      'JSON',
      '    }',
      '    case "$1" in',
      '      --version) echo "oz-flow-fake";;',
      '      contract) echo \'{"version":"oz-flow-fake","json":true,"capabilities":["list-changes","run","resume","status","abort","graph"]}\';;',
      '      run) write_state running execution ""; echo \'{"run_id":"run-abc","change_name":"go-change","status":"running","stage":"execution"}\';;',
      '      resume) write_state running review_1 ""; echo \'{"run_id":"run-abc","change_name":"go-change","status":"running","stage":"review_1"}\';;',
      '      abort) write_state aborted review_1 "user aborted"; echo \'{"run_id":"run-abc","change_name":"go-change","status":"aborted","stage":"review_1"}\';;',
      '      status) cat "$state";;',
      '      list-changes) echo \'{"changes":[{"name":"go-change"}]}\';;',
      '      graph) echo \'{"nodes":[],"edges":[],"artifacts":[],"gates":[]}\';;',
      '      *) echo "usage: oz flow run resume status abort --json --run-id --change";;',
      '    esac',
      '    ;;',
      '  *) echo \'{}\';;',
      'esac',
    ].join('\n'),
    { mode: 0o755 },
  );

  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  process.env.HOME = homeDir;
  process.env.XDG_STATE_HOME = stateHome;
  try {
    await testBody(tempRoot);
  } finally {
    process.env.PATH = previousPath;
    process.env.HOME = previousHome;
    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Write the minimal docs/ OpenSpec change files expected by workflow read model.
 */
async function writeOpenSpecChange(projectPath) {
  const changeRoot = path.join(projectPath, 'docs', 'changes', 'go-change');
  await fs.mkdir(path.join(projectPath, '.ozw'), { recursive: true });
  await fs.mkdir(path.join(changeRoot, 'specs'), { recursive: true });
  await fs.writeFile(path.join(changeRoot, 'proposal.md'), '# proposal\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'design.md'), '# design\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'tasks.md'), '- [ ] implement runner-backed workflow\n', 'utf8');
}

/**
 * Mark the fake OpenSpec task complete so review-stage runner states are valid.
 */
async function completeOpenSpecChangeTasks(projectPath) {
  await fs.writeFile(
    path.join(projectPath, 'docs', 'changes', 'go-change', 'tasks.md'),
    '- [x] implement runner-backed workflow\n',
    'utf8',
  );
}

/**
 * Write an externally-created wo state file without touching Web workflow config.
 */
async function writeExternalRunState(projectPath, runId, runnerState) {
  /**
   * PURPOSE: Model a run started from another terminal where only the Go runner
   * sealed state exists before the Web control plane lists workflows.
   */
  const runDir = path.join(resolveFlowRunsRoot(projectPath), runId);
  await fs.mkdir(path.join(runDir, 'logs'), { recursive: true });
  await fs.writeFile(path.join(runDir, 'logs', 'executor.log'), 'runner log\n', 'utf8');
  await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify(runnerState), 'utf8');
}

test('Go-backed workflow persists run id and maps state.json into the read model', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const project = { name: 'project', fullPath: projectPath, path: projectPath };
    await fs.mkdir(projectPath, { recursive: true });
    await writeOpenSpecChange(projectPath);

    const importKey = encodeURIComponent(`${tempRoot}-create`);
    const {
      createProjectWorkflow,
      getProjectWorkflow,
    } = await import(`../../backend/workflows.js?go=${importKey}`);

    const workflow = await createProjectWorkflow(project, {
      title: 'Go runner adoption',
      objective: 'Use the external runner as source of truth',
      openspecChangeName: 'go-change',
    });

    assert.equal(workflow.runner, 'go');
    assert.equal(workflow.runnerProvider, 'codex');
    assert.equal(workflow.runId, 'run-abc');
    assert.equal(workflow.stage, 'execution');
    assert.equal(workflow.runState, 'running');
    assert.equal(workflow.stageStatuses.find((stage) => stage.key === 'execution')?.status, 'active');
    // 新契约：sessions-only 状态不产生 runnerProcesses
    assert.deepEqual(workflow.runnerProcesses, []);
    assert.deepEqual(
      workflow.childSessions.find((session) => session.id === 'codex-exec-thread'),
      {
        id: 'codex-exec-thread',
        title: '执行',
        summary: '执行',
        provider: 'codex',
        role: 'executor',
        workflowId: 'run-abc',
        stageKey: 'execution',
        address: 'execution',
        routePath: '/runs/run-abc/sessions/execution',
      },
    );

    await assert.rejects(
      () => fs.readFile(path.join(projectPath, '.ozw', 'conf.json'), 'utf8'),
      /ENOENT/,
    );

    const refreshed = await getProjectWorkflow(project, workflow.id);
    assert.equal(refreshed.runId, 'run-abc');
    assert.equal(refreshed.runnerError, '');
    assert.equal(refreshed.childSessions.find((session) => session.id === 'codex-exec-thread')?.address, 'execution');
    await assert.rejects(() => fs.access(path.join(projectPath, '.wo', 'runs', 'run-abc', 'state.json')), /ENOENT/);
  });
});

test('Go-backed workflow prefers runner processes and preserves process metadata', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const project = { name: 'project', fullPath: projectPath, path: projectPath };
    await fs.mkdir(path.join(resolveFlowRunsRoot(projectPath), 'run-abc', 'logs'), { recursive: true });
    await writeOpenSpecChange(projectPath);
    await fs.writeFile(
      resolveFlowRunStatePath(projectPath, 'run-abc'),
      JSON.stringify({
        run_id: 'run-abc',
        change_name: 'go-change',
        status: 'running',
        stage: 'review_1',
        stages: { execution: 'completed', review_1: 'running' },
        paths: { reviewer_log: '.wo/runs/run-abc/logs/reviewer.log' },
        sessions: { reviewer: 'fallback-review-thread' },
        processes: [{
          stage: 'review_1',
          role: 'reviewer',
        status: 'running',
        sessionId: 'codex-review-thread',
        provider: 'codex',
        pid: 12345,
        exitCode: 7,
        failed: true,
          logPath: '.wo/runs/run-abc/logs/reviewer.log',
        }],
      }),
      'utf8',
    );
    await fs.writeFile(path.join(resolveFlowRunsRoot(projectPath), 'run-abc', 'logs', 'reviewer.log'), 'runner log\n');

    const importKey = encodeURIComponent(`${tempRoot}-processes`);
    const { getProjectWorkflow } = await import(`../../backend/workflows.js?go=${importKey}`);
    await fs.writeFile(
      path.join(projectPath, '.ozw', 'conf.json'),
      JSON.stringify({
        version: 2,
        workflows: {
          1: {
            id: 'w1',
            routeIndex: 1,
            runner: 'go',
            runnerProvider: 'codex',
            run_id: 'run-abc',
            title: 'Process metadata',
            objective: 'Expose runner process rows',
            openspecChangeName: 'go-change',
            stage: 'execution',
            runState: 'running',
            chat: {},
          },
        },
      }),
      'utf8',
    );

    const workflow = await getProjectWorkflow(project, 'run-abc');
    assert.deepEqual(workflow.runnerProcesses, [{
      stage: 'review_1',
      role: 'reviewer',
      status: 'running',
      sessionId: 'codex-review-thread',
      provider: 'codex',
      pid: 12345,
      exitCode: 7,
      failed: true,
      logPath: '.wo/runs/run-abc/logs/reviewer.log',
    }]);
    assert.equal(workflow.childSessions.find((session) => session.id === 'codex-review-thread')?.stageKey, 'review_1');
  });
});

test('Go-backed workflow diagnostics warn about unknown paths and process fields', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const project = { name: 'project', fullPath: projectPath, path: projectPath };
    await fs.mkdir(path.join(resolveFlowRunsRoot(projectPath), 'run-extra', 'logs'), { recursive: true });
    await writeOpenSpecChange(projectPath);
    await fs.writeFile(path.join(resolveFlowRunsRoot(projectPath), 'run-extra', 'extra.txt'), 'extra report\n', 'utf8');
    await fs.writeFile(path.join(resolveFlowRunsRoot(projectPath), 'run-extra', 'logs', 'executor.log'), 'runner log\n', 'utf8');
    await fs.writeFile(
      resolveFlowRunStatePath(projectPath, 'run-extra'),
      JSON.stringify({
        run_id: 'run-extra',
        change_name: 'go-change',
        status: 'running',
        stage: 'execution',
        stages: { execution: 'running' },
        paths: {
          executor_log: '.wo/runs/run-extra/logs/executor.log',
          extra_report: '.wo/runs/run-extra/extra.txt',
        },
        sessions: {},
        processes: [{
          stage: 'execution',
          role: 'executor',
          status: 'running',
          sessionId: 'codex-extra-thread',
          logPath: '.wo/runs/run-extra/logs/executor.log',
          mystery_field: 'kept for future oz flow contract',
        }],
      }),
      'utf8',
    );

    const importKey = encodeURIComponent(`${tempRoot}-diagnostic-unknown`);
    const { getProjectWorkflow } = await import(`../../backend/workflows.js?go=${importKey}`);
    const workflow = await getProjectWorkflow(project, 'run-extra');

    assert.ok(workflow.artifacts.some((artifact) => (
      artifact.label === 'extra report'
      && artifact.path === '.wo/runs/run-extra/extra.txt'
      && artifact.exists === false
    )));
    assert.deepEqual(workflow.runnerProcesses, [{
      stage: 'execution',
      role: 'executor',
      status: 'running',
      sessionId: 'codex-extra-thread',
      provider: 'codex',
      failed: false,
      logPath: '.wo/runs/run-extra/logs/executor.log',
    }]);
    assert.ok(workflow.runnerDiagnostics.warnings.includes('Unknown runner path key: extra_report'));
    assert.ok(workflow.runnerDiagnostics.warnings.includes('Unknown runner process field: mystery_field'));
    assert.ok(workflow.controllerEvents.some((event) => event.message === 'Unknown runner path key: extra_report'));
    assert.ok(workflow.stageInspections.some((stage) => (
      stage.warnings.some((warning) => warning.message === 'Unknown runner process field: mystery_field')
    )));
  });
});

test('Go-backed workflow preserves runner child-session addresses across process reorder', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const project = { name: 'project', fullPath: projectPath, path: projectPath };
    await fs.mkdir(path.join(resolveFlowRunsRoot(projectPath), 'run-abc'), { recursive: true });
    await writeOpenSpecChange(projectPath);
    await fs.writeFile(
      path.join(projectPath, '.ozw', 'conf.json'),
      JSON.stringify({
        version: 2,
        workflows: {
          1: {
            id: 'w1',
            routeIndex: 1,
            runner: 'go',
            runnerProvider: 'codex',
            run_id: 'run-abc',
            title: 'Stable child routes',
            objective: 'Keep runner child routes stable',
            openspecChangeName: 'go-change',
            stage: 'execution',
            runState: 'running',
            chat: {},
          },
        },
      }),
      'utf8',
    );

    const importKey = encodeURIComponent(`${tempRoot}-stable-routes`);
    const { listProjectWorkflows } = await import(`../../backend/workflows.js?go=${importKey}`);
    await fs.writeFile(
      resolveFlowRunStatePath(projectPath, 'run-abc'),
      JSON.stringify({
        run_id: 'run-abc',
        change_name: 'go-change',
        status: 'running',
        stage: 'review_1',
        stages: { execution: 'completed', review_1: 'running' },
        paths: {},
        sessions: {},
        processes: [
          { stage: 'execution', role: 'executor', status: 'completed', sessionId: 'codex-exec-thread' },
          { stage: 'review_1', role: 'reviewer', status: 'running', sessionId: 'codex-review-thread' },
        ],
      }),
      'utf8',
    );
    const firstRead = (await listProjectWorkflows(projectPath))[0];
    assert.equal(firstRead.childSessions.find((session) => session.id === 'codex-exec-thread')?.address, 'execution');
    assert.equal(firstRead.childSessions.find((session) => session.id === 'codex-review-thread')?.address, 'review_1');

    await fs.writeFile(
      resolveFlowRunStatePath(projectPath, 'run-abc'),
      JSON.stringify({
        run_id: 'run-abc',
        change_name: 'go-change',
        status: 'running',
        stage: 'repair_1',
        stages: { execution: 'completed', review_1: 'completed', repair_1: 'running' },
        paths: {},
        sessions: {},
        processes: [
          { stage: 'repair_1', role: 'executor', status: 'running', sessionId: 'codex-repair-thread' },
          { stage: 'review_1', role: 'reviewer', status: 'completed', sessionId: 'codex-review-thread' },
          { stage: 'execution', role: 'executor', status: 'completed', sessionId: 'codex-exec-thread' },
        ],
      }),
      'utf8',
    );
    const secondRead = (await listProjectWorkflows(projectPath))[0];
    assert.equal(secondRead.childSessions.find((session) => session.id === 'codex-exec-thread')?.address, 'execution');
    assert.equal(secondRead.childSessions.find((session) => session.id === 'codex-review-thread')?.address, 'review_1');
    assert.equal(secondRead.childSessions.find((session) => session.id === 'codex-repair-thread')?.address, 'repair_1/executor');
  });
});

test('Go-backed workflow discovers external running wo runs without persisting conf workflows', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    await fs.mkdir(projectPath, { recursive: true });
    await writeOpenSpecChange(projectPath);
    await writeExternalRunState(projectPath, 'external-run-a', {
      run_id: 'external-run-a',
      change_name: 'go-change',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      paths: { executor_log: '.wo/runs/external-run-a/logs/executor.log' },
      sessions: {},
    });

    const importKey = encodeURIComponent(`${tempRoot}-external-running`);
    const { listProjectWorkflows } = await import(`../../backend/workflows.js?go=${importKey}`);
    const workflows = await listProjectWorkflows(projectPath);

    assert.equal(workflows.length, 1);
    assert.equal(workflows[0].id, 'external-run-a');
    assert.equal(workflows[0].runner, 'go');
    assert.equal(workflows[0].runId, 'external-run-a');
    assert.equal(workflows[0].openspecChangeName, 'go-change');
    assert.equal(workflows[0].stage, 'execution');
    assert.equal(workflows[0].runState, 'running');
    assert.equal(workflows[0].runnerDiagnostics.rawStatus, 'running');

    await assert.rejects(
      () => fs.readFile(path.join(projectPath, '.ozw', 'conf.json'), 'utf8'),
      /ENOENT/,
    );
  });
});

test('Go-backed workflow maps snake_case external state into the read model', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    await fs.mkdir(projectPath, { recursive: true });
    await writeOpenSpecChange(projectPath);
    await writeExternalRunState(projectPath, 'snake-dir-run', {
      run_id: 'snake-dir-run',
      change_name: 'go-change',
      status: 'done',
      stage: 'archive',
      stages: { archive: 'completed' },
      paths: { archiver_log: '.wo/runs/snake-dir-run/logs/archiver.log' },
      sessions: {},
    });

    const importKey = encodeURIComponent(`${tempRoot}-external-snake`);
    const { listProjectWorkflows } = await import(`../../backend/workflows.js?go=${importKey}`);
    const workflow = (await listProjectWorkflows(projectPath))[0];

    assert.equal(workflow.runId, 'snake-dir-run');
    assert.equal(workflow.openspecChangeName, 'go-change');
    assert.equal(workflow.stage, 'archive');
    assert.equal(workflow.runState, 'completed');
    // 新契约：无 explicit processes 时 runnerProcesses 为空
    assert.deepEqual(workflow.runnerProcesses, []);
  });
});

test('Go-backed workflow discovery is idempotent and reuses registered runs', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    await fs.mkdir(projectPath, { recursive: true });
    await writeOpenSpecChange(projectPath);
    await writeExternalRunState(projectPath, 'external-run-a', {
      run_id: 'external-run-a',
      change_name: 'go-change',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      paths: {},
      sessions: {},
    });

    const importKey = encodeURIComponent(`${tempRoot}-external-idempotent`);
    const { listProjectWorkflows } = await import(`../../backend/workflows.js?go=${importKey}`);
    const firstRead = await listProjectWorkflows(projectPath);
    const secondRead = await listProjectWorkflows(projectPath);

    assert.equal(firstRead.length, 1);
    assert.equal(secondRead.length, 1);
    assert.equal(firstRead[0].id, 'external-run-a');
    assert.equal(secondRead[0].id, 'external-run-a');
    await assert.rejects(
      () => fs.readFile(path.join(projectPath, '.ozw', 'conf.json'), 'utf8'),
      /ENOENT/,
    );
  });
});

test('Go-backed workflow discovery exposes corrupt external runs as diagnostics', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    await fs.mkdir(path.join(resolveFlowRunsRoot(projectPath), 'run-abc'), { recursive: true });
    await writeOpenSpecChange(projectPath);
    await writeExternalRunState(projectPath, 'run-abc', {
      run_id: 'run-abc',
      change_name: 'go-change',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      paths: {},
      sessions: {},
    });
    await fs.mkdir(path.join(resolveFlowRunsRoot(projectPath), 'bad-run'), { recursive: true });
    await fs.writeFile(resolveFlowRunStatePath(projectPath, 'bad-run'), '{bad json', 'utf8');
    await fs.writeFile(
      path.join(projectPath, '.ozw', 'conf.json'),
      JSON.stringify({
        version: 2,
        workflows: {
          1: {
            id: 'w1',
            routeIndex: 1,
            runner: 'go',
            runnerProvider: 'codex',
            run_id: 'run-abc',
            title: 'Existing',
            objective: 'Existing route',
            openspecChangeName: 'go-change',
            stage: 'execution',
            runState: 'running',
            chat: {},
          },
        },
      }),
      'utf8',
    );

    const importKey = encodeURIComponent(`${tempRoot}-external-dedupe`);
    const { listProjectWorkflows } = await import(`../../backend/workflows.js?go=${importKey}`);
    const workflows = await listProjectWorkflows(projectPath);

    assert.equal(workflows.length, 2);
    assert.ok(workflows.some((workflow) => workflow.id === 'run-abc' && workflow.runId === 'run-abc'));
    const corruptWorkflow = workflows.find((workflow) => workflow.id === 'bad-run');
    assert.equal(corruptWorkflow?.runState, 'blocked');
    assert.match(corruptWorkflow?.runnerDiagnostics?.runnerError || '', /Unreadable runner state/);
  });
});

test('Go-backed workflow list and detail expose external completed wo runs', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const project = { name: 'project', fullPath: projectPath, path: projectPath };
    await fs.mkdir(projectPath, { recursive: true });
    await writeOpenSpecChange(projectPath);
    await writeExternalRunState(projectPath, 'external-done', {
      run_id: 'external-done',
      change_name: 'go-change',
      status: 'completed',
      stage: 'archive',
      stages: { archive: 'completed' },
      paths: { archiver_log: '.wo/runs/external-done/logs/archiver.log' },
      sessions: {},
    });

    const importKey = encodeURIComponent(`${tempRoot}-external-detail`);
    const { getProjectWorkflow, listProjectWorkflows } = await import(`../../backend/workflows.js?go=${importKey}`);
    const listWorkflow = (await listProjectWorkflows(projectPath))[0];
    const detailWorkflow = await getProjectWorkflow(project, listWorkflow.id);

    assert.equal(listWorkflow.runState, 'completed');
    assert.equal(detailWorkflow.runId, 'external-done');
    assert.equal(detailWorkflow.openspecChangeName, 'go-change');
    assert.equal(detailWorkflow.stage, 'archive');
    assert.equal(detailWorkflow.runState, 'completed');
    // 新契约：无 explicit processes 时 runnerProcesses 为空
    assert.deepEqual(detailWorkflow.runnerProcesses, []);
    assert.equal(detailWorkflow.runnerDiagnostics.rawStatus, 'completed');
  });
});

test('Go-backed workflow listing registers watchers for newly adopted external runs', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const project = { name: 'project', fullPath: projectPath, path: projectPath };
    await fs.mkdir(projectPath, { recursive: true });
    await writeOpenSpecChange(projectPath);
    await writeExternalRunState(projectPath, 'external-watch', {
      run_id: 'external-watch',
      change_name: 'go-change',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      paths: {},
      sessions: {},
    });

    const importKey = encodeURIComponent(`${tempRoot}-external-watch`);
    const { listProjectWorkflows } = await import(`../../backend/workflows.js?go=${importKey}`);
    const { ensureGoRunnerWatchersForProjects } = await import(`../../backend/domains/workflows/go-runner-watchers.js?go=${importKey}`);
    const projects = [{
      ...project,
      workflows: await listProjectWorkflows(projectPath),
    }];
    const watched = [];

    await ensureGoRunnerWatchersForProjects(projects, async (watchedProject, workflow) => {
      watched.push({
        projectPath: watchedProject.fullPath,
        runner: workflow.runner,
        run_id: workflow.runId,
      });
    });

    assert.deepEqual(watched, [{
      projectPath,
      runner: 'go',
      run_id: 'external-watch',
    }]);
  });
});

test('Go-backed workflow maps runner execution, review, repair, and archive stage statuses', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const project = { name: 'project', fullPath: projectPath, path: projectPath };
    await fs.mkdir(path.join(resolveFlowRunsRoot(projectPath), 'run-abc'), { recursive: true });
    await writeOpenSpecChange(projectPath);
    await fs.writeFile(
      path.join(projectPath, '.ozw', 'conf.json'),
      JSON.stringify({
        version: 2,
        workflows: {
          1: {
            id: 'w1',
            routeIndex: 1,
            runner: 'go',
            runnerProvider: 'codex',
            run_id: 'run-abc',
            title: 'Stage mapping',
            objective: 'Map all Go runner stages',
            openspecChangeName: 'go-change',
            stage: 'execution',
            runState: 'running',
            chat: {},
          },
        },
      }),
      'utf8',
    );

    const importKey = encodeURIComponent(`${tempRoot}-stage-mapping`);
    const { getProjectWorkflow } = await import(`../../backend/workflows.js?go=${importKey}`);
    const cases = [
      ['execution', 'running', 'execution', 'active'],
      ['review_1', 'running', 'review_1', 'active'],
      ['repair_1', 'running', 'repair_1', 'active'],
      ['archive', 'completed', 'archive', 'completed'],
    ];

    for (const [runnerStage, runnerStatus, expectedStage, expectedStatus] of cases) {
      await fs.writeFile(
        resolveFlowRunStatePath(projectPath, 'run-abc'),
        JSON.stringify({
          run_id: 'run-abc',
          change_name: 'go-change',
          status: runnerStatus,
          stage: runnerStage,
          stages: { [runnerStage]: runnerStatus },
          paths: {},
          sessions: {},
        }),
        'utf8',
      );
      const workflow = await getProjectWorkflow(project, 'run-abc');
      assert.equal(workflow.stage, expectedStage);
      assert.equal(workflow.stageStatuses.find((stage) => stage.key === expectedStage)?.status, expectedStatus);
    }
  });
});

test('Go-backed workflow resume and abort refresh state from runner state.json', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const project = { name: 'project', fullPath: projectPath, path: projectPath };
    await fs.mkdir(projectPath, { recursive: true });
    await writeOpenSpecChange(projectPath);

    const importKey = encodeURIComponent(`${tempRoot}-resume`);
    const {
      abortWorkflowRun,
      createProjectWorkflow,
      resumeWorkflowRun,
    } = await import(`../../backend/workflows.js?go=${importKey}`);

    const workflow = await createProjectWorkflow(project, {
      title: 'Resume Go runner',
      objective: 'Resume and abort through oz flow JSON commands',
      openspecChangeName: 'go-change',
    });
    await completeOpenSpecChangeTasks(projectPath);

    const resumed = await resumeWorkflowRun(project, workflow.id);
    assert.equal(resumed.stage, 'review_1');
    assert.equal(resumed.runState, 'running');
    assert.equal(resumed.stageStatuses.find((stage) => stage.key === 'review_1')?.status, 'active');

    const aborted = await abortWorkflowRun(project, workflow.id);
    assert.equal(aborted.stage, 'review_1');
    assert.equal(aborted.runState, 'blocked');
    assert.equal(aborted.runnerError, 'user aborted');
    assert.equal(aborted.stageStatuses.find((stage) => stage.key === 'review_1')?.status, 'blocked');
  });
});

test('Go runner client accepts state-publishing commands that exit immediately', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    await fs.mkdir(projectPath, { recursive: true });

    const importKey = encodeURIComponent(`${tempRoot}-immediate-exit`);
    const {
      startGoWorkflowRun,
      resumeGoWorkflowRun,
    } = await import(`../../backend/domains/workflows/go-runner-client.js?go=${importKey}`);

    const started = await startGoWorkflowRun(projectPath, 'go-change');
    assert.equal(started.run_id, 'run-abc');
    assert.equal(Number.isInteger(started.pid), true);

    const resumed = await resumeGoWorkflowRun(projectPath, 'run-abc');
    assert.equal(resumed.run_id, 'run-abc');
    assert.equal(resumed.stage, 'review_1');
  });
});

test('Go runner client does not fall back to legacy project .wo state when user-state publish is missing', async () => {
  await withFakeGoWorkflowTools(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    await fs.mkdir(path.join(projectPath, '.wo', 'runs', 'run-abc'), { recursive: true });
    await fs.writeFile(
      path.join(projectPath, '.wo', 'runs', 'run-abc', 'state.json'),
      JSON.stringify({ run_id: 'run-abc', status: 'running', stage: 'execution' }),
      'utf8',
    );
    await fs.writeFile(
      path.join(tempRoot, 'bin', 'oz'),
      [
        '#!/bin/sh',
        'if [ "$1" = "flow" ] && [ "$2" = "run" ]; then echo \'{"run_id":"run-abc","change_name":"go-change"}\'; exit 0; fi',
        'echo "{}"',
      ].join('\n'),
      { mode: 0o755 },
    );

    const importKey = encodeURIComponent(`${tempRoot}-missing-state`);
    const { startGoWorkflowRun } = await import(`../../backend/domains/workflows/go-runner-client.js?go=${importKey}`);

    await assert.rejects(
      () => startGoWorkflowRun(projectPath, 'go-change'),
      /Go runner did not publish state\.json for run run-abc/,
    );
  });
});
