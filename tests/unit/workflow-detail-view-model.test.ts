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
   * 详情页 stage table 必须把 session 和 artifact 都保留下来，role summary 必须指向最新可检查产物。
   */
  const columns = buildWorkflowStageTableColumns(buildStageInspections() as any);
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
