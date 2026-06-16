// Sources: 17-Workflow读模型Schema化, 23-工作流读模型stage-session规则统一, 90-适配oz flow合入oz后的DAG工作流审查页, 93-对齐oz flow状态栏新格式, 99-重设计oz flow工作流卡片移除DAG审查
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
import {
  acceptedProviderFromSessionKey,
  inferSubagentRoleStage,
  resolvePlannerSessionRef,
  resolveSessionProviderFromState,
} from '../../backend/domains/workflows/read-model/stage-session-resolver.ts';


const CHANGE_NAME = '90-DAG审查页fixture';
const RUN_ID = 'run-dag-review-contract';
const WORKFLOW_BOUNDARY_EVIDENCE_DIR = path.join(process.cwd(), 'test-results', '10-workflow-boundary');
const WORKFLOW_SCHEMA_EVIDENCE_DIR = path.join(process.cwd(), 'test-results', '17-workflow-read-model-schema');
const WORKFLOW_STAGE_SESSION_EVIDENCE_DIR = path.join(process.cwd(), 'test-results', '23-workflow-stage-session');

/**
 * 判断仓库相对路径是否存在。
 */
async function repoPathExists(relativePath) {
  try {
    await fs.access(path.join(process.cwd(), relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取仓库源码文件。
 */
async function readRepoSource(relativePath) {
  return fs.readFile(path.join(process.cwd(), relativePath), 'utf8');
}

/**
 * 统计 read model 源码里的宽泛 any 使用。
 */
function countAnyRecords(source) {
  return (source.match(/Record<string,\s*any>|\bany\b/g) || []).length;
}

/**
 * 写入 workflow schema 源码审计证据。
 */
async function writeWorkflowSchemaAudit(snapshot) {
  await fs.mkdir(WORKFLOW_SCHEMA_EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(WORKFLOW_SCHEMA_EVIDENCE_DIR, 'source-audit.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );
}

/**
 * 写入 stage/session resolver 源码审计证据。
 */
async function writeWorkflowStageSessionAudit(snapshot) {
  await fs.mkdir(WORKFLOW_STAGE_SESSION_EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(WORKFLOW_STAGE_SESSION_EVIDENCE_DIR, 'source-audit.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );
}

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

    await fs.mkdir(WORKFLOW_BOUNDARY_EVIDENCE_DIR, { recursive: true });
    await fs.writeFile(
      path.join(WORKFLOW_BOUNDARY_EVIDENCE_DIR, 'readmodel.json'),
      `${JSON.stringify({
        id: workflow.id,
        title: workflow.title,
        stage: workflow.stage,
        runState: workflow.runState,
        dagSource: workflow.workflowDag?.source,
        nodeCount: workflow.workflowDag?.nodes.length || 0,
        artifactCount: workflow.workflowDag?.artifacts.length || 0,
        childSessionCount: workflow.childSessions.length,
        stageInspectionCount: workflow.stageInspections.length,
      }, null, 2)}\n`,
      'utf8',
    );
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
    // are legitimately pruned by evidence-based DAG filtering.  With null
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

// --- 以下合并自 93-对齐oz flow状态栏新格式 ---

const CHANGE_NAME_93 = '93-状态栏新格式fixture';
const RUN_ID_93 = 'run-status-watch-dag-contract';

/**
 * Run a callback inside an isolated project, state root, and fake oz flow CLI
 * for status/watch summary and DAG pruning tests.
 */
async function withTempStatusProject(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-wo-status-watch-dag-'));
  const projectPath = path.join(tempRoot, 'project');
  const stateHome = path.join(tempRoot, 'state');
  const binDir = path.join(tempRoot, 'bin');
  const graphFixturePath = path.join(tempRoot, 'wo-graph-30-rounds.json');
  const statusFixturePath = path.join(tempRoot, 'wo-status.json');
  const statusCalledPath = path.join(tempRoot, 'wo-status-called.txt');
  const originalXdgStateHome = process.env.XDG_STATE_HOME;
  const originalPath = process.env.PATH;
  const originalGraphFixture = process.env.WO_GRAPH_FIXTURE;
  const originalStatusFixture = process.env.WO_STATUS_FIXTURE;
  const originalStatusCalledFile = process.env.WO_STATUS_CALLED_FILE;
  const originalStatusForceFixture = process.env.WO_STATUS_FORCE_FIXTURE;
  const originalStatusFail = process.env.WO_STATUS_FAIL;

  await fs.mkdir(projectPath, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(graphFixturePath, `${JSON.stringify(buildThirtyRoundGraphFixture(), null, 2)}\n`, 'utf8');
  await fs.writeFile(statusFixturePath, `${JSON.stringify(buildStatusJsonFixture(), null, 2)}\n`, 'utf8');
  await fs.writeFile(
    path.join(binDir, 'oz'),
    [
      '#!/bin/sh',
      'if [ "$1" = "flow" ]; then shift; fi',
      'if [ "$1" = "graph" ]; then',
      '  cat "$WO_GRAPH_FIXTURE"',
      '  exit 0',
      'fi',
      'if [ "$1" = "status" ]; then',
      '  if [ "$2" = "--run-id" ] && [ "$4" = "--json" ]; then',
      '    printf "%s\\n" "$3" >> "$WO_STATUS_CALLED_FILE"',
      '    if [ "$WO_STATUS_FAIL" = "1" ]; then',
      '      echo "forced oz flow status failure" >&2',
      '      exit 2',
      '    fi',
      '    if [ "$WO_STATUS_FORCE_FIXTURE" = "1" ]; then',
      '      cat "$WO_STATUS_FIXTURE"',
      '      exit 0',
      '    fi',
      '    state_file="$(find "$XDG_STATE_HOME/oz/flow" -path "*/runs/$3/state.json" -type f -print -quit 2>/dev/null)"',
      '    if [ -n "$state_file" ]; then',
      '      cat "$state_file"',
      '      exit 0',
      '    fi',
      '    cat "$WO_STATUS_FIXTURE"',
      '    exit 0',
      '  fi',
      '  echo "human oz flow status output is not a ozw read-model API" >&2',
      '  exit 2',
      'fi',
      'if [ "$1" = "watch" ]; then',
      '  echo "human oz flow watch output is not a ozw read-model API" >&2',
      '  exit 2',
      'fi',
      'echo "unexpected fake oz flow command: $*" >&2',
      'exit 2',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  process.env.XDG_STATE_HOME = stateHome;
  process.env.WO_GRAPH_FIXTURE = graphFixturePath;
  process.env.WO_STATUS_FIXTURE = statusFixturePath;
  process.env.WO_STATUS_CALLED_FILE = statusCalledPath;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;

  try {
    await callback({ projectPath, tempRoot, graphFixturePath, statusCalledPath });
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
    if (originalStatusFixture === undefined) {
      delete process.env.WO_STATUS_FIXTURE;
    } else {
      process.env.WO_STATUS_FIXTURE = originalStatusFixture;
    }
    if (originalStatusCalledFile === undefined) {
      delete process.env.WO_STATUS_CALLED_FILE;
    } else {
      process.env.WO_STATUS_CALLED_FILE = originalStatusCalledFile;
    }
    if (originalStatusForceFixture === undefined) {
      delete process.env.WO_STATUS_FORCE_FIXTURE;
    } else {
      process.env.WO_STATUS_FORCE_FIXTURE = originalStatusForceFixture;
    }
    if (originalStatusFail === undefined) {
      delete process.env.WO_STATUS_FAIL;
    } else {
      process.env.WO_STATUS_FAIL = originalStatusFail;
    }
    process.env.PATH = originalPath;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Build a fake oz flow graph payload that expands max_review_iterations=30.
 */
function buildThirtyRoundGraphFixture() {
  const nodes = [
    { id: 'execution', name: 'execution', type: 'main_stage', stage: 'execution' },
  ];
  const edges = [];
  const gates = [];

  let previous = 'execution';
  for (let index_93 = 1; index_93 <= 30; index_93 += 1) {
    nodes.push(
      { id: `review_${index_93}`, name: `review_${index_93}`, type: 'main_stage', stage: `review_${index_93}`, iteration: index_93 },
      { id: `gate_review_${index_93}`, name: 'review gate', type: 'gate', stage: `review_${index_93}`, iteration: index_93 },
      { id: `qa_${index_93}`, name: `qa_${index_93}`, type: 'main_stage', stage: `qa_${index_93}`, iteration: index_93 },
      { id: `gate_qa_${index_93}`, name: 'QA gate', type: 'gate', stage: `qa_${index_93}`, iteration: index_93 },
      { id: `fix_${index_93}`, name: `fix_${index_93}`, type: 'main_stage', stage: `fix_${index_93}`, iteration: index_93 },
    );
    edges.push(
      { from: previous, to: `review_${index_93}` },
      { from: `review_${index_93}`, to: `gate_review_${index_93}` },
      { from: `gate_review_${index_93}`, to: `qa_${index_93}`, label: 'review clean' },
      { from: `gate_review_${index_93}`, to: `fix_${index_93}`, label: 'review needs_fix' },
      { from: `qa_${index_93}`, to: `gate_qa_${index_93}` },
      { from: `gate_qa_${index_93}`, to: `fix_${index_93}`, label: 'QA needs_fix' },
    );
    gates.push(
      { id: `gate_review_${index_93}`, name: 'review gate', stage: `review_${index_93}`, iteration: index_93 },
      { id: `gate_qa_${index_93}`, name: 'QA gate', stage: `qa_${index_93}`, iteration: index_93 },
    );
    previous = `fix_${index_93}`;
  }

  nodes.push(
    { id: 'gate_archive', name: 'archive gate', type: 'gate', stage: 'archive' },
    { id: 'archive', name: 'archive', type: 'main_stage', stage: 'archive' },
  );
  edges.push(
    { from: 'gate_qa_30', to: 'gate_archive', label: 'QA clean' },
    { from: 'gate_archive', to: 'archive' },
  );
  gates.push({ id: 'gate_archive', name: 'archive gate', stage: 'archive' });

  return {
    change_name: CHANGE_NAME_93,
    nodes,
    edges,
    artifacts: null,
    gates,
    display: { title: `oz flow workflow: ${CHANGE_NAME_93}` },
  };
}

/**
 * Build the JSON status payload that matches the real oz flow status --run-id API.
 */
function buildStatusJsonFixture() {
  return {
    run_id: RUN_ID_93,
    change_name: CHANGE_NAME_93,
    engine: 'go-dag',
    status: 'running',
    stage: 'archive',
    stages: runtimeStages_93(),
    paths: {},
    sessions: runtimeSessions_93(),
    error: '',
  };
}

function runtimeStages_93() {
  return {
    execution: 'completed',
    review_1: 'completed',
    fix_1: 'completed',
    review_2: 'completed',
    fix_2: 'completed',
    review_3: 'completed',
    qa_3: 'completed',
    archive: 'running',
  };
}

function runtimeSessions_93() {
  return {
    'pi:executor': 'executor-session-status',
    'codex:reviewer': 'reviewer-session-status',
    'pi:fixer': 'fixer-session-status',
    'codex:qa': 'qa-session-status',
    'pi:archiver': 'archiver-session-status',
  };
}

async function writeOzChangeFixture(projectPath) {
  const changeDir = path.join(projectPath, 'docs', 'changes', CHANGE_NAME_93);
  const testsDir = path.join(changeDir, 'tests');
  const extraDir = path.join(changeDir, 'notes');
  await fs.mkdir(testsDir, { recursive: true });
  await fs.mkdir(extraDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, 'brief.md'), '# Brief\n\n真实顶层 brief 规划产物。\n', 'utf8');
  await fs.writeFile(
    path.join(changeDir, 'proposal.md'),
    `# ${CHANGE_NAME_93}\n\n用于证明 ozw 从 active oz change 读取计划文档。\n`,
    'utf8',
  );
  await fs.writeFile(path.join(changeDir, 'design.md'), '# 设计\n\n运行态来自 oz flow sealed state。\n', 'utf8');
  await fs.writeFile(
    path.join(changeDir, 'spec.md'),
    '# 规格\n\n### 需求：状态摘要\n\n#### 场景：只统计真实运行态\n\n- 当 ozw 读取 oz flow sealed state\n- 那么 不得显示 30 轮模板\n',
    'utf8',
  );
  await fs.writeFile(path.join(changeDir, 'task.md'), '# 任务\n\n- [ ] 运行契约测试\n', 'utf8');
  await fs.writeFile(
    path.join(changeDir, 'acceptance.json'),
    `${JSON.stringify({
      summary: 'fixture acceptance contract',
      coverage: [],
      required_tests: [],
      required_evidence: [],
    }, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(testsDir, 'oz-change-fixture.test.ts'),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\n\ntest('oz fixture exists', () => assert.ok(true));\n",
    'utf8',
  );
  await fs.writeFile(path.join(extraDir, 'qa-note.md'), '# QA Note\n', 'utf8');
  await fs.writeFile(path.join(changeDir, 'z-extra.md'), '# Extra planning artifact\n', 'utf8');
}

async function writeStatusRunFixture(projectPath, stateOverrides = {}) {
  const runRoot = path.join(resolveFlowRunsRoot(projectPath), RUN_ID_93);
  await fs.mkdir(runRoot, { recursive: true });
  await fs.writeFile(path.join(runRoot, 'review-1.json'), '{"decision":"needs_fix"}\n', 'utf8');
  await fs.writeFile(path.join(runRoot, 'fix-1-summary.md'), '# Fix 1\n', 'utf8');
  await fs.writeFile(path.join(runRoot, 'review-2.json'), '{"decision":"needs_fix"}\n', 'utf8');
  await fs.writeFile(path.join(runRoot, 'fix-2-summary.md'), '# Fix 2\n', 'utf8');
  await fs.writeFile(path.join(runRoot, 'review-3.json'), '{"decision":"clean"}\n', 'utf8');
  await fs.writeFile(path.join(runRoot, 'qa-3.json'), '{"decision":"clean"}\n', 'utf8');
  await fs.writeFile(
    path.join(runRoot, 'state.json'),
    `${JSON.stringify({
      run_id: RUN_ID_93,
      change_name: CHANGE_NAME_93,
      sealed: true,
      engine: 'go-dag',
      status: 'running',
      stage: 'archive',
      stages: runtimeStages_93(),
      sessions: runtimeSessions_93(),
      workflow_config: {
        engine: 'go-dag',
        max_review_iterations: 30,
      },
      paths: {},
      error: '',
      ...stateOverrides,
    }, null, 2)}\n`,
    'utf8',
  );
}

async function writeStageKeySessionRunFixture(projectPath) {
  const runRoot = path.join(resolveFlowRunsRoot(projectPath), RUN_ID_93);
  await fs.mkdir(runRoot, { recursive: true });
  await fs.writeFile(
    path.join(runRoot, 'state.json'),
    `${JSON.stringify({
      run_id: RUN_ID_93,
      change_name: CHANGE_NAME_93,
      sealed: true,
      engine: 'go-dag',
      status: 'running',
      stage: 'archive',
      stages: runtimeStages_93(),
      sessions: {
        execution: 'stage-key-exec-thread',
        review_1: 'stage-key-review-thread',
        fix_1: 'stage-key-fix-thread',
        qa_3: 'stage-key-qa-thread',
        archive: 'stage-key-archive-thread',
      },
      workflow_config: {
        engine: 'go-dag',
        max_review_iterations: 30,
      },
      paths: {},
      error: '',
    }, null, 2)}\n`,
    'utf8',
  );
}

async function writePlannerSessionOnlyRunFixture(projectPath, sessionKey, sessionId, planningTool = 'codex') {
  const runRoot = path.join(resolveFlowRunsRoot(projectPath), RUN_ID_93);
  await fs.mkdir(runRoot, { recursive: true });
  await fs.writeFile(
    path.join(runRoot, 'state.json'),
    `${JSON.stringify({
      run_id: RUN_ID_93,
      change_name: CHANGE_NAME_93,
      sealed: true,
      engine: 'go-dag',
      status: 'running',
      stage: 'execution',
      stages: {
        execution: 'running',
      },
      sessions: {
        [sessionKey]: sessionId,
      },
      workflow_config: {
        engine: 'go-dag',
        max_review_iterations: 30,
        stages: {
          planning: {
            tool: planningTool,
          },
        },
      },
      paths: {},
      error: '',
    }, null, 2)}\n`,
    'utf8',
  );
}

async function writePendingOnlyRunFixture(projectPath) {
  const runRoot = path.join(resolveFlowRunsRoot(projectPath), RUN_ID_93);
  await fs.mkdir(runRoot, { recursive: true });
  await fs.writeFile(
    path.join(runRoot, 'state.json'),
    `${JSON.stringify({
      run_id: RUN_ID_93,
      change_name: CHANGE_NAME_93,
      sealed: true,
      engine: 'go-dag',
      status: 'running',
      stage: 'execution',
      stages: {
        execution: 'running',
        review_1: 'pending',
        fix_1: 'pending',
        archive: 'pending',
      },
      sessions: {},
      workflow_config: {
        engine: 'go-dag',
        max_review_iterations: 30,
      },
      paths: {},
      error: '',
    }, null, 2)}\n`,
    'utf8',
  );
}

async function readWorkflow_93(projectPath) {
  const workflows = await listWorkflowReadModels(projectPath);
  const workflow = workflows.find((candidate) => candidate.runId === RUN_ID_93);
  assert.ok(workflow, 'workflow must be discovered from the real oz flow run state path');
  return workflow;
}

function statusRowMap(workflow) {
  const summary = workflow.workflowStatusSummary;
  assert.ok(summary, 'workflowStatusSummary must exist for oz flow status/watch role summary rendering');
  assert.equal(summary.source?.format, 'oz flow status/watch');
  assert.equal(summary.source?.runtimeOnly, true);
  return new Map(summary.rows.map((row) => [row.key, row]));
}

function assertStatusRow(rows, key, expected) {
  const row = rows.get(key);
  assert.ok(row, `status summary must contain ${key}`);
  assert.equal(row.markerText, expected.markerText, `${key} markerText must match oz flow status/watch`);
  assert.deepEqual(row.stageKeys, expected.stageKeys, `${key} stageKeys must come from runtime stages`);
  if (expected.sessionId) {
    assert.equal(row.sessionId, expected.sessionId, `${key} session must come from runtime sessions`);
  }
}

function dagNodeIds_93(workflow) {
  assert.equal(workflow.workflowDag?.source?.available, true, 'fake oz flow graph must be available');
  return workflow.workflowDag.nodes.map((node) => node.id);
}

function assertEdgesReferenceVisibleNodes_93(workflow) {
  const visible = new Set(dagNodeIds_93(workflow));
  for (const edge of workflow.workflowDag.edges) {
    assert.ok(visible.has(edge.from), `edge.from ${edge.from} must remain visible after pruning`);
    assert.ok(visible.has(edge.to), `edge.to ${edge.to} must remain visible after pruning`);
  }
}

test('status summary uses oz flow status/watch markers instead of max review iteration count', async () => {
  await withTempStatusProject(async ({ projectPath, statusCalledPath }) => {
    await writeOzChangeFixture(projectPath);
    process.env.WO_STATUS_FORCE_FIXTURE = '1';
    await writeStatusRunFixture(projectPath, {
      sessions: {
        'pi:executor': 'sealed-state-stale-executor',
        'codex:reviewer': 'sealed-state-stale-reviewer',
        'pi:fixer': 'sealed-state-stale-fixer',
        'codex:qa': 'sealed-state-stale-qa',
        'pi:archiver': 'sealed-state-stale-archiver',
      },
    });

    const workflow = await readWorkflow_93(projectPath);
    const rows = statusRowMap(workflow);
    const ozDocLabels = workflow.artifacts
      .filter((artifact) => artifact.type === 'oz-change-doc')
      .map((artifact) => artifact.label);

    assert.equal(workflow.openspecChangeName, CHANGE_NAME_93);
    assert.deepEqual(
      ozDocLabels,
      ['brief.md', 'proposal.md', 'design.md', 'spec.md', 'task.md', 'acceptance.json', 'tests/oz-change-fixture.test.ts', 'z-extra.md'],
      'planning files must be discovered and priority-sorted from the active oz change directory',
    );
    assert.ok(
      workflow.artifacts.some((artifact) => (
        artifact.label === 'tests/oz-change-fixture.test.ts'
        && artifact.type === 'oz-change-doc'
        && artifact.stage === 'planning'
        && artifact.exists === true
      )),
      'planning tests must be discovered as concrete openable file artifacts',
    );
    assert.equal(
      workflow.artifacts.some((artifact) => artifact.label === 'tests/'),
      false,
      'planning tests directory must not be exposed as a coarse artifact link',
    );
    assert.ok(
      workflow.artifacts.some((artifact) => (
        artifact.label === 'notes/'
        && artifact.type === 'directory'
        && artifact.stage === 'planning'
        && artifact.exists === true
      )),
      'extra top-level planning directories must be appended as directory artifacts',
    );
    assert.equal(workflow.workflowStatusSummary.engine, 'go-dag');
    assert.doesNotMatch(
      JSON.stringify(workflow.workflowStatusSummary),
      /sealed-state-stale-/,
      'oz flow status --json must override stale sealed state sessions in the summary',
    );
    assert.equal(
      (await fs.readFile(statusCalledPath, 'utf8')).trim(),
      RUN_ID_93,
      'read model must call oz flow status --run-id <run-id> --json instead of leaving fake CLI dead code',
    );
    assertStatusRow(rows, 'executor', {
      markerText: '✓',
      stageKeys: ['execution'],
      sessionId: 'executor-session-status',
    });
    assertStatusRow(rows, 'reviewer', {
      markerText: '✓✓✓',
      stageKeys: ['review_1', 'review_2', 'review_3'],
      sessionId: 'reviewer-session-status',
    });
    assertStatusRow(rows, 'fixer', {
      markerText: '✓✓',
      stageKeys: ['fix_1', 'fix_2'],
      sessionId: 'fixer-session-status',
    });
    assertStatusRow(rows, 'qa', {
      markerText: '✓',
      stageKeys: ['qa_3'],
      sessionId: 'qa-session-status',
    });
    assertStatusRow(rows, 'archiver', {
      markerText: '→',
      stageKeys: ['archive'],
      sessionId: 'archiver-session-status',
    });
    assert.doesNotMatch(
      JSON.stringify(workflow.workflowStatusSummary),
      /x30|✓{30}|review_30|fix_30|qa_30/,
      'status summary must not expose the max_review_iterations=30 template as runtime status',
    );
  });
});

test('status summary falls back to sealed state when oz flow status json is unavailable', async () => {
  await withTempStatusProject(async ({ projectPath, statusCalledPath }) => {
    await writeOzChangeFixture(projectPath);
    process.env.WO_STATUS_FAIL = '1';
    await writeStageKeySessionRunFixture(projectPath);

    const workflow = await readWorkflow_93(projectPath);
    const rows = statusRowMap(workflow);

    assert.equal(
      (await fs.readFile(statusCalledPath, 'utf8')).trim(),
      RUN_ID_93,
      'read model must attempt oz flow status before falling back to sealed state',
    );
    assert.ok(
      workflow.diagnostics?.warnings?.some((message) => String(message).includes('oz flow status json unavailable')),
      'fallback path must record why oz flow status json was unavailable',
    );
    assertStatusRow(rows, 'executor', {
      markerText: '✓',
      stageKeys: ['execution'],
      sessionId: 'stage-key-exec-thread',
    });
    assertStatusRow(rows, 'reviewer', {
      markerText: '✓✓✓',
      stageKeys: ['review_1', 'review_2', 'review_3'],
      sessionId: 'stage-key-review-thread',
    });
    assertStatusRow(rows, 'fixer', {
      markerText: '✓✓',
      stageKeys: ['fix_1', 'fix_2'],
      sessionId: 'stage-key-fix-thread',
    });
    assertStatusRow(rows, 'qa', {
      markerText: '✓',
      stageKeys: ['qa_3'],
      sessionId: 'stage-key-qa-thread',
    });
    assertStatusRow(rows, 'archiver', {
      markerText: '→',
      stageKeys: ['archive'],
      sessionId: 'stage-key-archive-thread',
    });
  });
});

test('status summary binds sessions when runner uses stage-key session map', async () => {
  await withTempStatusProject(async ({ projectPath }) => {
    await writeOzChangeFixture(projectPath);
    await writeStageKeySessionRunFixture(projectPath);

    const workflow = await readWorkflow_93(projectPath);
    const rows = statusRowMap(workflow);

    assertStatusRow(rows, 'executor', {
      markerText: '✓',
      stageKeys: ['execution'],
      sessionId: 'stage-key-exec-thread',
    });
    assertStatusRow(rows, 'reviewer', {
      markerText: '✓✓✓',
      stageKeys: ['review_1', 'review_2', 'review_3'],
      sessionId: 'stage-key-review-thread',
    });
    assertStatusRow(rows, 'fixer', {
      markerText: '✓✓',
      stageKeys: ['fix_1', 'fix_2'],
      sessionId: 'stage-key-fix-thread',
    });
    assertStatusRow(rows, 'qa', {
      markerText: '✓',
      stageKeys: ['qa_3'],
      sessionId: 'stage-key-qa-thread',
    });
    assertStatusRow(rows, 'archiver', {
      markerText: '→',
      stageKeys: ['archive'],
      sessionId: 'stage-key-archive-thread',
    });
  });
});

test('DAG session targets preserve provider when state sessions reuse the same id', async () => {
  await withTempStatusProject(async ({ projectPath }) => {
    await writeOzChangeFixture(projectPath);
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), RUN_ID_93);
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(
      path.join(runRoot, 'state.json'),
      `${JSON.stringify({
        run_id: RUN_ID_93,
        change_name: CHANGE_NAME_93,
        sealed: true,
        engine: 'go-dag',
        status: 'running',
        stage: 'review_1',
        stages: {
          execution: 'completed',
          review_1: 'running',
        },
        sessions: {
          'codex:reviewer': 'same-provider-session-id',
          'pi:executor': 'same-provider-session-id',
        },
        workflow_config: {
          engine: 'go-dag',
          max_review_iterations: 30,
        },
        paths: {},
        error: '',
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await readWorkflow_93(projectPath);
    const rows = statusRowMap(workflow);
    assertStatusRow(rows, 'executor', {
      markerText: '✓',
      stageKeys: ['execution'],
      sessionId: 'same-provider-session-id',
    });
    assert.equal(rows.get('executor')?.provider, 'pi', 'executor summary must keep pi provider');
    assertStatusRow(rows, 'reviewer', {
      markerText: '→',
      stageKeys: ['review_1'],
      sessionId: 'same-provider-session-id',
    });
    assert.equal(rows.get('reviewer')?.provider, 'codex', 'reviewer summary must keep codex provider');

    const executionTarget = workflow.workflowDag.nodes
      .find((node) => node.id === 'execution')
      ?.reviewTargets.find((target) => target.kind === 'session');
    const reviewTarget = workflow.workflowDag.nodes
      .find((node) => node.id === 'review_1')
      ?.reviewTargets.find((target) => target.kind === 'session');

    assert.equal(executionTarget?.provider, 'pi', 'execution DAG target must keep provider from pi:executor key');
    assert.equal(executionTarget?.routePath, `/runs/${RUN_ID_93}/sessions/execution`, 'execution DAG target must route to execution child session');
    assert.equal(reviewTarget?.provider, 'codex', 'review DAG target must keep provider from codex:reviewer key');
    assert.equal(reviewTarget?.routePath, `/runs/${RUN_ID_93}/sessions/review_1`, 'review DAG target must route to review child session');
  });
});

test('runner process with unsupported explicit provider is not downgraded to codex', async () => {
  await withTempStatusProject(async ({ projectPath }) => {
    await writeOzChangeFixture(projectPath);
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), RUN_ID_93);
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(
      path.join(runRoot, 'state.json'),
      `${JSON.stringify({
        run_id: RUN_ID_93,
        change_name: CHANGE_NAME_93,
        sealed: true,
        engine: 'go-dag',
        status: 'running',
        stage: 'review_1',
        stages: {
          execution: 'completed',
          review_1: 'running',
        },
        sessions: {},
        processes: [
          {
            stage: 'review_1',
            role: 'reviewer',
            status: 'running',
            session_id: 'unsupported-provider-thread',
            provider: 'claude',
          },
        ],
        workflow_config: {
          engine: 'go-dag',
          max_review_iterations: 30,
        },
        paths: {},
        error: '',
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await readWorkflow_93(projectPath);
    const process = workflow.runnerProcesses.find((candidate) => candidate.sessionId === 'unsupported-provider-thread');
    const childSession = workflow.childSessions.find((candidate) => candidate.id === 'unsupported-provider-thread');

    assert.equal(process?.provider, 'claude', 'explicit unsupported provider must not be rewritten to codex');
    assert.equal(childSession, undefined, 'unsupported process provider must not create a clickable codex child session');
    assert.ok(
      workflow.runnerDiagnostics.warnings.some((warning) => warning.includes('Unsupported runner process provider claude')),
      'read model must warn when an explicit process provider is unsupported',
    );

    await fs.mkdir(WORKFLOW_BOUNDARY_EVIDENCE_DIR, { recursive: true });
    await fs.writeFile(
      path.join(WORKFLOW_BOUNDARY_EVIDENCE_DIR, 'process-snapshot.json'),
      `${JSON.stringify({
        runnerProcesses: workflow.runnerProcesses,
        childSessions: workflow.childSessions.map((session) => ({
          id: session.id,
          provider: session.provider,
          stageKey: session.stageKey,
          routePath: session.routePath,
        })),
        diagnostics: workflow.runnerDiagnostics,
      }, null, 2)}\n`,
      'utf8',
    );
  });
});

test('status summary does not mark planning complete when oz docs are missing', async () => {
  await withTempStatusProject(async ({ projectPath }) => {
    await writePendingOnlyRunFixture(projectPath);

    const workflow = await readWorkflow_93(projectPath);
    const rows = statusRowMap(workflow);
    const planningArtifacts = workflow.artifacts.filter((artifact) => artifact.type === 'oz-change-doc');

    assert.equal(rows.has('planning'), false, 'missing oz docs must not render a completed planning row');
    assert.equal(rows.has('executor'), true, 'runtime execution row must still render');
    assert.ok(
      planningArtifacts.length > 0 && planningArtifacts.every((artifact) => artifact.exists === false),
      'missing oz docs remain visible as missing planning artifact diagnostics',
    );
  });
});

test('status summary binds current planner session keys without marking missing docs complete', async () => {
  const cases = [
    { sessionKey: 'codex:planner', sessionId: 'codex-planner-thread', provider: 'codex', planningTool: 'codex' },
    { sessionKey: 'pi:planner', sessionId: 'pi-planner-thread', provider: 'pi', planningTool: 'pi' },
    { sessionKey: 'planner', sessionId: 'legacy-planner-thread', provider: 'codex', planningTool: 'codex' },
  ];

  for (const example of cases) {
    await withTempStatusProject(async ({ projectPath }) => {
      await writePlannerSessionOnlyRunFixture(
        projectPath,
        example.sessionKey,
        example.sessionId,
        example.planningTool,
      );

      const workflow = await readWorkflow_93(projectPath);
      const rows = statusRowMap(workflow);
      const planningRow = rows.get('planning');
      const planningArtifacts = workflow.artifacts.filter((artifact) => artifact.type === 'oz-change-doc');

      assert.ok(planningRow, `planning row must exist for ${example.sessionKey}`);
      assert.equal(planningRow.sessionId, example.sessionId, `${example.sessionKey} must bind planner session`);
      assert.equal(planningRow.provider, example.provider, `${example.sessionKey} must preserve provider`);
      assert.equal(planningRow.markerText, ' ', `${example.sessionKey} must not mark missing docs complete`);
      assert.ok(
        planningArtifacts.length > 0 && planningArtifacts.every((artifact) => artifact.exists === false),
        `${example.sessionKey} must keep missing planning docs as diagnostics`,
      );
    });
  }
});

test('workflow DAG prunes 30-round graph template to runtime-backed review nodes', async () => {
  await withTempStatusProject(async ({ projectPath }) => {
    await writeOzChangeFixture(projectPath);
    await writeStatusRunFixture(projectPath);

    const workflow = await readWorkflow_93(projectPath);
    const nodeIds = dagNodeIds_93(workflow);

    for (const expectedNode of [
      'execution',
      'review_1',
      'gate_review_1',
      'fix_1',
      'review_2',
      'gate_review_2',
      'fix_2',
      'review_3',
      'gate_review_3',
      'qa_3',
      'gate_qa_3',
      'archive',
    ]) {
      assert.ok(nodeIds.includes(expectedNode), `runtime-backed DAG must keep ${expectedNode}`);
    }

    for (const forbiddenNode of [
      'qa_1',
      'qa_2',
      'fix_3',
      'review_4',
      'gate_review_30',
      'qa_30',
      'gate_qa_30',
      'fix_30',
    ]) {
      assert.equal(nodeIds.includes(forbiddenNode), false, `template-only DAG node must be pruned: ${forbiddenNode}`);
    }

    assert.equal(
      workflow.workflowDag.gates.some((gate) => gate.id === 'gate_review_30' || gate.id === 'gate_qa_30'),
      false,
      'template-only gates must be pruned with their nodes',
    );
    assertEdgesReferenceVisibleNodes_93(workflow);

    const resultDir = path.join(process.cwd(), 'test-results', 'wo-status-watch-dag');
    await fs.mkdir(resultDir, { recursive: true });
    await fs.writeFile(
      path.join(resultDir, 'read-model-snapshot.json'),
      `${JSON.stringify({
        workflowStatusSummary: workflow.workflowStatusSummary,
        workflowDag: workflow.workflowDag,
      }, null, 2)}\n`,
      'utf8',
    );
  });
});

test('workflow DAG prunes subagent templates that lack their own runtime evidence', async () => {
  await withTempStatusProject(async ({ projectPath, graphFixturePath }) => {
    await writeOzChangeFixture(projectPath);
    await writeStatusRunFixture(projectPath);

    const graph = buildThirtyRoundGraphFixture();
    graph.nodes.push({
      id: 'review_1_template_subagent',
      name: '目标核对审核员',
      type: 'subagent',
      stage: 'review_1',
      member: '目标核对审核员',
    });
    graph.edges.push({ from: 'review_1', to: 'review_1_template_subagent' });
    await fs.writeFile(graphFixturePath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');

    const workflow = await readWorkflow_93(projectPath);
    const nodeIds = dagNodeIds_93(workflow);
    const leakedTarget = workflow.workflowDag.nodes
      .flatMap((node_93) => node_93.reviewTargets || [])
      .find((target) => target.nodeId === 'review_1_template_subagent' || target.label === 'review_1_template_subagent');

    assert.equal(
      nodeIds.includes('review_1_template_subagent'),
      false,
      'template subagent under an evidence stage must be pruned without its own runtime evidence',
    );
    assert.equal(
      leakedTarget,
      undefined,
      'pruned template subagent must not leak a node-metadata review target',
    );
    assertEdgesReferenceVisibleNodes_93(workflow);
  });
});

test('pending stages without artifact or session evidence do not enter summary or DAG', async () => {
  await withTempStatusProject(async ({ projectPath }) => {
    await writeOzChangeFixture(projectPath);
    await writePendingOnlyRunFixture(projectPath);

    const workflow = await readWorkflow_93(projectPath);
    const rows = statusRowMap(workflow);

    assert.ok(rows.has('executor'), 'executor row must exist for running stage');
    assert.equal(rows.has('reviewer'), false, 'pending review must not create reviewer row');
    assert.equal(rows.has('fixer'), false, 'pending fix must not create fixer row');
    assert.equal(rows.has('archiver'), false, 'pending archive must not create archiver row');

    const nodeIds = dagNodeIds_93(workflow);
    assert.ok(nodeIds.includes('execution'), 'execution node must remain');
    assert.equal(nodeIds.includes('review_1'), false, 'pending review node must be pruned from DAG');
    assert.equal(nodeIds.includes('fix_1'), false, 'pending fix node must be pruned from DAG');
    assert.equal(nodeIds.includes('archive'), false, 'pending archive node must be pruned from DAG');
  });
});

test('pending dag_nodes do not enter summary or visible DAG', async () => {
  await withTempStatusProject(async ({ projectPath }) => {
    await writeOzChangeFixture(projectPath);
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), RUN_ID_93);
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(
      path.join(runRoot, 'state.json'),
      `${JSON.stringify({
        run_id: RUN_ID_93,
        change_name: CHANGE_NAME_93,
        sealed: true,
        engine: 'go-dag',
        status: 'running',
        stage: 'execution',
        stages: {
          execution: 'running',
        },
        dag_nodes: {
          execution: { status: 'running' },
          review_1: { status: 'pending' },
          fix_1: { status: 'pending' },
          archive: { status: 'pending' },
        },
        sessions: {},
        workflow_config: {
          engine: 'go-dag',
          max_review_iterations: 30,
        },
        paths: {},
        error: '',
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await readWorkflow_93(projectPath);
    const rows = statusRowMap(workflow);

    assert.equal(rows.has('reviewer'), false, 'pending dag_nodes review must not create reviewer row');
    assert.equal(rows.has('fixer'), false, 'pending dag_nodes fix must not create fixer row');
    assert.equal(rows.has('archiver'), false, 'pending dag_nodes archive must not create archiver row');

    const nodeIds = dagNodeIds_93(workflow);
    assert.deepEqual(nodeIds, ['execution'], 'pending dag_nodes must not expand visible runtime DAG');
  });
});

test('completed dag_nodes produce status markers when stages are sparse', async () => {
  await withTempStatusProject(async ({ projectPath }) => {
    await writeOzChangeFixture(projectPath);
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), RUN_ID_93);
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(
      path.join(runRoot, 'state.json'),
      `${JSON.stringify({
        run_id: RUN_ID_93,
        change_name: CHANGE_NAME_93,
        sealed: true,
        engine: 'go-dag',
        status: 'running',
        stage: 'review_1',
        stages: {
          review_1: 'running',
        },
        dag_nodes: {
          execution: { status: 'success', finished_at: '2026-06-10T06:55:33.04815828Z' },
          review_1: { status: 'running', started_at: '2026-06-10T06:55:33.055018542Z' },
        },
        sessions: {
          'pi:executor': 'executor-session-status',
          'codex:reviewer': 'reviewer-session-status',
        },
        workflow_config: {
          engine: 'go-dag',
          max_review_iterations: 30,
        },
        paths: {},
        error: '',
      }, null, 2)}\n`,
      'utf8',
    );

    const workflow = await readWorkflow_93(projectPath);
    const rows = statusRowMap(workflow);

    assertStatusRow(rows, 'executor', {
      markerText: '✓',
      stageKeys: ['execution'],
      sessionId: 'executor-session-status',
    });
    assertStatusRow(rows, 'reviewer', {
      markerText: '→',
      stageKeys: ['review_1'],
      sessionId: 'reviewer-session-status',
    });
    const nodeIds = dagNodeIds_93(workflow);
    assert.ok(nodeIds.includes('execution'), 'dag_nodes execution evidence must keep the execution node');
    assert.ok(nodeIds.includes('review_1'), 'running sparse stage evidence must keep the current review node');
    assert.equal(nodeIds.includes('review_2'), false, 'sparse runtime evidence must not expose future template review nodes');
    assert.equal(nodeIds.includes('fix_1'), false, 'sparse runtime evidence must not expose future template fix nodes');
  });
});

test('workflow DAG keeps nodes proved only by runtime graph artifact or gate evidence', async () => {
  await withTempStatusProject(async ({ projectPath, graphFixturePath }) => {
    await writeOzChangeFixture(projectPath);
    await writePendingOnlyRunFixture(projectPath);
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), RUN_ID_93);
    await fs.writeFile(path.join(runRoot, 'graph-review-4.json'), '{"decision":"needs_fix"}\n', 'utf8');

    const graph = buildThirtyRoundGraphFixture();
    graph.artifacts = [
      {
        id: 'graph-review-4-artifact',
        node_id: 'review_4',
        path: 'graph-review-4.json',
      },
      {
        id: 'missing-qa-1-artifact',
        node_id: 'qa_1',
        path: 'missing-qa-1.json',
      },
    ];
    graph.gates = graph.gates.map((gate_93) => (
      gate_93.id === 'gate_review_5'
        ? { ...gate_93, status: 'completed', decision: 'needs_fix' }
        : gate_93
    ));
    await fs.writeFile(graphFixturePath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');

    const workflow = await readWorkflow_93(projectPath);
    const nodeIds = dagNodeIds_93(workflow);

    assert.ok(nodeIds.includes('review_4'), 'graph artifact node_id must prove review_4 exists');
    assert.ok(nodeIds.includes('gate_review_5'), 'runtime-backed graph gate must prove gate node exists');
    assert.ok(nodeIds.includes('review_5'), 'runtime-backed graph gate stage must keep its main stage node');
    assert.equal(nodeIds.includes('qa_1'), false, 'missing graph artifact file must not prove template qa_1 exists');
    assert.equal(nodeIds.includes('gate_qa_1'), false, 'missing graph artifact must not keep its template QA gate');
    assert.equal(nodeIds.includes('review_6'), false, 'plain template gate without runtime evidence remains pruned');
    assert.ok(
      workflow.workflowDag.artifacts.some((artifact_93) => artifact_93.nodeId === 'review_4' && artifact_93.exists === true),
      'artifact evidence must remain available as a DAG review target',
    );
    assertEdgesReferenceVisibleNodes_93(workflow);
  });
});

test('project-list summary carries provider-aware workflowOwnedSessionRefs from DAG', async () => {
  await withTempStatusProject(async ({ projectPath, graphFixturePath }) => {
    await writeOzChangeFixture(projectPath);
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), RUN_ID_93);
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(
      path.join(runRoot, 'state.json'),
      `${JSON.stringify({
        run_id: RUN_ID_93,
        change_name: CHANGE_NAME_93,
        sealed: true,
        engine: 'go-dag',
        status: 'running',
        stage: 'review_1',
        stages: {
          execution: 'completed',
          review_1: 'running',
        },
        sessions: {
          'pi:executor': 'executor-session-status',
        },
        processes: [
          {
            stage: 'review_1',
            role: '测试有效性审核员',
            status: 'running',
            session_id: 'dag-only-review-agent-thread',
          },
        ],
        workflow_config: {
          engine: 'go-dag',
          max_review_iterations: 30,
        },
        paths: {},
        error: '',
      }, null, 2)}\n`,
      'utf8',
    );

    const graph = buildThirtyRoundGraphFixture();
    graph.nodes.push({
      id: 'review_1_test_auditor',
      name: '测试有效性审核员',
      type: 'subagent',
      stage: 'review_1',
      member: '测试有效性审核员',
    });
    graph.edges.push({ from: 'review_1', to: 'review_1_test_auditor' });
    await fs.writeFile(graphFixturePath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');

    const workflow = await readWorkflow_93(projectPath);
    const { summarizeWorkflowForProjectList } = await import('../../backend/workflows.ts');
    const summary = summarizeWorkflowForProjectList(workflow);

    assert.equal(
      summary.runnerDiagnostics,
      undefined,
      'project-list summary must not expose full runnerDiagnostics',
    );
    assert.ok(
      Array.isArray(summary.workflowOwnedSessionRefs),
      'project-list summary must carry workflowOwnedSessionRefs',
    );
    assert.ok(
      summary.workflowOwnedSessionRefs.length > 0,
      'workflowOwnedSessionRefs must contain DAG-derived sessions',
    );
    const dagOnlyReviewer = summary.workflowOwnedSessionRefs.find(
      (ref) => ref.provider === 'codex' && ref.sessionId === 'dag-only-review-agent-thread',
    );
    assert.ok(dagOnlyReviewer, 'project-list summary must include session ref that only entered through DAG reviewTargets');

    const piExecutor = summary.workflowOwnedSessionRefs.find(
      (ref) => ref.provider === 'pi' && ref.sessionId === 'executor-session-status',
    );
    assert.ok(piExecutor, 'project-list summary must include pi executor session ref');

    const wrongPiAsCodex = summary.workflowOwnedSessionRefs.find(
      (ref) => ref.provider === 'codex' && ref.sessionId === 'executor-session-status',
    );
    assert.equal(wrongPiAsCodex, undefined, 'pi executor must not be mislabeled as codex');
  });
});

test('workflow stage inspections absorb graph-only DAG review targets', async () => {
  await withTempStatusProject(async ({ projectPath, graphFixturePath }) => {
    await writeOzChangeFixture(projectPath);
    await writeStatusRunFixture(projectPath);
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), RUN_ID_93);
    await fs.writeFile(path.join(runRoot, 'graph-only-extra.json'), '{"source":"oz flow graph review target"}\n', 'utf8');

    const graph = buildThirtyRoundGraphFixture();
    graph.artifacts = [
      ...(Array.isArray(graph.artifacts) ? graph.artifacts : []),
      {
        id: 'graph-only-extra-artifact',
        node_id: 'gate_review_1',
        path: 'graph-only-extra.json',
      },
    ];
    await fs.writeFile(graphFixturePath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');

    const workflow = await readWorkflow_93(projectPath);
    const reviewInspection = workflow.stageInspections.find((stage) => stage.stageKey === 'review_1');
    assert.ok(reviewInspection, 'review_1 stage inspection must exist');

    const graphOnlyFile = reviewInspection.substages
      .flatMap((substage) => substage.files || [])
      .find((file) => file.label === 'graph-only-extra.json');
    assert.ok(graphOnlyFile, 'graph-only artifact target must be visible from the stage tree data');
    assert.equal(graphOnlyFile.exists, true, 'graph-only artifact target must keep exists=true');
    assert.ok(
      graphOnlyFile.path?.endsWith('graph-only-extra.json'),
      'graph-only artifact target must keep an openable path',
    );
  });
});

test('workflow read model uses schema boundaries before consuming external JSON', async () => {
  const stateSchemaPath = 'backend/domains/workflows/read-model/workflow-state-schema.ts';
  const graphSchemaPath = 'backend/domains/workflows/read-model/workflow-graph-schema.ts';
  const statusSummary = await readRepoSource('backend/domains/workflows/read-model/status-summary.ts');
  const dagReadModel = await readRepoSource('backend/domains/workflows/read-model/dag-read-model.ts');
  const snapshot = {
    hasStateSchema: await repoPathExists(stateSchemaPath),
    hasGraphSchema: await repoPathExists(graphSchemaPath),
    statusSummaryImportsSchema: /workflow-state-schema|workflow-graph-schema/.test(statusSummary),
    dagImportsSchema: /workflow-state-schema|workflow-graph-schema/.test(dagReadModel),
    statusSummaryAnyCount: countAnyRecords(statusSummary),
    dagAnyCount: countAnyRecords(dagReadModel),
  };

  await writeWorkflowSchemaAudit(snapshot);

  assert.equal(snapshot.hasStateSchema, true, 'workflow-state-schema.ts must exist');
  assert.equal(snapshot.hasGraphSchema, true, 'workflow-graph-schema.ts must exist');
  assert.equal(snapshot.statusSummaryImportsSchema, true, 'status-summary.ts must import schema normalizers');
  assert.equal(snapshot.dagImportsSchema, true, 'dag-read-model.ts must import schema normalizers');
  assert.ok(snapshot.statusSummaryAnyCount <= 8, `status-summary.ts any usage must stay bounded, got ${snapshot.statusSummaryAnyCount}`);
  assert.ok(snapshot.dagAnyCount <= 8, `dag-read-model.ts any usage must stay bounded, got ${snapshot.dagAnyCount}`);
});

test('workflow schema modules export business normalizers', async () => {
  const expectedModules = [
    ['backend/domains/workflows/read-model/workflow-state-schema.ts', ['normalizeWorkflowState', 'WorkflowState']],
    ['backend/domains/workflows/read-model/workflow-graph-schema.ts', ['normalizeWorkflowGraph', 'WorkflowGraph']],
  ];

  for (const [modulePath, exports] of expectedModules) {
    assert.equal(await repoPathExists(modulePath), true, `${modulePath} must exist`);
    const source = await readRepoSource(modulePath);
    assert.match(source, /PURPOSE|目的|workflow|schema/i, `${modulePath} must explain its workflow schema purpose`);
    for (const exportName of exports) {
      assert.match(source, new RegExp(`export\\s+(function|interface|type)\\s+${exportName}\\b`), `${modulePath} must export ${exportName}`);
    }
  }
});

test('workflow stage/session resolver owns provider, role, and planner rules', async () => {
  const resolverPath = 'backend/domains/workflows/read-model/stage-session-resolver.ts';
  const consumerPaths = [
    'backend/domains/workflows/read-model/status-summary.ts',
    'backend/domains/workflows/read-model/dag-read-model.ts',
    'backend/domains/workflows/read-model/session-refs.ts',
    'backend/domains/workflows/read-model/builder-internals.ts',
  ];
  const resolverSource = await readRepoSource(resolverPath);
  const consumerSources = Object.fromEntries(
    await Promise.all(consumerPaths.map(async (relativePath) => [relativePath, await readRepoSource(relativePath)])),
  );
  const duplicateProviderResolvers = Object.entries(consumerSources)
    .filter(([relativePath, source]) => (
      relativePath !== resolverPath
      && /function\s+resolveSessionProviderFromState/.test(source)
    ))
    .map(([relativePath]) => relativePath);
  const builderInternals = consumerSources['backend/domains/workflows/read-model/builder-internals.ts'];
  const stageStatuses = [
    { key: 'review_1', status: 'completed' },
    { key: 'review_2', status: 'active' },
    { key: 'repair_1', status: 'completed' },
    { key: 'qa_1', status: 'pending' },
  ];
  const sessions = {
    'pi:executor': 'pi-exec-session',
    'codex:planner': 'planner-session',
    planning: 'legacy-planning-session',
  };
  const childSessions = [
    { id: 'planner-session', provider: 'codex', address: 'planning', routePath: '/runs/run-1/sessions/planning' },
  ];
  const sampleResults = {
    piExecutor: acceptedProviderFromSessionKey('pi:executor'),
    providerForExecutor: resolveSessionProviderFromState('pi-exec-session', sessions),
    activeReviewStage: inferSubagentRoleStage('reviewer', stageStatuses),
    plannerRef: resolvePlannerSessionRef(sessions, { stages: { planning: { tool: 'codex' } } }, childSessions, 'run-1'),
  };
  const snapshot = {
    hasResolverModule: await repoPathExists(resolverPath),
    resolverExportsFound: [
      'acceptedProviderFromSessionKey',
      'resolveSessionProviderFromState',
      'inferSubagentRoleStage',
      'resolvePlannerSessionRef',
      'resolveRoleDefaultStage',
    ].filter((name) => new RegExp(`\\b${name}\\b`).test(resolverSource)),
    duplicateProviderResolvers,
    builderUsesAnyRecord: /type\s+AnyRecord\s*=\s*Record<string,\s*any>/.test(builderInternals),
    builderHasBrokenComment: /\/\*\*[\s\S]{0,120}\/\*\*/.test(builderInternals),
    sampleResults,
  };

  await writeWorkflowStageSessionAudit(snapshot);

  assert.equal(snapshot.hasResolverModule, true, `${resolverPath} must exist`);
  assert.equal(sampleResults.piExecutor.accepted, true, 'pi:executor 必须被识别为 provider session key');
  assert.equal(sampleResults.piExecutor.provider, 'pi');
  assert.equal(sampleResults.providerForExecutor, 'pi', 'sessionId 必须能从 sessions map 反查 provider');
  assert.equal(sampleResults.activeReviewStage, 'review_2', 'review role 应优先映射到 active review round');
  assert.deepEqual(sampleResults.plannerRef, {
    sessionId: 'planner-session',
    provider: 'codex',
    role: 'planner',
    stageKey: 'planning',
    address: 'planning',
    routePath: '/runs/run-1/sessions/planning',
  });
  assert.deepEqual(snapshot.duplicateProviderResolvers, [], 'provider resolver 不得在 read model consumers 中重复定义');
  assert.equal(snapshot.builderUsesAnyRecord, false, 'builder-internals.ts 核心 read model 不得继续以 AnyRecord 为主类型');
  assert.equal(snapshot.builderHasBrokenComment, false, 'builder-internals.ts 不得保留拆分遗留的破损注释');
});
