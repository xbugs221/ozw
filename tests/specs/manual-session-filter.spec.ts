// Sources: 93-对齐wo状态栏新格式
// @ts-nocheck -- 创建阶段契约测试：执行阶段负责把最终 ProjectWorkflow 类型收紧。
/**
 * PURPOSE: Prove project manual session lists treat new wo DAG parallel
 * subagent session targets as workflow-owned, not as user-created manual chats.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  findWorkflowChildSession,
  findWorkflowDagTargetChildSession,
  hasWorkflowChildSession,
  isWorkflowOwnedSession,
} from '../../frontend/utils/workflowSessions.ts';
import { summarizeWorkflowForProjectList } from '../../backend/workflows.ts';

/**
 * Apply the same shared workflow-owned filter used by the project overview and
 * sidebar manual session lists.
 */
function visibleManualSessions(project, sessions) {
  return sessions.filter((session) => !isWorkflowOwnedSession(project, session));
}

/**
 * Build a project containing a new oz flow graph subagent session target and one
 * unrelated manual session discovered from provider JSONL.
 */
function buildProjectWithParallelSubagentWorkflow() {
  return {
    name: 'fixture-project',
    workflows: [
      {
        id: 'run-parallel-subagent',
        runId: 'run-parallel-subagent',
        title: '93-状态栏新格式fixture',
        childSessions: [],
        runnerProcesses: [],
        diagnostics: {
          workflowOwnedSessionIds: [],
          workflowOwnedSessions: [],
        },
        workflowDag: {
          source: {
            available: true,
            format: 'oz flow graph json',
          },
          nodes: [
            {
              id: 'before_review_1_goal-checker',
              label: 'review subagent: 目标核对审核员',
              type: 'subagent',
              stage: 'review_1',
              reviewTargets: [
                {
                  kind: 'session',
                  sessionId: 'parallel-review-agent-thread',
                  provider: 'codex',
                  label: '目标核对审核员',
                },
              ],
            },
            {
              id: 'implementation_context_1',
              label: 'implementation context subagent',
              type: 'subagent',
              stage: 'execution',
              reviewTargets: [
                {
                  kind: 'session',
                  sessionId: 'parallel-pi-context-thread',
                  provider: 'pi',
                  label: '实现上下文收集员',
                },
              ],
            },
          ],
          edges: [],
          artifacts: [],
          gates: [],
        },
      },
    ],
  };
}

test('manual session filter excludes wo DAG parallel subagent session targets', async () => {
  const project = buildProjectWithParallelSubagentWorkflow();
  const sessions = [
    {
      id: 'parallel-review-agent-thread',
      provider: 'codex',
      summary: '内部 review subagent',
    },
    {
      id: 'parallel-pi-context-thread',
      provider: 'pi',
      summary: '内部 implementation context subagent',
    },
    {
      id: 'parallel-review-agent-thread',
      provider: 'pi',
      summary: '同名但不同 provider 的普通 Pi 会话',
    },
    {
      id: 'manual-cli-thread',
      provider: 'codex',
      summary: '用户直接创建的手动会话',
    },
  ];

  const visible = visibleManualSessions(project, sessions);
  const visibleKeys = visible.map((session) => `${session.provider}:${session.id}`);

  assert.equal(
    visibleKeys.includes('codex:parallel-review-agent-thread'),
    false,
    'Codex review subagent session from workflowDag reviewTargets must be hidden from manual sessions',
  );
  assert.equal(
    visibleKeys.includes('pi:parallel-pi-context-thread'),
    false,
    'Pi implementation-context subagent session from workflowDag reviewTargets must be hidden from manual sessions',
  );
  assert.equal(
    visibleKeys.includes('pi:parallel-review-agent-thread'),
    true,
    'same session id from a different provider must not be hidden by a Codex workflow target',
  );
  assert.equal(
    visibleKeys.includes('codex:manual-cli-thread'),
    true,
    'ordinary provider JSONL sessions must remain visible in manual session lists',
  );

  const resultDir = path.join(process.cwd(), 'test-results', 'wo-status-watch-dag');
  await fs.mkdir(resultDir, { recursive: true });
  await fs.writeFile(
    path.join(resultDir, 'manual-session-filter-subagent.json'),
    `${JSON.stringify({ before: sessions, after: visible }, null, 2)}\n`,
    'utf8',
  );
});

test('manual session filter works via project-list summary workflowOwnedSessionRefs', async () => {
  const project = {
    name: 'fixture-project',
    workflows: [
      {
        id: 'run-parallel-subagent',
        runId: 'run-parallel-subagent',
        title: '93-状态栏新格式fixture',
        childSessions: [],
        runnerProcesses: [],
        workflowDag: { source: { available: true, format: 'oz flow graph json' } },
        workflowOwnedSessionRefs: [
          { sessionId: 'parallel-review-agent-thread', provider: 'codex' },
        ],
      },
    ],
  };
  const sessions = [
    { id: 'parallel-review-agent-thread', provider: 'codex', summary: '内部 review subagent' },
    { id: 'manual-cli-thread', provider: 'codex', summary: '用户直接创建的手动会话' },
  ];
  const visible = visibleManualSessions(project, sessions);
  const visibleKeys = visible.map((session) => `${session.provider}:${session.id}`);
  assert.equal(
    visibleKeys.includes('codex:parallel-review-agent-thread'),
    false,
    'DAG session via workflowOwnedSessionRefs must be hidden from manual sessions in project-list summary',
  );
  assert.equal(
    visibleKeys.includes('codex:manual-cli-thread'),
    true,
    'ordinary sessions must remain visible when workflowDag is stripped in project-list summary',
  );
});

test('project-list workflow summary keeps diagnostics-owned child session refs', async () => {
  const summarizedWorkflow = summarizeWorkflowForProjectList({
    id: 'run-diagnostics-only',
    runId: 'run-diagnostics-only',
    title: 'diagnostics-only workflow',
    diagnostics: {
      workflowOwnedSessions: [
        { sessionId: 'diagnostics-child-thread', provider: 'pi' },
      ],
    },
  });
  const project = {
    name: 'fixture-project',
    workflows: [summarizedWorkflow],
  };
  const sessions = [
    { id: 'diagnostics-child-thread', provider: 'pi', summary: '内部 Pi 子会话' },
    { id: 'diagnostics-child-thread', provider: 'codex', summary: '同名 Codex 手动会话' },
    { id: 'manual-cli-thread', provider: 'pi', summary: '用户直接创建的 Pi 手动会话' },
  ];
  const visible = visibleManualSessions(project, sessions);
  const visibleKeys = visible.map((session) => `${session.provider}:${session.id}`);

  assert.deepEqual(
    summarizedWorkflow.workflowOwnedSessionRefs,
    [{ sessionId: 'diagnostics-child-thread', provider: 'pi' }],
    'lightweight summary must preserve diagnostics workflow-owned refs for manual-session filtering',
  );
  assert.equal(
    visibleKeys.includes('pi:diagnostics-child-thread'),
    false,
    'diagnostics-owned Pi child session from project-list summary must be hidden',
  );
  assert.equal(
    visibleKeys.includes('codex:diagnostics-child-thread'),
    true,
    'same-id Codex manual session must remain visible',
  );
  assert.equal(
    visibleKeys.includes('pi:manual-cli-thread'),
    true,
    'ordinary Pi manual session must remain visible',
  );
});

test('manual session filter excludes cN route shells bound to workflow provider sessions', async () => {
  const project = {
    name: 'fixture-project',
    workflows: [
      {
        id: 'run-route-shell',
        runId: 'run-route-shell',
        title: 'route shell workflow',
        workflowOwnedSessionRefs: [
          { sessionId: 'provider-child-thread', provider: 'pi' },
        ],
      },
    ],
  };
  const sessions = [
    {
      id: 'c12',
      provider: 'pi',
      providerSessionId: 'provider-child-thread',
      summary: '路由壳包装的内部 Pi 子会话',
    },
    {
      id: 'c13',
      provider: 'pi',
      providerSessionId: 'manual-provider-thread',
      summary: '用户直接创建的 Pi 手动会话',
    },
  ];
  const visible = visibleManualSessions(project, sessions);
  const visibleIds = visible.map((session) => session.id);

  assert.equal(
    visibleIds.includes('c12'),
    false,
    'project overview manual sessions must hide cN route shells bound to workflow provider sessions',
  );
  assert.equal(
    visibleIds.includes('c13'),
    true,
    'ordinary cN manual sessions must remain visible',
  );
});

test('manual session filter excludes orphan cN route shells marked with workflow origin', async () => {
  const project = {
    name: 'fixture-project',
    workflows: [],
  };
  const sessions = [
    {
      id: 'c155',
      provider: 'pi',
      origin: 'workflow',
      providerSessionId: 'orphan-workflow-provider-thread',
      summary: '你是只读 subagent。不得修改源码',
    },
    {
      id: 'c156',
      provider: 'pi',
      origin: 'manual',
      providerSessionId: 'manual-provider-thread',
      summary: '用户直接创建的 Pi 手动会话',
    },
  ];
  const visible = visibleManualSessions(project, sessions);
  const visibleIds = visible.map((session) => session.id);

  assert.equal(
    visibleIds.includes('c155'),
    false,
    'project overview manual sessions must hide orphan cN shells already marked as workflow origin',
  );
  assert.equal(
    visibleIds.includes('c156'),
    true,
    'manual cN shells must remain visible',
  );
});

test('project-list summary workflowOwnedSessionRefs does not hide same-id different-provider session', async () => {
  const project = {
    name: 'fixture-project',
    workflows: [
      {
        id: 'run-parallel-subagent',
        runId: 'run-parallel-subagent',
        title: '93-状态栏新格式fixture',
        childSessions: [],
        runnerProcesses: [],
        workflowDag: { source: { available: true, format: 'oz flow graph json' } },
        workflowOwnedSessionRefs: [
          { sessionId: 'parallel-review-agent-thread', provider: 'codex' },
        ],
      },
    ],
  };
  const sessions = [
    { id: 'parallel-review-agent-thread', provider: 'codex', summary: '内部 review subagent' },
    { id: 'parallel-review-agent-thread', provider: 'pi', summary: '同名但不同 provider 的普通 Pi 会话' },
    { id: 'manual-cli-thread', provider: 'codex', summary: '用户直接创建的手动会话' },
  ];
  const visible = visibleManualSessions(project, sessions);
  const visibleKeys = visible.map((session) => `${session.provider}:${session.id}`);
  assert.equal(
    visibleKeys.includes('codex:parallel-review-agent-thread'),
    false,
    'Codex-owned session must be hidden',
  );
  assert.equal(
    visibleKeys.includes('pi:parallel-review-agent-thread'),
    true,
    'same session id from a different provider must not be hidden by workflowOwnedSessionRefs',
  );
  assert.equal(
    visibleKeys.includes('codex:manual-cli-thread'),
    true,
    'ordinary sessions must remain visible',
  );
});

test('full workflow diagnostics do not hide same-id different-provider session', async () => {
  const project = {
    name: 'fixture-project',
    workflows: [
      {
        id: 'run-parallel-subagent',
        runId: 'run-parallel-subagent',
        title: '93-状态栏新格式fixture',
        childSessions: [],
        runnerProcesses: [],
        diagnostics: {
          workflowOwnedSessions: [
            { sessionId: 'parallel-review-agent-thread', provider: 'codex' },
          ],
          workflowOwnedSessionIds: ['parallel-review-agent-thread'],
        },
        workflowDag: { source: { available: true, format: 'oz flow graph json' }, nodes: [] },
      },
    ],
  };
  const sessions = [
    { id: 'parallel-review-agent-thread', provider: 'codex', summary: '内部 review subagent' },
    { id: 'parallel-review-agent-thread', provider: 'pi', summary: '同名但不同 provider 的普通 Pi 会话' },
    { id: 'manual-cli-thread', provider: 'codex', summary: '用户直接创建的手动会话' },
  ];
  const visible = visibleManualSessions(project, sessions);
  const visibleKeys = visible.map((session) => `${session.provider}:${session.id}`);

  assert.equal(
    visibleKeys.includes('codex:parallel-review-agent-thread'),
    false,
    'Codex-owned session from full diagnostics must be hidden',
  );
  assert.equal(
    visibleKeys.includes('pi:parallel-review-agent-thread'),
    true,
    'provider-aware full diagnostics must not fall back to id-only ownership for Pi same-id session',
  );
  assert.equal(
    visibleKeys.includes('codex:manual-cli-thread'),
    true,
    'ordinary manual sessions remain visible with full diagnostics',
  );
});

test('runner process ownership does not hide same-id different-provider session', async () => {
  const project = {
    name: 'fixture-project',
    workflows: [
      {
        id: 'run-parallel-subagent',
        runId: 'run-parallel-subagent',
        title: '93-状态栏新格式fixture',
        childSessions: [],
        runnerProcesses: [
          { stage: 'review_1', role: 'reviewer', sessionId: 'same-session-id', provider: 'codex' },
        ],
        workflowDag: { source: { available: true, format: 'oz flow graph json' }, nodes: [] },
      },
    ],
  };
  const sessions = [
    { id: 'same-session-id', provider: 'codex', summary: '内部 review runner process' },
    { id: 'same-session-id', provider: 'pi', summary: '同名但不同 provider 的普通 Pi 会话' },
    { id: 'manual-cli-thread', provider: 'codex', summary: '用户直接创建的手动会话' },
  ];
  const visible = visibleManualSessions(project, sessions);
  const visibleKeys = visible.map((session) => `${session.provider}:${session.id}`);

  assert.equal(
    visibleKeys.includes('codex:same-session-id'),
    false,
    'Codex runner process session must be hidden',
  );
  assert.equal(
    visibleKeys.includes('pi:same-session-id'),
    true,
    'runnerProcesses must compare provider before hiding same-id sessions',
  );
  assert.equal(
    visibleKeys.includes('codex:manual-cli-thread'),
    true,
    'ordinary manual sessions remain visible with runnerProcesses ownership',
  );
});

test('DAG review target session lookup preserves provider namespace for duplicate ids', () => {
  const childSessions = [
    {
      id: 'same-session-id',
      provider: 'codex',
      stageKey: 'review_1',
      title: 'Codex reviewer',
    },
    {
      id: 'same-session-id',
      provider: 'pi',
      stageKey: 'review_1',
      title: 'Pi reviewer',
    },
  ];

  const piMatch = findWorkflowDagTargetChildSession(childSessions, 'same-session-id', 'pi');
  const codexMatch = findWorkflowDagTargetChildSession(childSessions, 'same-session-id', 'codex');
  const legacyMatch = findWorkflowDagTargetChildSession(childSessions, 'same-session-id');

  assert.equal(piMatch?.provider, 'pi', 'pi target must not navigate to codex child session');
  assert.equal(codexMatch?.provider, 'codex', 'codex target must not navigate to pi child session');
  assert.equal(legacyMatch?.provider, 'codex', 'legacy unqualified target keeps id-only fallback behavior');
});

test('shared workflow child-session lookup prefers provider and stage before legacy id fallback', () => {
  const childSessions = [
    {
      id: 'same-session-id',
      provider: 'codex',
      stageKey: 'review_1',
      title: 'Codex reviewer',
    },
    {
      id: 'same-session-id',
      provider: 'pi',
      stageKey: 'execution',
      title: 'Pi executor',
    },
  ];

  const providerStageMatch = findWorkflowChildSession(childSessions, 'same-session-id', {
    provider: 'pi',
    stageKey: 'execution',
  });
  const providerOnlyMatch = findWorkflowChildSession(childSessions, 'same-session-id', {
    provider: 'pi',
  });
  const strictMissingProvider = findWorkflowChildSession(childSessions, 'same-session-id', {
    provider: 'claude',
    allowLegacyIdOnly: false,
  });

  assert.equal(providerStageMatch?.stageKey, 'execution', 'provider+stage match must win');
  assert.equal(providerOnlyMatch?.provider, 'pi', 'provider-only match must beat id-only fallback');
  assert.equal(strictMissingProvider, null, 'provider-qualified lookups must not silently id-only fallback');
  assert.equal(
    hasWorkflowChildSession(childSessions, 'same-session-id', { provider: 'pi' }),
    true,
    'workflow ownership checks use the provider-aware resolver',
  );
});
