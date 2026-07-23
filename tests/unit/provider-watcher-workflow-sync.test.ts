/**
 * 文件目的：验证新 Provider transcript 会刷新 oz flow 会话所有权索引。
 * 业务风险：服务启动后创建的外部 flow run 若未同步，内部会话会泄漏到首页待处理看板。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { syncWorkflowIndexForNewProviderSession } from '../../backend/server/provider-watchers';

test('新 Provider 会话先同步 workflow 索引并注册新 run watcher', async () => {
  /** 模拟服务启动后 oz flow 创建 executor transcript 的真实事件顺序。 */
  const calls: string[] = [];
  const workflows = [{ runner: 'go', runId: 'run-new' }];
  await syncWorkflowIndexForNewProviderSession({
    eventType: 'add',
    projectName: 'demo',
    projectPath: '/work/demo',
    syncProjectWorkflowOverviewIndex: async (projectPath) => {
      calls.push(`sync:${projectPath}`);
      return workflows;
    },
    ensureGoRunnerWatchersForProjects: async (projects, watcher) => {
      calls.push(`watchers:${projects[0].workflows[0].runId}`);
      await watcher(projects[0], projects[0].workflows[0]);
    },
    watchGoWorkflowRun: async (_project, workflow) => {
      calls.push(`watch:${workflow.runId}`);
    },
  });

  assert.deepEqual(calls, [
    'sync:/work/demo',
    'watchers:run-new',
    'watch:run-new',
  ]);
});

test('已有 transcript 的 change 事件不重复扫描 workflow 状态', async () => {
  /** 高频 token 追加只能走 Provider 索引，不应反复扫描全部 workflow run。 */
  let syncCount = 0;
  await syncWorkflowIndexForNewProviderSession({
    eventType: 'change',
    projectPath: '/work/demo',
    syncProjectWorkflowOverviewIndex: async () => {
      syncCount += 1;
      return [];
    },
    watchGoWorkflowRun: async () => {},
  });

  assert.equal(syncCount, 0);
});
