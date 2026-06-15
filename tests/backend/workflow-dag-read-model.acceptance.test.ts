// @ts-nocheck -- 创建阶段契约测试：执行阶段负责把 workflowDag 类型收紧。
/**
 * PURPOSE: Verify ozw converts oz flow graph JSON into an inspectable workflow DAG
 * read model where every child session and graph artifact has a review target.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listWorkflowReadModels } from '../../backend/domains/workflows/workflow-read-model.ts';
import { resolveFlowRunsRoot } from '../../backend/domains/workflows/flow-runtime-paths.ts';

const CHANGE_NAME = '90-DAG审查页fixture';
const RUN_ID = 'run-dag-review-contract';

/**
 * Run a callback inside an isolated project, state root, and fake oz flow CLI.
 */
async function withTempDagProject(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-workflow-dag-'));
  const projectPath = path.join(tempRoot, 'project');
  const stateHome = path.join(tempRoot, 'state');
  const graphFixturePath = path.join(tempRoot, 'wo-graph.json');
  const binDir = path.join(tempRoot, 'bin');
  const originalXdgStateHome = process.env.XDG_STATE_HOME;
  const originalPath = process.env.PATH;
  const originalGraphFixture = process.env.WO_GRAPH_FIXTURE;

  await fs.mkdir(projectPath, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(graphFixturePath, `${JSON.stringify(buildWoGraphFixture(), null, 2)}\n`, 'utf8');
  await fs.writeFile(
    path.join(binDir, 'oz'),
    [
      '#!/bin/sh',
      'if [ "$1" = "flow" ]; then shift; fi',
      'if [ "$1" = "graph" ]; then',
      '  cat "$WO_GRAPH_FIXTURE"',
      '  exit 0',
      'fi',
      'if [ "$1" = "contract" ]; then',
      '  printf %s \'{"json":true,"version":"test","capabilities":["list-changes","run","resume","restart","status","abort","graph"]}\'',
      '  exit 0',
      'fi',
      'if [ "$1" = "status" ]; then',
      '  printf "%s\\n" "- 引擎 oz" "- 写 execution-session ✓" "- 审 review-session ✓" "- 测 qa-session ✓" "- 修 fix-session ✓" "- 存 archive-session ✓"',
      '  exit 0',
      'fi',
      'echo "unexpected fake oz flow command: $*" >&2',
      'exit 2',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  process.env.XDG_STATE_HOME = stateHome;
  process.env.WO_GRAPH_FIXTURE = graphFixturePath;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;

  try {
    await callback({ projectPath, tempRoot });
  } finally {
    if (originalXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalXdgStateHome;
    }
    if (originalGraphFixture === undefined) {
      delete process.env.WO_GRAPH_FIXTURE;
    } else {
      process.env.WO_GRAPH_FIXTURE = originalGraphFixture;
    }
    process.env.PATH = originalPath;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Build the minimal oz flow graph shape needed to prove ozw preserves DAG details.
 */
function buildWoGraphFixture() {
  return {
    change_name: CHANGE_NAME,
    display: {
      title: `oz flow workflow: ${CHANGE_NAME}`,
    },
    nodes: [
      {
        id: 'planning_context_1',
        name: 'planning_context subagent: 需求分析员',
        type: 'subagent',
        group: 'planning_context',
        stage: 'execution',
        member: '需求分析员',
        mode: 'advisory',
      },
      {
        id: 'planning_context_fanin',
        name: 'planning_context fan-in',
        type: 'fanin',
        group: 'planning_context',
        stage: 'execution',
        mode: 'advisory',
      },
      {
        id: 'execution',
        name: 'execution',
        type: 'main_stage',
        stage: 'execution',
      },
      {
        id: 'before_review_1_1',
        name: 'review subagent: 目标核对审核员',
        type: 'subagent',
        group: 'before_review',
        stage: 'review_1',
        member: '目标核对审核员',
        mode: 'gate_input',
        iteration: 1,
      },
      {
        id: 'before_review_1_fanin',
        name: 'review fan-in',
        type: 'fanin',
        group: 'before_review',
        stage: 'review_1',
        mode: 'gate_input',
        iteration: 1,
      },
      {
        id: 'review_1',
        name: 'review_1',
        type: 'main_stage',
        stage: 'review_1',
        iteration: 1,
      },
      {
        id: 'gate_review_1',
        name: 'review gate',
        type: 'gate',
        stage: 'review_1',
        iteration: 1,
      },
      {
        id: 'qa_1',
        name: 'qa_1',
        type: 'main_stage',
        stage: 'qa_1',
        iteration: 1,
      },
      {
        id: 'gate_qa_1',
        name: 'QA gate',
        type: 'gate',
        stage: 'qa_1',
        iteration: 1,
      },
      {
        id: 'fix_1',
        name: 'fix_1',
        type: 'main_stage',
        stage: 'fix_1',
        iteration: 1,
      },
      {
        id: 'archive',
        name: 'archive',
        type: 'main_stage',
        stage: 'archive',
      },
    ],
    edges: [
      { from: 'planning_context_1', to: 'planning_context_fanin' },
      { from: 'planning_context_fanin', to: 'execution' },
      { from: 'execution', to: 'before_review_1_1' },
      { from: 'before_review_1_1', to: 'before_review_1_fanin' },
      { from: 'before_review_1_fanin', to: 'review_1' },
      { from: 'review_1', to: 'gate_review_1' },
      { from: 'gate_review_1', to: 'qa_1', label: 'review clean' },
      { from: 'qa_1', to: 'gate_qa_1' },
      { from: 'gate_qa_1', to: 'fix_1', label: 'QA needs_fix' },
      { from: 'fix_1', to: 'archive' },
    ],
    artifacts: [
      { id: 'planning_context_fanin_artifact', path: 'parallel-planning_context.json', node_id: 'planning_context_fanin' },
      { id: 'review_fanin_artifact', path: 'parallel-review-1.json', node_id: 'before_review_1_fanin' },
      { id: 'review_gate_artifact', path: 'review-1.json', node_id: 'gate_review_1' },
      { id: 'review_gate_summary_artifact', path: 'review-1.md', node_id: 'gate_review_1' },
      { id: 'qa_gate_artifact', path: 'qa-1.json', node_id: 'gate_qa_1' },
      { id: 'fix_summary_artifact', path: 'fix-1-summary.md', node_id: 'fix_1' },
      { id: 'archive_artifact', path: 'delivery-summary.md', node_id: 'archive' },
    ],
    gates: [
      { id: 'gate_review_1', name: 'review gate', stage: 'review_1', iteration: 1 },
      { id: 'gate_qa_1', name: 'QA gate', stage: 'qa_1', iteration: 1 },
    ],
  };
}

/**
 * Write a sealed oz flow state and matching run directory artifacts.
 */
async function writeWoRunFixture(projectPath) {
  const runRoot = path.join(resolveFlowRunsRoot(projectPath), RUN_ID);
  await fs.mkdir(runRoot, { recursive: true });
  const artifacts = {
    'parallel-planning_context.json': { summary: '规划上下文 fan-in 产物' },
    'parallel-review-1.json': { summary: '审核子代理 fan-in 产物' },
    'review-1.json': { decision: 'clean', findings: [] },
    'review-1.md': '# Review Summary\n\n审核摘要。\n',
    'qa-1.json': { decision: 'needs_fix', evidence: ['browser path failed'] },
    'fix-1-summary.md': '# Fix\n\n修复 QA 发现的问题。\n',
    'delivery-summary.md': '# Delivery\n\nDAG 审查页交付摘要。\n',
  };

  for (const [fileName, content] of Object.entries(artifacts)) {
    await fs.writeFile(
      path.join(runRoot, fileName),
      typeof content === 'string' ? content : JSON.stringify(content, null, 2),
      'utf8',
    );
  }

  await fs.writeFile(
    path.join(runRoot, 'state.json'),
    `${JSON.stringify({
      run_id: RUN_ID,
      change_name: CHANGE_NAME,
      sealed: true,
      status: 'running',
      stage: 'qa_1',
      stages: {
        execution: 'completed',
        review_1: 'completed',
        qa_1: 'running',
        fix_1: 'pending',
        archive: 'pending',
      },
      sessions: {
        'codex:planner': 'planner-session',
        'codex:executor': 'execution-session',
        'codex:reviewer': 'review-session',
        'codex:qa': 'qa-session',
        'codex:fixer': 'fix-session',
        'codex:archiver': 'archive-session',
      },
      workflow_config: {
        stages: {
          planning: { tool: 'codex' },
          execution: { tool: 'codex' },
          review_1: { tool: 'codex' },
          qa_1: { tool: 'codex' },
          fix_1: { tool: 'codex' },
          archive: { tool: 'codex' },
        },
      },
      paths: {},
    }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Return one DAG node by id with an assertion-friendly error.
 */
function getDagNode(workflow, nodeId) {
  const node = workflow.workflowDag?.nodes?.find((candidate) => candidate.id === nodeId);
  assert.ok(node, `workflowDag.nodes must contain ${nodeId}`);
  return node;
}

/**
 * Assert one review target exists on a DAG node.
 */
function assertReviewTarget(node, kind, pattern) {
  const targets = Array.isArray(node.reviewTargets) ? node.reviewTargets : [];
  const matched = targets.some((target) => (
    target.kind === kind
    && pattern.test(String(target.label || target.path || target.sessionId || ''))
  ));
  assert.ok(
    matched,
    `${node.id} must include ${kind} review target matching ${pattern}; got ${JSON.stringify(targets)}`,
  );
}

test('oz flow graph JSON becomes workflowDag with session and artifact review targets', async () => {
  await withTempDagProject(async ({ projectPath }) => {
    await writeWoRunFixture(projectPath);

    const [workflow] = await listWorkflowReadModels(projectPath);
    assert.ok(workflow, 'workflow must be discovered from real oz flow state path');
    assert.equal(workflow.workflowDag?.source?.format, 'oz flow graph json');
    assert.equal(workflow.workflowDag?.source?.available, true);
    assert.ok(workflow.workflowDag.nodes.length >= 9, 'DAG nodes must be preserved after evidence-based pruning');
    assert.ok(
      workflow.workflowDag.edges.some((edge) => edge.from === 'gate_qa_1' && edge.to === 'fix_1' && edge.label === 'QA needs_fix'),
      'conditional edge labels must be preserved',
    );
    assert.ok(
      workflow.workflowDag.gates.some((gate) => gate.id === 'gate_review_1' && gate.iteration === 1),
      'gate metadata must be preserved',
    );

    assertReviewTarget(getDagNode(workflow, 'execution'), 'session', /execution-session/);
    assertReviewTarget(getDagNode(workflow, 'planning_context_fanin'), 'artifact', /parallel-planning_context\.json/);
    assertReviewTarget(getDagNode(workflow, 'before_review_1_fanin'), 'artifact', /parallel-review-1\.json/);
    assertReviewTarget(getDagNode(workflow, 'gate_review_1'), 'artifact', /review-1\.json/);
    assertReviewTarget(getDagNode(workflow, 'gate_qa_1'), 'artifact', /qa-1\.json/);
    assertReviewTarget(getDagNode(workflow, 'fix_1'), 'artifact', /fix-1-summary\.md/);
    assertReviewTarget(getDagNode(workflow, 'archive'), 'artifact', /delivery-summary\.md/);

    for (const graphArtifact of workflow.workflowDag.artifacts) {
      assert.equal(graphArtifact.exists, true, `${graphArtifact.path} must be marked as existing`);
      assert.ok(graphArtifact.openTarget?.path, `${graphArtifact.path} must expose an openTarget path`);
    }

    const resultDir = path.join(process.cwd(), 'test-results', 'workflow-dag-review');
    await fs.mkdir(resultDir, { recursive: true });
    const snapshotPath = path.join(resultDir, 'read-model-snapshot.json');
    await fs.writeFile(snapshotPath, `${JSON.stringify(workflow.workflowDag, null, 2)}\n`, 'utf8');
  });
});

test('oz flow graph with null artifacts still binds gate/fix/archive artifacts from run directory', async () => {
  await withTempDagProject(async ({ projectPath, tempRoot }) => {
    await writeWoRunFixture(projectPath);

    // Write a graph fixture with artifacts: null to simulate real oz flow output
    const nullArtifactFixture = path.join(tempRoot, 'wo-graph-null-artifacts.json');
    const fixture = buildWoGraphFixture();
    fixture.artifacts = null;
    await fs.writeFile(nullArtifactFixture, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    process.env.WO_GRAPH_FIXTURE = nullArtifactFixture;

    const [workflow] = await listWorkflowReadModels(projectPath);
    assert.ok(workflow, 'workflow must be discovered');
    assert.equal(workflow.workflowDag?.source?.available, true);

    // Gate/fix/archive nodes must still have artifact review targets via fallback
    assertReviewTarget(getDagNode(workflow, 'gate_review_1'), 'artifact', /review-1\.json/);
    assertReviewTarget(getDagNode(workflow, 'gate_qa_1'), 'artifact', /qa-1\.json/);
    assertReviewTarget(getDagNode(workflow, 'fix_1'), 'artifact', /fix-1-summary\.md/);
    assertReviewTarget(getDagNode(workflow, 'archive'), 'artifact', /delivery-summary\.md/);

    // Fanin/subagent nodes without matching child sessions or graph artifacts
    // are legitimately pruned by evidence-based DAG filtering. With null
    // graph artifacts, the fanin nodes lose their artifact evidence and are removed.
    assert.equal(
      workflow.workflowDag.nodes.some((n) => n.id === 'planning_context_fanin'),
      false,
      'fanin node must be pruned without graph artifact evidence',
    );
    assert.equal(
      workflow.workflowDag.nodes.some((n) => n.id === 'before_review_1_fanin'),
      false,
      'before_review_1_fanin must be pruned without graph artifact evidence',
    );
  });
});

test('DAG node statuses merge sealed state dag_nodes and stage statuses', async () => {
  await withTempDagProject(async ({ projectPath, tempRoot }) => {
    await writeWoRunFixture(projectPath);

    // Override state.json with dag_nodes and a current stage
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), RUN_ID);
    const statePath = path.join(runRoot, 'state.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    state.dag_nodes = {
      execution: { status: 'success', finished_at: '2026-06-09T08:07:37.059656943Z' },
      review_1: { status: 'success', finished_at: '2026-06-09T08:12:56.304809329Z' },
      qa_1: { status: 'running', started_at: '2026-06-09T08:12:56.306099706Z' },
    };
    state.stage = 'qa_1';
    state.status = 'running';
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

    const [workflow] = await listWorkflowReadModels(projectPath);
    const execution = getDagNode(workflow, 'execution');
    const review1 = getDagNode(workflow, 'review_1');
    const qa1 = getDagNode(workflow, 'qa_1');
    const fix1 = getDagNode(workflow, 'fix_1');

    assert.equal(execution.status, 'completed', 'execution should reflect dag_nodes success');
    assert.equal(review1.status, 'completed', 'review_1 should reflect dag_nodes success');
    assert.equal(qa1.status, 'active', 'qa_1 should reflect current running stage');
    assert.equal(fix1.status, 'pending', 'fix_1 should remain pending');
  });
});

test('multiple graph artifacts on same node_id generate separate review targets', async () => {
  await withTempDagProject(async ({ projectPath }) => {
    await writeWoRunFixture(projectPath);

    const [workflow] = await listWorkflowReadModels(projectPath);
    const gateNode = getDagNode(workflow, 'gate_review_1');
    const artifactTargets = gateNode.reviewTargets.filter((t) => t.kind === 'artifact');
    assert.equal(artifactTargets.length, 2, 'gate_review_1 must have two artifact targets');
    assert.ok(
      artifactTargets.some((t) => /review-1\.json/.test(String(t.label || t.path))),
      'must include review-1.json target',
    );
    assert.ok(
      artifactTargets.some((t) => /review-1\.md/.test(String(t.label || t.path))),
      'must include review-1.md target',
    );
    for (const target of artifactTargets) {
      assert.equal(target.exists, true, `${target.label} must exist`);
    }
  });
});

test('oz flow graph failure keeps legacy stage inspections and reports diagnostics', async () => {
  await withTempDagProject(async ({ projectPath }) => {
    await writeWoRunFixture(projectPath);
    process.env.WO_GRAPH_FIXTURE = path.join(projectPath, 'missing-graph.json');

    const [workflow] = await listWorkflowReadModels(projectPath);
    assert.ok(workflow.stageInspections.length > 0, 'legacy stage inspections must remain available');
    assert.equal(workflow.workflowDag?.source?.available, false);
    assert.ok(
      workflow.diagnostics?.warnings?.some((warning) => /oz flow graph/i.test(String(warning))),
      'diagnostics must explain that oz flow graph was unavailable',
    );
  });
});
