// Sources: 3-拆分Provider会话列表读模型
/**
 * 文件目的：验证 Provider 会话列表 read model 的长期业务规格。
 * 业务意义：项目首页普通会话列表必须合并手动 cN 路由，隐藏重复底层 provider session，并过滤 workflow 子会话。
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildProviderSessionListReadModel } from '../../backend/domains/projects/provider-session-list-read-model.ts';

/**
 * 写入规格测试运行后的状态快照，供 QA 或回归排查复核。
 */
async function writeEvidenceSnapshot(fileName: string, payload: unknown): Promise<void> {
  /**
   * PURPOSE: Store runtime evidence for Provider session list behavior without
   * committing generated artifacts to the repository.
   */
  const evidenceDir = path.join(process.cwd(), 'test-results', 'provider-session-list');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(path.join(evidenceDir, fileName), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

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

  await writeEvidenceSnapshot('read-model-output.json', output);
});

test('Provider 会话列表不会让缺失时间的旧 cN 路由挤掉最近 provider 会话', async () => {
  /**
   * 业务场景：旧版本自动导入的 cN 路由可能没有 createdAt/updatedAt；
   * 它们不能被当成“刚刚活动”排在真实新 JSONL 会话之前。
   */
  const output = buildProviderSessionListReadModel({
    provider: 'codex',
    providerSessions: [
      {
        id: 'recent-provider-session',
        title: '刚创建的真实 Codex 会话',
        lastActivity: '2026-06-18T06:30:00.000Z',
      },
    ],
    manualDrafts: [
      {
        id: 'old-routed-session',
        routeIndex: 1,
        provider: 'codex',
        title: '旧 cN 路由',
      },
    ],
    excludeWorkflowChildSessions: true,
    includeHidden: true,
  });

  assert.equal(output[0].id, 'recent-provider-session');
  assert.equal(output[1].id, 'old-routed-session');

  await writeEvidenceSnapshot('untimestamped-route-order.json', output);
});

test('Provider 会话列表过滤旧版本误标为 manual 的 workflow 角色提示会话', async () => {
  /**
   * 业务场景：历史 workflow 子会话曾以 cN manual route 形态持久化，项目首页不能把这些内部角色会话展示成手动会话。
   */
  const output = buildProviderSessionListReadModel({
    provider: 'pi',
    providerSessions: [
      {
        id: 'legacy-workflow-role-provider',
        title: '你是 回归场景测试员，职责：覆盖邻近功能',
        lastActivity: '2026-06-17T09:00:00.000Z',
      },
      {
        id: 'manual-provider-thread',
        title: '用户直接创建的 Pi 手动会话',
        lastActivity: '2026-06-17T10:00:00.000Z',
      },
    ],
    manualDrafts: [
      {
        id: 'c72',
        routeIndex: 72,
        provider: 'pi',
        origin: 'manual',
        providerSessionId: 'legacy-workflow-role-provider',
        title: '你是 回归场景测试员，职责：覆盖邻近功能',
        lastActivity: '2026-06-17T11:00:00.000Z',
      },
      {
        id: 'c73',
        routeIndex: 73,
        provider: 'pi',
        origin: 'manual',
        providerSessionId: 'manual-provider-thread',
        title: '用户直接创建的 Pi 手动会话',
        lastActivity: '2026-06-17T12:00:00.000Z',
      },
    ],
    workflowOwnedSessionIds: new Set(),
    excludeWorkflowChildSessions: true,
    includeHidden: true,
  });

  assert.deepEqual(output.map((session) => session.id), ['c73']);
  assert.equal(output[0].providerSessionId, 'manual-provider-thread');

  await writeEvidenceSnapshot('legacy-workflow-role-filter.json', output);
});

test('projects.ts 调用 Provider 会话列表 read model 而不是内联核心过滤规则', async () => {
  /**
   * 业务场景：后续修复项目首页会话展示时，开发者能先改项目域小模块和小测试，
   * backend/projects.ts 只保留兼容导出。
   */
  const projectsSource = await fs.readFile(path.join(process.cwd(), 'backend/projects.ts'), 'utf8');
  const domainServiceSource = await fs.readFile(
    path.join(process.cwd(), 'backend/domains/projects/project-domain-service.ts'),
    'utf8',
  );
  const readModelSource = await fs.readFile(
    path.join(process.cwd(), 'backend/domains/projects/provider-session-list-read-model.ts'),
    'utf8',
  );

  const audit = {
    projectsIsFacade: /export \* from '.\/domains\/projects\/project-domain-service\.js'/.test(projectsSource),
    domainServiceImportsReadModel: /buildProviderSessionListReadModel/.test(domainServiceSource),
    readModelHandlesBoundProviderSessionIds: /boundProviderSessionIds|providerSessionId/.test(readModelSource),
    readModelHandlesWorkflowOwnedSessionIds: /workflowOwnedSessionIds/.test(readModelSource),
    projectsKeepsInlineBoundProviderSet: /const boundProviderSessionIds = new Set/.test(projectsSource),
  };

  assert.equal(audit.projectsIsFacade, true);
  assert.equal(audit.domainServiceImportsReadModel, true);
  assert.equal(audit.readModelHandlesBoundProviderSessionIds, true);
  assert.equal(audit.readModelHandlesWorkflowOwnedSessionIds, true);
  assert.equal(audit.projectsKeepsInlineBoundProviderSet, false);

  await writeEvidenceSnapshot('source-audit.json', audit);
});
