// @ts-nocheck -- Proposal contract test: execution phase owns final strictness.
/**
 * PURPOSE: Lock the ozw read-model contract for wo v1.3.0 runs where the
 * planning and acceptance responsibilities are merged and QA stages iterate.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listWorkflowReadModels } from '../../../backend/domains/workflows/workflow-read-model.ts';
import { resolveFlowRunsRoot } from '../../../backend/domains/workflows/flow-runtime-paths.ts';

const CHANGE_NAME = '69-适配wo计划验收合并阶段并开放QA-JSON链接';

/**
 * Run a callback inside an isolated project and XDG state root.
 */
async function withTempWoProject(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-wo-v130-plan-qa-'));
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

/**
 * Write one text artifact into the real wo run directory.
 */
async function writeRunArtifact(runRoot, fileName, content) {
  await fs.mkdir(runRoot, { recursive: true });
  await fs.writeFile(path.join(runRoot, fileName), content, 'utf8');
}

/**
 * Build the minimal wo v1.3.0 workflow snapshot used by ozw route helpers.
 */
function workflowConfig() {
  const base = { tool: 'codex', reasoning: 'high', fast: false };
  return {
    max_review_iterations: 2,
    stages: {
      planning: { tool: 'codex', reasoning: 'xhigh', fast: true },
      execution: { tool: 'codex', reasoning: 'low', fast: false },
      review_1: base,
      qa_1: base,
      fix_1: { tool: 'codex', reasoning: 'low', fast: false },
      review_2: base,
      qa_2: base,
      fix_2: { tool: 'codex', reasoning: 'low', fast: false },
      archive: { tool: 'codex', reasoning: 'low', fast: false },
    },
  };
}

/**
 * Persist a v1.3.0 run state with iterative QA artifacts and no acceptance stage.
 */
async function writeV130Run(projectPath, runId) {
  const runRoot = path.join(resolveFlowRunsRoot(projectPath), runId);
  await writeRunArtifact(runRoot, 'review-1.json', JSON.stringify({ decision: 'needs_fix', findings: [{ title: 'needs work' }] }, null, 2));
  await writeRunArtifact(runRoot, 'qa-1.json', JSON.stringify({ decision: 'needs_fix', summary: 'runtime issue' }, null, 2));
  await writeRunArtifact(runRoot, 'fix-1-summary.md', '# Fix\n\nRuntime issue repaired.\n');
  await writeRunArtifact(runRoot, 'review-2.json', JSON.stringify({ decision: 'clean', findings: [] }, null, 2));
  await writeRunArtifact(runRoot, 'qa-2.json', JSON.stringify({ decision: 'clean', summary: 'all acceptance evidence covered' }, null, 2));
  await fs.writeFile(
    path.join(runRoot, 'state.json'),
    JSON.stringify({
      run_id: runId,
      change_name: CHANGE_NAME,
      sealed: true,
      status: 'running',
      stage: 'qa_2',
      stages: {
        execution: 'completed',
        review_1: 'completed',
        qa_1: 'completed',
        fix_1: 'completed',
        review_2: 'completed',
        qa_2: 'running',
        archive: 'pending',
      },
      sessions: {
        'codex:planner': 'planner-session-v130',
        'codex:executor': 'executor-session-v130',
        'codex:reviewer': 'reviewer-session-v130',
        'codex:qa': 'qa-session-v130',
        'codex:fixer': 'fixer-session-v130',
      },
      workflow_config: workflowConfig(),
      paths: {},
    }, null, 2),
    'utf8',
  );
}

test('wo v1.3.0 plan/acceptance merge hides empty acceptance and recognizes iterative QA', async () => {
  await withTempWoProject(async ({ projectPath }) => {
    await writeV130Run(projectPath, 'run-v130-plan-qa');

    const [workflow] = await listWorkflowReadModels(projectPath);
    const stageKeys = workflow.stageStatuses.map((stage) => stage.key);
    const roleKeys = workflow.workflowRoleSummary.rows.map((row) => row.key);

    assert.deepEqual(
      stageKeys,
      ['planning', 'execution', 'review_1', 'qa_1', 'fix_1', 'review_2', 'qa_2', 'archive'],
      'ozw must expose one merged planning stage before execution and must not include empty acceptance',
    );
    assert.equal(stageKeys.includes('acceptance'), false);
    assert.equal(roleKeys.includes('acceptance'), false);
    assert.equal(workflow.workflowRoleSummary.rows.find((row) => row.key === 'qa')?.checkCount, 2);
    assert.ok(
      !workflow.diagnostics.warnings.some((warning) => /Unknown runner stage: qa_[12]/.test(warning)),
      'qa_N stages must be first-class runner stages',
    );
  });
});

test('wo v1.3.0 missing qa-N JSON infers diagnostic from qa_N stage with empty paths', async () => {
  await withTempWoProject(async ({ projectPath }) => {
    const runId = 'run-empty-paths-no-qa2';
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), runId);
    await fs.mkdir(runRoot, { recursive: true });
    // Write only review artifacts — no qa-1.json, no qa-2.json
    await writeRunArtifact(runRoot, 'review-1.json', JSON.stringify({ decision: 'needs_fix' }));
    await writeRunArtifact(runRoot, 'fix-1-summary.md', '# Fix');
    await writeRunArtifact(runRoot, 'review-2.json', JSON.stringify({ decision: 'clean' }));
    await fs.writeFile(
      path.join(runRoot, 'state.json'),
      JSON.stringify({
        run_id: runId,
        change_name: CHANGE_NAME,
        sealed: true,
        status: 'running',
        stage: 'qa_2',
        stages: {
          execution: 'completed',
          review_1: 'completed',
          qa_1: 'completed',
          fix_1: 'completed',
          review_2: 'completed',
          qa_2: 'running',
          archive: 'pending',
        },
        sessions: {
          'codex:planner': 'planner-session',
          'codex:executor': 'executor-session',
          'codex:reviewer': 'reviewer-session',
          'codex:qa': 'qa-session',
          'codex:fixer': 'fixer-session',
        },
        workflow_config: workflowConfig(),
        paths: {},
      }, null, 2),
      'utf8',
    );

    const [workflow] = await listWorkflowReadModels(projectPath);

    // Diagnostic must surface the missing qa-2.json inferred from qa_2 stage
    assert.ok(
      workflow.diagnostics.warnings.some((warning) => String(warning).includes('qa-2.json')),
      'diagnostics must warn about missing qa-2.json even when paths is empty',
    );

    // Must create an exists:false artifact so UI can suppress broken links
    const qa2Artifact = workflow.artifacts.find((a) => a.label === 'qa-2.json');
    assert.ok(qa2Artifact, 'qa-2.json must be present as an artifact from stage inference');
    assert.equal(qa2Artifact.exists, false);
    assert.equal(qa2Artifact.stage, 'qa_2');
    assert.equal(qa2Artifact.type, 'qa-result');

    // Still no unknown stage warnings
    assert.ok(
      !workflow.diagnostics.warnings.some((warning) => /Unknown runner stage: qa_[12]/.test(warning)),
      'qa_N stages must remain first-class runner stages',
    );
  });
});

test('wo v1.3.0 qa-N JSON artifacts are attached to QA inspections', async () => {
  await withTempWoProject(async ({ projectPath }) => {
    await writeV130Run(projectPath, 'run-v130-qa-artifacts');

    const [workflow] = await listWorkflowReadModels(projectPath);
    const qaArtifacts = workflow.artifacts.filter((artifact) => /^qa-\d+\.json$/.test(path.basename(artifact.relativePath || artifact.path || artifact.label)));
    const latestQA = qaArtifacts.find((artifact) => path.basename(artifact.relativePath || artifact.path || artifact.label) === 'qa-2.json');
    const qaInspection = workflow.stageInspections.find((stage) => stage.stageKey === 'qa_2');

    assert.ok(latestQA, 'run-dir qa-2.json must be discovered as a workflow artifact');
    assert.equal(latestQA.stage, 'qa_2');
    assert.equal(latestQA.type, 'qa-result');
    assert.ok(
      qaInspection?.substages[0]?.files?.some((file) => path.basename(file.relativePath || file.path || file.label) === 'qa-2.json'),
      'qa-2.json must be visible from the qa_2 inspection',
    );
  });
});
