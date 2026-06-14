// @ts-nocheck -- Proposal acceptance test: execution phase owns final strictness.
/**
 * PURPOSE: Verify wo v1.2.0 acceptance and QA artifacts appear under the
 * correct ozw workflow stages using the real read-model artifact pipeline.
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
   * Isolate project files and wo user-state files from the developer machine.
   */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-wo-v120-artifacts-'));
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

async function writeProjectFile(projectPath, relativePath, content) {
  /**
   * Write a real project artifact so path existence checks run normally.
   */
  const fullPath = path.join(projectPath, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
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

test('wo v1.2.0 acceptance and QA artifacts are attached to their workflow stages', async () => {
  await withTempWoProject(async ({ projectPath }) => {
    await writeProjectFile(projectPath, '.wo/runs/run-artifacts/acceptance-summary.md', '# Acceptance\n');
    await writeProjectFile(projectPath, '.wo/runs/run-artifacts/qa.json', '{"decision":"clean"}\n');
    await writeProjectFile(projectPath, '.wo/runs/run-artifacts/delivery-summary.md', '# Delivery\n');
    await writeRunState(projectPath, 'run-artifacts', {
      change_name: '56-适配wo-v1.2.0七阶段工作流',
      status: 'completed',
      stage: 'archive',
      stages: {
        planning: 'completed',
        acceptance: 'completed',
        execution: 'completed',
        qa: 'completed',
        archive: 'completed',
      },
      paths: {
        acceptance_summary: '.wo/runs/run-artifacts/acceptance-summary.md',
        qa: '.wo/runs/run-artifacts/qa.json',
        delivery_summary: '.wo/runs/run-artifacts/delivery-summary.md',
      },
      sessions: {},
    });

    const [workflow] = await listWorkflowReadModels(projectPath);
    const artifactByPath = new Map(workflow.artifacts.map((artifact) => [artifact.relativePath, artifact]));

    assert.equal(
      artifactByPath.get('.wo/runs/run-artifacts/acceptance-summary.md')?.stage,
      'acceptance',
    );
    assert.equal(
      artifactByPath.get('.wo/runs/run-artifacts/qa.json')?.stage,
      'qa',
    );
    assert.equal(
      artifactByPath.get('.wo/runs/run-artifacts/delivery-summary.md')?.stage,
      'archive',
    );

    const acceptanceInspection = workflow.stageInspections.find((stage) => stage.stageKey === 'acceptance');
    const qaInspection = workflow.stageInspections.find((stage) => stage.stageKey === 'qa');
    assert.ok(
      acceptanceInspection?.substages[0]?.files?.some((file) => file.relativePath === '.wo/runs/run-artifacts/acceptance-summary.md'),
      'acceptance summary must be visible from the acceptance stage inspection',
    );
    assert.ok(
      qaInspection?.substages[0]?.files?.some((file) => file.relativePath === '.wo/runs/run-artifacts/qa.json'),
      'QA artifact must be visible from the qa stage inspection',
    );
  });
});

test('missing wo v1.2.0 artifact paths warn without breaking workflow listing', async () => {
  await withTempWoProject(async ({ projectPath }) => {
    await writeRunState(projectPath, 'run-missing-artifact', {
      change_name: '56-适配wo-v1.2.0七阶段工作流',
      status: 'running',
      stage: 'qa',
      stages: {
        acceptance: 'completed',
        qa: 'running',
      },
      paths: {
        qa: '.wo/runs/run-missing-artifact/missing-qa.json',
      },
      sessions: {},
    });

    const [workflow] = await listWorkflowReadModels(projectPath);

    assert.equal(workflow.runId, 'run-missing-artifact');
    assert.ok(
      workflow.diagnostics.warnings.some((warning) => warning.includes('.wo/runs/run-missing-artifact/missing-qa.json')),
      'missing QA artifact path must be reported as a diagnostic warning',
    );
    assert.equal(
      workflow.artifacts.find((artifact) => artifact.relativePath === '.wo/runs/run-missing-artifact/missing-qa.json')?.stage,
      'qa',
    );
  });
});
