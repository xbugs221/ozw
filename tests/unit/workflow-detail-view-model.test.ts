/**
 * 文件目的：用真实 workflow stage/session/artifact 样例锁定详情页 view model 的低状态业务行为。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  buildVisualProgress,
  resolveContinueState,
} from '../../frontend/components/main-content/workflow-detail/workflowDetailViewModel';
import {
  buildWorkflowStageTableColumns,
} from '../../frontend/components/main-content/workflow-detail/workflowStageTableViewModel';
import {
  getRoleSummaryArtifact,
  resolveArtifactPath,
} from '../../frontend/components/main-content/workflow-detail/workflowArtifactLinks';

type LooseWorkflow = Record<string, any>;

function buildStageInspections() {
  /**
   * 模拟一条已经完成规划、执行有证据、审核正在运行的 workflow 详情数据。
   */
  return [
    { stageKey: 'planning', title: '规划', status: 'completed', substages: [] },
    {
      stageKey: 'execution',
      title: '执行',
      status: 'running',
      substages: [
        {
          stageKey: 'execution',
          substageKey: 'round_2',
          title: 'round 2',
          status: 'pending',
          agentSessions: [
            { id: 'execution-review-2', stageKey: 'execution', role: 'review:2', title: 'review subagent: reviewer:2', provider: 'codex' },
          ],
          files: [],
        },
        {
          stageKey: 'execution',
          substageKey: 'round_1',
          title: 'round 1',
          status: 'completed',
          agentSessions: [
            { id: 'execution-plan-1', stageKey: 'execution', role: 'planning_context:1', title: 'planning subagent: planner:1', provider: 'codex' },
          ],
          files: [
            { id: 'fan-in-1', label: 'parallel-review-1.json', path: '.wo/runs/run-1/parallel-review-1.json', exists: true },
          ],
        },
      ],
    },
    {
      stageKey: 'review_1',
      title: '审核',
      status: 'running',
      substages: [
        { stageKey: 'review_1', substageKey: 'reviewer', title: 'reviewer', status: 'running', agentSessions: [], files: [] },
      ],
    },
  ];
}

function buildWorkflowFixture(): LooseWorkflow {
  /**
   * 构造带多轮 artifact 的 workflow，用来测试 role summary 选择最新可检查产物。
   */
  return {
    id: 'workflow-1',
    runId: 'run-1',
    runner: 'node',
    stage: 'review_1',
    openspecChangeName: '补齐测试',
    stageStatuses: [
      { key: 'planning', status: 'completed' },
      { key: 'execution', status: 'pending' },
    ],
    childSessions: [{ id: 'planning-session', stageKey: 'planning' }],
    artifacts: [
      { id: 'review-old', stage: 'review_1', label: 'review-1.md', path: '.wo/runs/run-1/review-1.md', exists: true },
      { id: 'review-json', stage: 'review_2', label: 'review-2.json', path: '.wo/runs/run-1/review-2.json', exists: true },
      { id: 'review-md', stage: 'review_2', label: 'review-2.md', path: '.wo/runs/run-1/review-2.md', exists: true },
      { id: 'qa-missing', stage: 'qa_2', label: 'qa-2.json', path: '.wo/runs/run-1/qa-2.json', exists: false },
      { id: 'qa-json', stage: 'qa_1', label: 'qa-1.json', path: '.wo/runs/run-1/qa-1.json', exists: true },
      { id: 'fix-md', stage: 'fix_3', label: 'fix-3.md', path: '.wo/runs/run-1/fix-3.md', exists: true },
    ],
  };
}

test('workflow progress follows evidence and continue state follows runner semantics', () => {
  /**
   * 阶段灯号和继续按钮是用户判断 workflow 是否能推进的核心信号。
   */
  const stageInspections = buildStageInspections();
  const progress = buildVisualProgress(stageInspections as any);

  assert.equal(progress.stageStatuses.planning, 'completed');
  assert.equal(progress.stageStatuses.execution, 'completed');
  assert.equal(progress.stageStatuses.review_1, 'active');
  assert.equal(progress.substageStatuses['execution:round_1'], 'completed');
  assert.equal(progress.substageStatuses['review_1:reviewer'], 'active');

  const legacyWorkflow = buildWorkflowFixture();
  assert.deepEqual(resolveContinueState(legacyWorkflow as any, stageInspections as any), {
    canContinue: true,
    disabled: false,
    label: '继续推进',
  });

  const executionStarted = {
    ...legacyWorkflow,
    childSessions: [...legacyWorkflow.childSessions, { id: 'execution-session', stageKey: 'execution' }],
  };
  assert.equal(resolveContinueState(executionStarted as any, stageInspections as any).disabled, true);

  const goRunner = { ...legacyWorkflow, runner: 'go' };
  assert.deepEqual(resolveContinueState(goRunner as any, stageInspections as any), {
    canContinue: false,
    disabled: true,
    label: 'Go runner 执行中',
  });
});

test('workflow stage table and role artifacts keep inspectable business output', () => {
  /**
   * 详情页阶段表必须聚合为四个自动阶段，同时保留新旧优化阶段的会话和产物。
   */
  const columns = buildWorkflowStageTableColumns([
    {
      stageKey: 'planning',
      title: '规划',
      status: 'completed',
      substages: [{
        stageKey: 'planning',
        substageKey: 'planning',
        title: '规划',
        status: 'completed',
        agentSessions: [],
        files: [{ id: 'proposal', label: 'proposal.md', path: '.wo/proposal.md', exists: true }],
      }],
    },
    ...buildStageInspections().slice(1),
    {
      stageKey: 'fix_1',
      title: '旧版修正',
      status: 'completed',
      substages: [{
        stageKey: 'fix_1',
        substageKey: 'fix_1',
        title: '旧版修正',
        status: 'completed',
        agentSessions: [],
        files: [{ id: 'fix-1', label: 'fix-1.md', path: '.wo/runs/run-1/fix-1.md', exists: true }],
      }],
    },
    {
      stageKey: 'audit_1',
      title: '全量自查',
      status: 'completed',
      substages: [{
        stageKey: 'audit_1',
        substageKey: 'audit_1',
        title: '全量自查',
        status: 'completed',
        agentSessions: [],
        files: [{ id: 'audit-1', label: 'audit-1.json', path: '.wo/runs/run-1/audit-1.json', exists: true }],
      }],
    },
    {
      stageKey: 'targeted_repair_1',
      title: '定向修复',
      status: 'completed',
      substages: [{
        stageKey: 'targeted_repair_1',
        substageKey: 'targeted_repair_1',
        title: '定向修复',
        status: 'completed',
        agentSessions: [],
        files: [{ id: 'targeted-repair-1', label: 'targeted-repair-1.json', path: '.wo/runs/run-1/targeted-repair-1.json', exists: true }],
      }],
    },
    {
      stageKey: 'qa_1',
      title: '独立测试',
      status: 'completed',
      substages: [{
        stageKey: 'qa_1',
        substageKey: 'qa_1',
        title: '独立测试',
        status: 'completed',
        agentSessions: [],
        files: [{ id: 'qa-1', label: 'qa-1.json', path: '.wo/runs/run-1/qa-1.json', exists: true }],
      }],
    },
    {
      stageKey: 'archive',
      title: '归档',
      status: 'completed',
      substages: [{
        stageKey: 'archive',
        substageKey: 'archive',
        title: '归档',
        status: 'completed',
        agentSessions: [],
        files: [{ id: 'delivery', label: 'delivery-summary.md', path: '.wo/runs/run-1/delivery-summary.md', exists: true }],
      }],
    },
  ] as any);
  assert.deepEqual(
    columns.map((column) => [column.key, column.label]),
    [
      ['execution', '执行'],
      ['optimization', '优化'],
      ['qa', '测试'],
      ['archive', '归档'],
    ],
  );
  const execution = columns.find((column) => column.key === 'execution');
  assert.ok(execution, 'execution column must exist');
  assert.deepEqual(
    execution.entries.filter((entry) => entry.kind === 'session').map((entry) => entry.session?.id),
    ['execution-plan-1', 'execution-review-2'],
  );
  assert.ok(
    execution.entries.some((entry) => entry.kind === 'artifact' && entry.label === 'parallel-review-1.json'),
    'parallel fan-in artifact must stay inspectable in the table',
  );
  const optimization = columns.find((column) => column.key === 'optimization');
  assert.ok(optimization, 'optimization column must merge current and legacy stage keys');
  assert.deepEqual(
    optimization.entries
      .filter((entry) => entry.kind === 'artifact')
      .map((entry) => entry.label),
    ['fix-1.md', 'audit-1.json', 'targeted-repair-1.json'],
  );
  assert.equal(columns.some((column) => column.key === 'planning'), false);

  const workflow = buildWorkflowFixture();
  assert.equal(getRoleSummaryArtifact(workflow as any, 'reviewer')?.id, 'review-json');
  assert.equal(getRoleSummaryArtifact(workflow as any, 'qa')?.id, 'qa-json');
  assert.equal(getRoleSummaryArtifact(workflow as any, 'fixer')?.id, 'fix-md');

  const resolvedPath = resolveArtifactPath(
    { fullPath: '/work/demo' } as any,
    { path: '.wo/runs/run-1/review-2.json' } as any,
  );
  assert.equal(resolvedPath, '/work/demo/.wo/runs/run-1/review-2.json');
});
