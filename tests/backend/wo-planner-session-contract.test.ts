// @ts-nocheck -- Test file for oz change 34
/**
 * PURPOSE: Verify ozw read model follows the current wo planner session
 * contract (<tool>:planner), keeps sessions-only state from producing fake
 * process rows, and preserves legacy backward compatibility.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listWorkflowReadModels } from '../../backend/domains/workflows/workflow-read-model.ts';
import { resolveFlowRunsRoot } from '../../backend/domains/workflows/flow-runtime-paths.ts';

async function withTempProject(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-planner-contract-'));
  const projectPath = path.join(tempRoot, 'project');
  await fs.mkdir(projectPath, { recursive: true });
  try {
    await callback({ tempRoot, projectPath });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test('codex:planner 规划会话可链接到工作流子会话', async () => {
  await withTempProject(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-planner');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-planner',
      change_name: '测试变更',
      status: 'running',
      stage: 'planning',
      stages: { planning: 'active' },
      sessions: {
        'codex:planner': 'planner-thread-1',
      },
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);

    // 角色摘要中 planning 行应展示可链接的会话
    const planningRow = workflow.workflowRoleSummary.rows.find((r) => r.key === 'planning');
    assert.ok(planningRow, '应有规划角色行');
    assert.equal(planningRow.placeholder, undefined, '有会话时不应显示未知 placeholder');
    assert.ok(planningRow.sessionRef, '应有 sessionRef');
    assert.equal(planningRow.sessionRef.sessionId, 'planner-thread-1');
    assert.equal(planningRow.sessionRef.provider, 'codex');

    // childSessions 应包含规划会话入口
    const plannerChildSession = workflow.childSessions
      .find((s) => s.stageKey === 'planning' && s.role === 'planner');
    assert.ok(plannerChildSession, 'childSessions 应包含 planner 子会话');
    assert.equal(plannerChildSession.id, 'planner-thread-1');
    assert.equal(plannerChildSession.provider, 'codex');

    // sessions-only 状态不应产生 runnerProcesses
    assert.deepEqual(workflow.runnerProcesses, []);
  });
});

test('pi:planner 非 codex planner 可正确识别 provider', async () => {
  await withTempProject(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-pi-planner');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-pi-planner',
      change_name: '测试变更',
      status: 'running',
      stage: 'planning',
      stages: { planning: 'active' },
      sessions: {
        'pi:planner': 'pi-planner-session-1',
      },
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);
    const planningRow = workflow.workflowRoleSummary.rows.find((r) => r.key === 'planning');
    assert.ok(planningRow.sessionRef);
    assert.equal(planningRow.sessionRef.sessionId, 'pi-planner-session-1');
    assert.equal(planningRow.sessionRef.provider, 'pi');

    const plannerChildSession = workflow.childSessions
      .find((s) => s.stageKey === 'planning' && s.id === 'pi-planner-session-1');
    assert.ok(plannerChildSession, '应有 pi planner 子会话');
    assert.equal(plannerChildSession.provider, 'pi');
  });
});

test('planning.tool=pi 且 codex/pi planner 并存时 pi:planner 胜出并占用 planning 地址', async () => {
  await withTempProject(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-tool-pi-planner-conflict');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-tool-pi-planner-conflict',
      change_name: '测试变更',
      status: 'running',
      stage: 'planning',
      stages: { planning: 'active' },
      workflow_config: {
        stages: { planning: { tool: 'pi' } },
      },
      sessions: {
        'codex:planner': 'codex-thread',
        'pi:planner': 'pi-thread',
      },
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);
    const planningRow = workflow.workflowRoleSummary.rows.find((r) => r.key === 'planning');

    // sessionRef 应指向 pi-thread
    assert.ok(planningRow.sessionRef, '应有 sessionRef');
    assert.equal(planningRow.sessionRef.sessionId, 'pi-thread',
      'tool=pi 时 pi:planner 应胜出');
    assert.equal(planningRow.sessionRef.provider, 'pi');
    assert.equal(planningRow.sessionRef.role, 'planner');
    assert.equal(planningRow.sessionRef.stageKey, 'planning');
    assert.equal(planningRow.sessionRef.address, 'planning',
      'sessionRef.address 应为 planning');
    assert.ok(
      planningRow.sessionRef.routePath.endsWith('/sessions/planning'),
      'routePath 应使用 /sessions/planning',
    );

    // childSessions 的 planning 地址必须指向 pi-thread
    const planningChild = workflow.childSessions
      .find((s) => s.address === 'planning');
    assert.ok(planningChild, 'childSessions 应有 planning 地址条目');
    assert.equal(planningChild.id, 'pi-thread',
      'planning 地址 childSession 必须是 pi-thread');
    assert.equal(planningChild.provider, 'pi');
    assert.equal(planningChild.role, 'planner');
    assert.equal(planningChild.stageKey, 'planning');

    // codex-thread 不得占用 planning 地址
    const codexAtPlanning = workflow.childSessions
      .find((s) => s.id === 'codex-thread' && s.address === 'planning');
    assert.equal(codexAtPlanning, undefined,
      'codex-thread 不得占用 planning 地址');

    // sessionRef 的 routePath 应与 childSession 一致
    assert.equal(planningRow.sessionRef.routePath, planningChild.routePath,
      'sessionRef.routePath 应与 childSession 一致');
  });
});

test('legacy codex:planning 仍可兼容读取', async () => {
  await withTempProject(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-legacy');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-legacy',
      change_name: '测试变更',
      status: 'done',
      stage: 'done',
      stages: { planning: 'completed', execution: 'completed' },
      sessions: {
        'codex:planning': 'legacy-planning-thread',
      },
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);
    const planningRow = workflow.workflowRoleSummary.rows.find((r) => r.key === 'planning');
    assert.ok(planningRow.sessionRef, '应兼容读取 codex:planning');
    assert.equal(planningRow.sessionRef.sessionId, 'legacy-planning-thread');
  });
});

test('规划会话缺失时显示未知占位符', async () => {
  await withTempProject(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-no-planner');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-no-planner',
      change_name: '测试变更',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'active' },
      sessions: {},
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);
    const planningRow = workflow.workflowRoleSummary.rows.find((r) => r.key === 'planning');
    assert.ok(planningRow);
    assert.equal(planningRow.sessionRef, null);
    assert.equal(planningRow.placeholder, '未知');
  });
});

test('sessions-only 状态不产生 runnerProcesses 但 childSessions 仍从 role map 构建', async () => {
  await withTempProject(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-sessions-only');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-sessions-only',
      change_name: '测试变更',
      status: 'running',
      stage: 'execution',
      stages: {
        planning: 'completed',
        execution: 'active',
      },
      sessions: {
        'codex:planner': 'planner-thread',
        'codex:executor': 'executor-thread',
      },
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);

    // runnerProcesses 应为空
    assert.deepEqual(workflow.runnerProcesses, [],
      'sessions-only 状态不应产生 runnerProcesses');

    // childSessions 仍应从 sessions 构建
    assert.ok(workflow.childSessions.length >= 2,
      'childSessions 应包含 sessions role map 中的子会话');

    const executorSession = workflow.childSessions
      .find((s) => s.role === 'executor' && s.id === 'executor-thread');
    assert.ok(executorSession, '应可从 sessions role map 构建 executor 子会话');
  });
});

test('explicit processes 保留 pid 和 sessionId 且二者不混淆', async () => {
  await withTempProject(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-with-processes');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-with-processes',
      change_name: '测试变更',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'active' },
      processes: [
        {
          stage: 'execution',
          role: 'executor',
          status: 'running',
          session_id: 'executor-session-id',
          pid: 4321,
        },
        {
          stage: 'review_1',
          role: 'reviewer',
          status: 'pending',
          session_id: 'reviewer-session-id',
        },
      ],
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);

    assert.equal(workflow.runnerProcesses.length, 2,
      '有 explicit processes 时应产生对应数量的 process rows');

    const execProcess = workflow.runnerProcesses.find((p) => p.stage === 'execution');
    assert.ok(execProcess);
    assert.equal(execProcess.pid, 4321, 'pid 应被保留');
    assert.equal(execProcess.sessionId, 'executor-session-id',
      'sessionId 应来自 session_id');
    // pid 与 sessionId 不同
    assert.notEqual(execProcess.pid, execProcess.sessionId,
      'pid 和 sessionId 是不同概念，不应相同');

    const reviewProcess = workflow.runnerProcesses.find((p) => p.stage === 'review_1');
    assert.ok(reviewProcess);
    assert.equal(reviewProcess.sessionId, 'reviewer-session-id');
    assert.equal(reviewProcess.pid, undefined, '无 pid 不应被伪造');
  });
});

test('旧 sessions fallback 不再合成 process rows', async () => {
  await withTempProject(async ({ projectPath }) => {
    const runRoot = path.join(resolveFlowRunsRoot(projectPath), 'run-old-fallback');
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'state.json'), JSON.stringify({
      run_id: 'run-old-fallback',
      change_name: '测试变更',
      status: 'running',
      stage: 'review_1',
      stages: { execution: 'completed', review_1: 'active' },
      sessions: {
        'codex:executor': 'executor-session',
        'codex:reviewer': 'reviewer-session',
      },
    }));

    const [workflow] = await listWorkflowReadModels(projectPath);

    // 旧 fallback 路径不再产生 process rows
    assert.deepEqual(workflow.runnerProcesses, [],
      '旧 sessions fallback 不应再合成 process rows');

    // 但角色摘要和子会话仍需正常工作
    const execRow = workflow.workflowRoleSummary.rows.find((r) => r.key === 'executor');
    assert.ok(execRow.sessionRef, 'executor 角色行仍应有会话入口');
    assert.equal(execRow.sessionRef.sessionId, 'executor-session');

    const reviewerRow = workflow.workflowRoleSummary.rows.find((r) => r.key === 'reviewer');
    assert.ok(reviewerRow.sessionRef, 'reviewer 角色行仍应有会话入口');
    assert.equal(reviewerRow.sessionRef.sessionId, 'reviewer-session');

    // childSessions 应包含 executor 和 reviewer
    const execSession = workflow.childSessions.find((s) => s.id === 'executor-session');
    assert.ok(execSession, '应有 executor 子会话');
    const reviewSession = workflow.childSessions.find((s) => s.id === 'reviewer-session');
    assert.ok(reviewSession, '应有 reviewer 子会话');
  });
});
