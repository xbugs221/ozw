/**
 * PURPOSE: 验证 Provider 会话列表 read model 的核心业务规则已经从
 * backend/projects.ts 拆出，并保持手动 cN、workflow 子会话过滤语义。
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildProviderSessionListReadModel } from '../../../../backend/domains/projects/provider-session-list-read-model.ts';

const REPO_ROOT = path.resolve(new URL('../../../../', import.meta.url).pathname);

test('Provider 会话列表隐藏已绑定 cN 的原始 session 并过滤 workflow-owned session', async () => {
  /**
   * 业务场景：项目首页普通手动会话只显示用户可点击的 cN 会话，不重复显示底层 provider JSONL。
   */
  const output = buildProviderSessionListReadModel({
    provider: 'codex',
    providerSessions: [
      {
        id: 'provider-visible',
        title: '普通 Codex 会话',
        lastActivity: '2026-06-14T10:00:00.000Z',
      },
      {
        id: 'provider-bound',
        title: '已绑定到底层 JSONL',
        lastActivity: '2026-06-14T11:00:00.000Z',
      },
      {
        id: 'workflow-child',
        title: '工作流子会话',
        lastActivity: '2026-06-14T12:00:00.000Z',
      },
    ],
    manualDrafts: [
      {
        id: 'c1',
        routeIndex: 1,
        provider: 'codex',
        providerSessionId: 'provider-bound',
        title: '手动路由会话',
        lastActivity: '2026-06-14T13:00:00.000Z',
      },
    ],
    workflowOwnedSessionIds: new Set(['workflow-child']),
    excludeWorkflowChildSessions: true,
    includeHidden: false,
  });

  assert.deepEqual(output.map((session) => session.id), ['c1', 'provider-visible']);
  assert.equal(output[0].routeIndex, 1);
  assert.equal(output[0].providerSessionId, 'provider-bound');
  assert.equal(output.some((session) => session.id === 'provider-bound'), false);
  assert.equal(output.some((session) => session.id === 'workflow-child'), false);

  await fs.mkdir(path.join(REPO_ROOT, 'test-results/provider-session-list'), { recursive: true });
  await fs.writeFile(
    path.join(REPO_ROOT, 'test-results/provider-session-list/read-model-output.json'),
    JSON.stringify(output, null, 2),
    'utf8',
  );
});

test('projects.ts 调用 Provider 会话列表 read model 而不是内联核心过滤规则', async () => {
  /**
   * 业务场景：后续修复项目首页会话展示时，开发者能先改小模块和小测试。
   */
  const projectsSource = await fs.readFile(path.join(REPO_ROOT, 'backend/projects.ts'), 'utf8');
  const readModelSource = await fs.readFile(
    path.join(REPO_ROOT, 'backend/domains/projects/provider-session-list-read-model.ts'),
    'utf8',
  );

  const audit = {
    projectsImportsReadModel: /buildProviderSessionListReadModel/.test(projectsSource),
    readModelHandlesBoundProviderSessionIds: /boundProviderSessionIds|providerSessionId/.test(readModelSource),
    readModelHandlesWorkflowOwnedSessionIds: /workflowOwnedSessionIds/.test(readModelSource),
    projectsKeepsInlineBoundProviderSet: /const boundProviderSessionIds = new Set/.test(projectsSource),
  };

  assert.equal(audit.projectsImportsReadModel, true);
  assert.equal(audit.readModelHandlesBoundProviderSessionIds, true);
  assert.equal(audit.readModelHandlesWorkflowOwnedSessionIds, true);
  assert.equal(audit.projectsKeepsInlineBoundProviderSet, false);

  await fs.mkdir(path.join(REPO_ROOT, 'test-results/provider-session-list'), { recursive: true });
  await fs.writeFile(
    path.join(REPO_ROOT, 'test-results/provider-session-list/source-audit.json'),
    JSON.stringify(audit, null, 2),
    'utf8',
  );
});
