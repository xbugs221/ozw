// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify oz change planning documents are resolved correctly
 * for active changes, archived changes, and multi-candidate archive directories.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  listWorkflowReadModels,
} from '../../../backend/domains/workflows/workflow-read-model.ts';
import { resolveFlowRunsRoot } from '../../../backend/domains/workflows/flow-runtime-paths.ts';

async function withTestEnv(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-oz-planning-test-'));
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

test('active change returns four planning document artifacts', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const changeName = '2026-05-14-test-feature';
    const changeDir = path.join(projectPath, 'docs', 'changes', changeName);
    await fs.mkdir(changeDir, { recursive: true });

    // Create the four planning documents
    await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\nTest proposal');
    await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\nTest design');
    await fs.writeFile(path.join(changeDir, 'spec.md'), '# Spec\nTest spec');
    await fs.writeFile(path.join(changeDir, 'task.md'), '# Task\nTest task');

    // Create a wo run pointing to this change
    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-active-change');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-active-change',
      change_name: changeName,
      status: 'running',
      stage: 'planning',
      stages: { planning: 'active', execution: 'pending' },
    }));

    const workflows = await listWorkflowReadModels(projectPath);

    assert.equal(workflows.length, 1);
    const wf = workflows[0];

    const planningDocs = wf.artifacts.filter((a) => (
      a.type === 'oz-change-doc' && a.stage === 'planning'
    ));
    assert.equal(planningDocs.length, 4, 'Should have 4 planning document artifacts');

    const expectedDocs = ['proposal.md', 'design.md', 'spec.md', 'task.md'];
    for (const docName of expectedDocs) {
      const doc = planningDocs.find((a) => a.label === docName);
      assert.ok(doc, `Should have ${docName} artifact`);
      assert.equal(doc.exists, true, `${docName} should exist`);
      assert.ok(doc.relativePath.includes(`docs/changes/${changeName}/${docName}`), `${docName} path should point to active change dir`);
    }
  });
});

test('planning documents missing when no oz change is bound', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-no-change');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-no-change',
      change_name: '',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'active' },
    }));

    const workflows = await listWorkflowReadModels(projectPath);

    assert.equal(workflows.length, 1);
    const wf = workflows[0];
    const planningDocs = wf.artifacts.filter((a) => a.type === 'oz-change-doc');
    assert.equal(planningDocs.length, 0, 'Should have no planning docs when change_name is empty');
  });
});

test('archived change resolves to archive directory', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const changeName = '2026-05-14-archived-feature';
    const archiveDirName = `2026-05-14-archived-feature`;
    const archiveDir = path.join(projectPath, 'docs', 'changes', 'archive', archiveDirName);
    await fs.mkdir(archiveDir, { recursive: true });

    // Create documents in archive
    await fs.writeFile(path.join(archiveDir, 'proposal.md'), '# Proposal\nArchived proposal');
    await fs.writeFile(path.join(archiveDir, 'design.md'), '# Design\nArchived design');
    await fs.writeFile(path.join(archiveDir, 'spec.md'), '# Spec\nArchived spec');
    // task.md intentionally missing to test exists: false

    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-archived-change');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-archived-change',
      change_name: changeName,
      status: 'done',
      stage: 'done',
      stages: { planning: 'completed', execution: 'completed', archive: 'completed' },
    }));

    const workflows = await listWorkflowReadModels(projectPath);

    const wf = workflows[0];
    const planningDocs = wf.artifacts.filter((a) => (
      a.type === 'oz-change-doc' && a.stage === 'planning'
    ));
    assert.equal(planningDocs.length, 4, 'Should have 4 planning document artifacts');

    const proposal = planningDocs.find((a) => a.label === 'proposal.md');
    assert.equal(proposal.exists, true, 'proposal.md should exist');
    assert.ok(proposal.relativePath.includes(`docs/changes/archive/${archiveDirName}/proposal.md`), 'proposal.md path should point to archive');

    const task = planningDocs.find((a) => a.label === 'task.md');
    assert.equal(task.exists, false, 'task.md should be marked as not existing');
    assert.ok(task.relativePath.includes('docs/changes/archive'), 'task.md path should still reference the archive dir');
  });
});

test('archive with date-prefixed directory resolves correctly', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const changeName = 'simple-change';
    // Archive dir with date prefix
    const archiveDirName = `2026-05-14-${changeName}`;
    const archiveDir = path.join(projectPath, 'docs', 'changes', 'archive', archiveDirName);
    await fs.mkdir(archiveDir, { recursive: true });

    await fs.writeFile(path.join(archiveDir, 'proposal.md'), '# Proposal');
    await fs.writeFile(path.join(archiveDir, 'design.md'), '# Design');
    await fs.writeFile(path.join(archiveDir, 'spec.md'), '# Spec');
    await fs.writeFile(path.join(archiveDir, 'task.md'), '# Task');

    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-dated-archive');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-dated-archive',
      change_name: changeName,
      status: 'done',
      stage: 'done',
      stages: { planning: 'completed', execution: 'completed', archive: 'completed' },
    }));

    const workflows = await listWorkflowReadModels(projectPath);

    const wf = workflows[0];
    const planningDocs = wf.artifacts.filter((a) => (
      a.type === 'oz-change-doc' && a.stage === 'planning'
    ));
    assert.equal(planningDocs.length, 4);
    for (const doc of planningDocs) {
      assert.equal(doc.exists, true, `${doc.label} should exist`);
      assert.ok(doc.relativePath.includes(`docs/changes/archive/${archiveDirName}/`), `${doc.label} path should point to archive with date prefix`);
    }
  });
});

test('archive with multiple candidates selects latest mtime', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const changeName = 'multi-candidate-change';

    // Create two matching archive directories
    const olderDir = path.join(projectPath, 'docs', 'changes', 'archive', `2026-05-13-${changeName}`);
    const newerDir = path.join(projectPath, 'docs', 'changes', 'archive', `2026-05-14-${changeName}`);
    await fs.mkdir(olderDir, { recursive: true });
    await fs.mkdir(newerDir, { recursive: true });

    // Write different content to distinguish
    await fs.writeFile(path.join(olderDir, 'proposal.md'), 'Older proposal');
    await fs.writeFile(path.join(olderDir, 'design.md'), 'Older design');
    await fs.writeFile(path.join(olderDir, 'spec.md'), 'Older spec');
    await fs.writeFile(path.join(olderDir, 'task.md'), 'Older task');

    await fs.writeFile(path.join(newerDir, 'proposal.md'), 'Newer proposal');
    await fs.writeFile(path.join(newerDir, 'design.md'), 'Newer design');
    await fs.writeFile(path.join(newerDir, 'spec.md'), 'Newer spec');
    await fs.writeFile(path.join(newerDir, 'task.md'), 'Newer task');

    // Ensure newer dir has a later mtime
    const now = new Date();
    const olderTime = new Date(now.getTime() - 10000);
    await fs.utimes(olderDir, olderTime, olderTime);

    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-multi-candidate');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-multi-candidate',
      change_name: changeName,
      status: 'done',
      stage: 'done',
      stages: { planning: 'completed', execution: 'completed', archive: 'completed' },
    }));

    const workflows = await listWorkflowReadModels(projectPath);

    const wf = workflows[0];
    const planningDocs = wf.artifacts.filter((a) => (
      a.type === 'oz-change-doc' && a.stage === 'planning'
    ));
    assert.equal(planningDocs.length, 4);

    // Should resolve to the newer directory
    const proposal = planningDocs.find((a) => a.label === 'proposal.md');
    assert.equal(proposal.exists, true);
    assert.ok(proposal.relativePath.includes(`2026-05-14-${changeName}`), 'Should use the newer mtime directory');
  });
});

test('exact archive match yields to newer suffix candidate on mtime', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const changeName = 'exact-vs-suffix';

    // Exact match directory (older)
    const exactDir = path.join(projectPath, 'docs', 'changes', 'archive', changeName);
    await fs.mkdir(exactDir, { recursive: true });
    await fs.writeFile(path.join(exactDir, 'proposal.md'), 'Exact-old');
    await fs.writeFile(path.join(exactDir, 'design.md'), 'Exact-old');
    await fs.writeFile(path.join(exactDir, 'spec.md'), 'Exact-old');
    await fs.writeFile(path.join(exactDir, 'task.md'), 'Exact-old');

    // Suffix directory (newer)
    const suffixDir = path.join(projectPath, 'docs', 'changes', 'archive', `2026-05-14-${changeName}`);
    await fs.mkdir(suffixDir, { recursive: true });
    await fs.writeFile(path.join(suffixDir, 'proposal.md'), 'Suffix-newer');
    await fs.writeFile(path.join(suffixDir, 'design.md'), 'Suffix-newer');
    await fs.writeFile(path.join(suffixDir, 'spec.md'), 'Suffix-newer');
    await fs.writeFile(path.join(suffixDir, 'task.md'), 'Suffix-newer');

    // Make exact match older
    const now = new Date();
    const olderTime = new Date(now.getTime() - 10000);
    await fs.utimes(exactDir, olderTime, olderTime);

    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-exact-vs-suffix');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-exact-vs-suffix',
      change_name: changeName,
      status: 'done',
      stage: 'done',
      stages: { planning: 'completed', execution: 'completed', archive: 'completed' },
    }));

    const workflows = await listWorkflowReadModels(projectPath);

    const wf = workflows[0];
    const planningDocs = wf.artifacts.filter((a) => (
      a.type === 'oz-change-doc' && a.stage === 'planning'
    ));
    assert.equal(planningDocs.length, 4);

    // Should resolve to the newer suffix directory, not the older exact match
    const proposal = planningDocs.find((a) => a.label === 'proposal.md');
    assert.equal(proposal.exists, true);
    assert.ok(proposal.relativePath.includes(`2026-05-14-${changeName}`), 'Older exact match must not shadow newer suffix directory');
  });
});

test('planning stage inspection includes oz doc artifacts', async () => {
  await withTestEnv(async ({ projectPath }) => {
    const changeName = '2026-05-14-test-inspection';
    const changeDir = path.join(projectPath, 'docs', 'changes', changeName);
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal');
    await fs.writeFile(path.join(changeDir, 'design.md'), '# Design');
    await fs.writeFile(path.join(changeDir, 'spec.md'), '# Spec');
    await fs.writeFile(path.join(changeDir, 'task.md'), '# Task');

    const runsRoot = resolveFlowRunsRoot(projectPath);
    const runDir = path.join(runsRoot, 'run-inspection');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
      run_id: 'run-inspection',
      change_name: changeName,
      status: 'running',
      stage: 'planning',
      stages: { planning: 'active', execution: 'pending' },
    }));

    const workflows = await listWorkflowReadModels(projectPath);

    const wf = workflows[0];
    const planningStage = wf.stageInspections.find((s) => s.stageKey === 'planning');
    assert.ok(planningStage, 'Should have planning stage inspection');

    const planningFiles = planningStage.substages[0].files;
    const ozDocs = planningFiles.filter((f) => f.type === 'oz-change-doc');
    assert.equal(ozDocs.length, 4, 'Planning substage should have 4 oz doc files');
    for (const doc of ozDocs) {
      assert.equal(doc.exists, true, `${doc.label} should exist in inspection`);
    }
  });
});
