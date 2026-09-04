// Sources: 2026-07-21-42-构建跨项目待处理会话看板
/**
 * 文件目的：锁定跨项目待处理会话的 SQLite 版本、确认与迁移契约。
 * 业务意义：防止批量处理吞掉并发新活动，或旧配置覆盖用户的新状态。
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { providerSessionIndexDb } from '../../backend/provider-session-index-store.ts';
import { sessionAttentionDb } from '../../backend/session-attention-store.ts';
import { workflowOverviewIndexDb } from '../../backend/workflow-overview-index-store.ts';
import {
  parseClaudeSessionHeader,
  parseCodexSessionHeader,
  parsePiSessionHeader,
} from '../../backend/domains/projects/provider-transcript-read-model.ts';
import {
  configureProviderSessionReadModel,
  upsertProviderSessionIndex,
} from '../../backend/domains/projects/provider-session-read-model.ts';

let tempDir = '';
let db: Database.Database;

/** 写入一次真实 Provider 索引活动，并让版本随文件指纹变化递增。 */
function indexActivity(
  provider: string,
  sessionId: string,
  fileMtimeMs: number,
  createdAtMs = fileMtimeMs,
  targetDb = db,
): void {
  /** 创建时间与活动时间可独立变化，用于验证看板不会随回复重排。 */
  providerSessionIndexDb.upsert(targetDb, {
    provider,
    id: sessionId,
    projectPath: `/tmp/session-attention/${provider}`,
    title: `${provider} session`,
    filePath: `/tmp/session-attention/${provider}/${sessionId}.jsonl`,
    createdAt: new Date(createdAtMs).toISOString(),
    lastActivity: new Date(fileMtimeMs).toISOString(),
    fileMtimeMs,
  });
}

before(async () => {
  /** 每次运行使用独立 SQLite 文件，避免污染用户状态。 */
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-session-attention-spec-'));
  db = new Database(path.join(tempDir, 'attention.db'));
  sessionAttentionDb.ensureSchema(db);
});

after(async () => {
  /** 关闭数据库后仅清理本测试创建的精确临时目录。 */
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('三种 Provider 共用有界读模型且复合身份不重复', () => {
  /** 外部启动来源不应影响会话进入同一个看板。 */
  indexActivity('codex', 'shared', 1_750_000_000_001);
  indexActivity('claude', 'shared', 1_750_000_000_002);
  indexActivity('pi', 'pi-session', 1_750_000_000_003);

  const rows = sessionAttentionDb.list(db, { limit: 100 });
  assert.deepEqual(rows.map((row) => `${row.provider}:${row.sessionId}`).sort(), [
    'claude:shared',
    'codex:shared',
    'pi:pi-session',
  ]);
});

test('待处理读模型返回完整首条和最新请求', () => {
  /** 卡片展示必须使用未裁剪正文，而不是路由标题。 */
  const isolatedDb = new Database(':memory:');
  sessionAttentionDb.ensureSchema(isolatedDb);
  const firstRequest = '首条请求\n保留完整换行和所有细节';
  const latestRequest = '最新请求\n同样不能被标题长度截断';
  providerSessionIndexDb.upsert(isolatedDb, {
    provider: 'codex',
    id: 'full-request-copy',
    projectPath: '/tmp/session-attention/codex',
    title: '简短标题',
    firstRequest,
    latestRequest,
    filePath: '/tmp/session-attention/codex/full-request-copy.jsonl',
    createdAt: '2026-08-30T00:00:00.000Z',
    lastActivity: '2026-08-30T00:01:00.000Z',
    fileMtimeMs: 1_788_048_060_000,
  });

  const row = sessionAttentionDb.list(isolatedDb, { limit: 100 })
    .find((item) => item.sessionId === 'full-request-copy');
  assert.ok(row);
  assert.equal(row.firstRequest, firstRequest);
  assert.equal(row.latestRequest, latestRequest);
  isolatedDb.close();
});

test('增量索引把完整首尾请求写入待处理读模型', async () => {
  /** 文件 watcher 更新会话时，首条和末条用户请求都必须穿过索引边界。 */
  const capturedRecords: Array<Record<string, unknown>> = [];
  configureProviderSessionReadModel({
    getDb: async () => db,
    getProviderSessionIndexDb: async () => ({
      upsert: (_db: Database.Database, record: Record<string, unknown>) => {
        /** 捕获写入参数，隔离验证增量索引字段传递。 */
        capturedRecords.push(record);
      },
    }),
    parseCodexSessionHeader: async () => null,
    parseCodexSessionFile: async () => null,
    buildCodexSessionFromHeader: (session) => session,
    parsePiSessionHeader: async () => null,
    parseClaudeSessionHeader: async () => null,
    warn: () => undefined,
  });

  await upsertProviderSessionIndex('codex', {
    id: 'incremental-full-requests',
    projectPath: '/tmp/session-attention/incremental',
    filePath: '/tmp/session-attention/incremental.jsonl',
    firstRequest: '增量首条完整请求',
    latestRequest: '增量末条完整请求',
  });

  const capturedRecord = capturedRecords[0];
  assert.ok(capturedRecord);
  assert.equal(capturedRecord?.firstRequest, '增量首条完整请求');
  assert.equal(capturedRecord?.latestRequest, '增量末条完整请求');
});

test('看板只按创建时间排序，后续回复不会改变卡片位置', () => {
  /** 较旧会话即使刚收到回复，仍排在较新创建的会话之后。 */
  const isolatedDb = new Database(':memory:');
  sessionAttentionDb.ensureSchema(isolatedDb);
  indexActivity('codex', 'older-stable', 1_750_000_000_400, 1_750_000_000_100, isolatedDb);
  indexActivity('pi', 'newer-stable', 1_750_000_000_300, 1_750_000_000_200, isolatedDb);

  const beforeReply = sessionAttentionDb.list(isolatedDb, { limit: 100 })
    .filter((row) => row.sessionId.endsWith('-stable'))
    .map((row) => row.sessionId);
  indexActivity('codex', 'older-stable', 1_750_000_000_500, 1_750_000_000_100, isolatedDb);
  const afterReply = sessionAttentionDb.list(isolatedDb, { limit: 100 })
    .filter((row) => row.sessionId.endsWith('-stable'))
    .map((row) => row.sessionId);

  assert.deepEqual(beforeReply, ['newer-stable', 'older-stable']);
  assert.deepEqual(afterReply, beforeReply);
  isolatedDb.close();
});

test('Codex 和 Pi 索引头提取完整首尾请求', async () => {
  /** 两种会话格式都在建立快速索引时保留用户正文。 */
  const projectPath = path.join(tempDir, 'request-copy-project');
  const codexPath = path.join(tempDir, 'rollout-2026-08-30T00-00-00-request-copy-codex.jsonl');
  const piPath = path.join(tempDir, 'request-copy-pi.jsonl');
  await fs.writeFile(codexPath, [
    JSON.stringify({ type: 'session_meta', timestamp: '2026-08-30T00:00:00.000Z', payload: { id: 'request-copy-codex', cwd: projectPath } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-08-30T00:00:01.000Z', payload: { type: 'user_message', message: '首条 Codex 请求\n完整第二行' } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-08-30T00:00:02.000Z', payload: { type: 'agent_message', message: '回复' } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-08-30T00:00:03.000Z', payload: { type: 'user_message', message: '最新 Codex 请求\n不裁剪' } }),
  ].join('\n') + '\n', 'utf8');
  await fs.writeFile(piPath, [
    JSON.stringify({ type: 'session', id: 'request-copy-pi', cwd: projectPath, timestamp: '2026-08-30T00:00:00.000Z' }),
    JSON.stringify({ type: 'message', timestamp: '2026-08-30T00:00:01.000Z', message: { role: 'user', content: '首条 Pi 请求\n完整第二行' } }),
    JSON.stringify({ type: 'message', timestamp: '2026-08-30T00:00:02.000Z', message: { role: 'assistant', content: '回复' } }),
    JSON.stringify({ type: 'message', timestamp: '2026-08-30T00:00:03.000Z', message: { role: 'user', content: '最新 Pi 请求\n不裁剪' } }),
  ].join('\n') + '\n', 'utf8');

  const [codexHeader, piHeader] = await Promise.all([
    parseCodexSessionHeader(codexPath),
    parsePiSessionHeader(piPath),
  ]);
  assert.equal(codexHeader?.firstRequest, '首条 Codex 请求\n完整第二行');
  assert.equal(codexHeader?.latestRequest, '最新 Codex 请求\n不裁剪');
  assert.equal(piHeader?.firstRequest, '首条 Pi 请求\n完整第二行');
  assert.equal(piHeader?.latestRequest, '最新 Pi 请求\n不裁剪');
});

test('批量确认只记录观察版本并保留并发新活动', () => {
  /** 用户确认版本 N 时，新到达的 N+1 必须继续显示。 */
  const observed = sessionAttentionDb.list(db, { limit: 100 });
  indexActivity('codex', 'shared', 1_750_000_000_101);
  const result = sessionAttentionDb.markHandled(db, observed.map((row) => ({
    provider: row.provider,
    sessionId: row.sessionId,
    observedRevision: row.activityRevision,
  })));

  assert.deepEqual(result.newerActivity, ['codex:shared']);
  assert.deepEqual(sessionAttentionDb.list(db, { limit: 100 }).map((row) => `${row.provider}:${row.sessionId}`), [
    'codex:shared',
  ]);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM provider_session_index').get() as { count: number }).count, 3);
});

test('Claude 文件被触碰但没有新消息时，已完成会话不会重新出现', async () => {
  /** Claude Code may rewrite metadata or restore files; only transcript timestamps count as activity. */
  const isolatedDb = new Database(':memory:');
  sessionAttentionDb.ensureSchema(isolatedDb);
  const projectPath = path.join(tempDir, 'claude-project');
  const sessionPath = path.join(tempDir, 'claude-session.jsonl');
  const sessionId = 'claude-stable-timestamp';
  await fs.writeFile(sessionPath, [
    JSON.stringify({ sessionId, cwd: projectPath, timestamp: '2026-08-01T10:00:00.000Z', type: 'user', message: { content: 'first prompt' } }),
    JSON.stringify({ sessionId, cwd: projectPath, timestamp: '2026-08-01T10:00:05.000Z', type: 'assistant', message: { content: 'first reply' } }),
  ].join('\n') + '\n', 'utf8');

  const initial = await parseClaudeSessionHeader(sessionPath);
  assert.ok(initial);
  assert.equal(initial.firstRequest, 'first prompt');
  assert.equal(initial.latestRequest, 'first prompt');
  providerSessionIndexDb.upsert(
    isolatedDb,
    initial as Parameters<typeof providerSessionIndexDb.upsert>[1],
  );
  const observed = sessionAttentionDb.list(isolatedDb, { limit: 100 }).find((row) => row.sessionId === sessionId);
  assert.ok(observed);
  sessionAttentionDb.markHandled(isolatedDb, [{
    provider: observed.provider,
    sessionId: observed.sessionId,
    observedRevision: observed.activityRevision,
  }]);

  await fs.utimes(sessionPath, new Date('2026-08-02T10:00:00.000Z'), new Date('2026-08-02T10:00:00.000Z'));
  const afterTouch = await parseClaudeSessionHeader(sessionPath);
  assert.ok(afterTouch);
  providerSessionIndexDb.upsert(
    isolatedDb,
    afterTouch as Parameters<typeof providerSessionIndexDb.upsert>[1],
  );
  assert.equal(
    sessionAttentionDb.list(isolatedDb, { limit: 100 }).some((row) => row.sessionId === sessionId),
    false,
  );

  await fs.appendFile(sessionPath, `${JSON.stringify({ sessionId, cwd: projectPath, timestamp: '2026-08-01T10:01:00.000Z', type: 'user', message: { content: 'follow-up' } })}\n`);
  const afterMessage = await parseClaudeSessionHeader(sessionPath);
  assert.ok(afterMessage);
  assert.equal(afterMessage.firstRequest, 'first prompt');
  assert.equal(afterMessage.latestRequest, 'follow-up');
  providerSessionIndexDb.upsert(
    isolatedDb,
    afterMessage as Parameters<typeof providerSessionIndexDb.upsert>[1],
  );
  assert.equal(
    sessionAttentionDb.list(isolatedDb, { limit: 100 }).some((row) => row.sessionId === sessionId),
    true,
  );
  isolatedDb.close();
});

test('非法或未来观察版本被拒绝', () => {
  /** 客户端不得制造永久压住后续活动的确认游标。 */
  const current = sessionAttentionDb.list(db, { limit: 100 })[0];
  for (const observedRevision of [0, 1.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => sessionAttentionDb.markHandled(db, [{
      provider: current.provider,
      sessionId: current.sessionId,
      observedRevision,
    }]), RangeError);
  }
});

test('现代手动待处理状态不会被旧配置迁移覆盖', () => {
  /** 现代用户写入必须原子终止旧 pending 的迁移资格。 */
  const current = sessionAttentionDb.list(db, { limit: 100 })[0];
  sessionAttentionDb.markHandled(db, [{
    provider: current.provider,
    sessionId: current.sessionId,
    observedRevision: current.activityRevision,
  }]);
  sessionAttentionDb.setManualPending(db, current.provider, current.sessionId, true);
  sessionAttentionDb.migrateLegacyPending(db, current.provider, current.sessionId, false);

  const rows = sessionAttentionDb.list(db, { limit: 100 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].manualPending, true);
  const migration = db.prepare(`
    SELECT legacy_pending_migrated FROM session_attention_ack
    WHERE provider = ? AND session_id = ?
  `).get(current.provider, current.sessionId) as { legacy_pending_migrated: number };
  assert.equal(migration.legacy_pending_migrated, 1);
});

test('首页待处理看板按 Provider 身份过滤 oz flow 内部会话', () => {
  /** 工作流索引是所有权真值，即使 Provider 行尚未写入 origin 也不得泄漏到首页。 */
  workflowOverviewIndexDb.replaceForProject(db, '/tmp/session-attention/pi', [{
    id: 'flow-run',
    workflowOwnedSessionRefs: [{ provider: 'pi', sessionId: 'flow-owned' }],
  }]);
  indexActivity('pi', 'flow-owned', 1_750_000_000_201);
  indexActivity('codex', 'flow-owned', 1_750_000_000_202);
  indexActivity('pi', 'manual-visible', 1_750_000_000_203);
  providerSessionIndexDb.upsert(db, {
    provider: 'pi',
    id: 'explicit-workflow',
    origin: 'workflow',
    projectPath: '/tmp/session-attention/pi',
    title: 'explicit workflow session',
    filePath: '/tmp/session-attention/pi/explicit-workflow.jsonl',
    lastActivity: new Date(1_750_000_000_204).toISOString(),
    fileMtimeMs: 1_750_000_000_204,
  });

  const identities = sessionAttentionDb.list(db, { limit: 100 })
    .map((row) => `${row.provider}:${row.sessionId}`);
  assert.equal(identities.includes('pi:flow-owned'), false);
  assert.equal(identities.includes('pi:explicit-workflow'), false);
  assert.equal(identities.includes('codex:flow-owned'), true);
  assert.equal(identities.includes('pi:manual-visible'), true);
});
