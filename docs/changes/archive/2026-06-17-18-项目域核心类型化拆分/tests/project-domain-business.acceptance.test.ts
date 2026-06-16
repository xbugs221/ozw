/**
 * 文件目的：用真实临时 HOME、项目配置和 Codex JSONL 验证项目域拆分不能破坏用户可见业务路径。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  addProjectManually,
  bindManualSessionProvider,
  clearProjectDirectoryCache,
  createManualSessionDraft,
  finalizeManualSessionRoute,
  getCodexSessions,
  getManualSessionRouteRuntime,
  initManualSessionRoute,
  loadProjectConfig,
  searchChatHistory,
} from '../../../../backend/projects.ts';

const REPO_ROOT = process.cwd();
const EVIDENCE_DIR = path.join(REPO_ROOT, 'test-results', '18-project-domain-business');

/**
 * 在隔离 HOME 中运行项目域业务测试，避免读取用户本机真实 provider 历史。
 */
async function withTemporaryHome(testBody: (tempHome: string) => Promise<void>): Promise<void> {
  const originalHome = process.env.HOME;
  const originalXdgStateHome = process.env.XDG_STATE_HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-project-domain-contract-'));

  process.env.HOME = tempHome;
  process.env.XDG_STATE_HOME = path.join(tempHome, 'state');
  clearProjectDirectoryCache();

  try {
    await testBody(tempHome);
  } finally {
    clearProjectDirectoryCache();
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (originalXdgStateHome) {
      process.env.XDG_STATE_HOME = originalXdgStateHome;
    } else {
      delete process.env.XDG_STATE_HOME;
    }
    await fs.rm(tempHome, { recursive: true, force: true });
  }
}

/**
 * 写入真实 Codex JSONL 形态，让 provider session index 和搜索走生产解析路径。
 */
async function writeCodexSessionFile(
  homeDir: string,
  projectPath: string,
  sessionId: string,
  userMessage: string,
): Promise<string> {
  const sessionDir = path.join(homeDir, '.codex', 'sessions', '2026', '06', '16');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-06-16T01:00:00.000Z',
        payload: { id: sessionId, cwd: projectPath, model: 'gpt-5.4' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-06-16T01:00:01.000Z',
        payload: { type: 'user_message', message: userMessage },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-06-16T01:00:02.000Z',
        payload: { type: 'agent_message', message: '项目域拆分合同回复' },
      }),
    ].join('\n') + '\n',
    'utf8',
  );

  return sessionPath;
}

/**
 * 把业务状态写入 evidence，便于执行阶段复核真实 route 和搜索结果。
 */
async function writeEvidence(fileName: string, value: unknown): Promise<void> {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

test('Codex 手动 cN route 在 start、bind、finalize 后仍保留用户可见路由', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'manual-route-contract');
    const providerSessionId = 'codex-contract-provider-session';
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, '项目域拆分手动路由合同');
    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', '用户创建的 Codex 手动会话');
    const startResult = await initManualSessionRoute(project.name, projectPath, draft.id, 'codex');
    await writeCodexSessionFile(tempHome, projectPath, providerSessionId, '项目域拆分 cN route 业务短语');
    await bindManualSessionProvider(project.name, projectPath, draft.id, providerSessionId);

    const runtimeBeforeFinalize = await getManualSessionRouteRuntime(project.name, projectPath, draft.id);
    const sessionsBeforeFinalize = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    const finalized = await finalizeManualSessionRoute(project.name, draft.id, providerSessionId, 'codex', projectPath);
    const runtimeAfterFinalize = await getManualSessionRouteRuntime(project.name, projectPath, draft.id);
    const sessionsAfterFinalize = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    const finalConfig = await loadProjectConfig(projectPath);

    const evidence = {
      project,
      draft,
      startResult,
      runtimeBeforeFinalize,
      runtimeAfterFinalize,
      sessionIdsBeforeFinalize: sessionsBeforeFinalize.map((session) => ({
        id: session.id,
        providerSessionId: session.providerSessionId || '',
        routeIndex: session.routeIndex || null,
      })),
      sessionIdsAfterFinalize: sessionsAfterFinalize.map((session) => ({
        id: session.id,
        providerSessionId: session.providerSessionId || '',
        routeIndex: session.routeIndex || null,
      })),
      finalConfigChat: finalConfig.chat,
    };
    await writeEvidence('manual-route.json', evidence);

    assert.equal(startResult.started, true, '第一次 start 必须登记 cN route');
    assert.equal(runtimeBeforeFinalize?.providerSessionId, providerSessionId, 'bind 后 runtime 必须能看到真实 provider session id');
    assert.equal(finalized, true, 'finalize 必须成功写入最终 provider session');
    assert.equal(runtimeAfterFinalize?.providerSessionId, providerSessionId, 'finalize 后 runtime 仍必须从 cN 找到 provider session');
    const matchingProviderSessions = sessionsAfterFinalize.filter((session) => (
      session.id === providerSessionId || session.providerSessionId === providerSessionId
    ));
    assert.equal(
      matchingProviderSessions.some((session) => session.routeIndex === runtimeAfterFinalize?.routeIndex),
      true,
      '会话列表必须保留可映射到 cN 的 routeIndex',
    );
    assert.equal(
      matchingProviderSessions.length,
      1,
      '已绑定到 cN 的底层 provider session 不得重复显示',
    );
  });
});

test('searchChatHistory 能搜索真实 Codex JSONL 用户消息', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'search-contract');
    const providerSessionId = 'codex-search-contract-session';
    const uniquePhrase = '项目域拆分搜索合同唯一短语';
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, '项目域拆分搜索合同');
    await writeCodexSessionFile(tempHome, projectPath, providerSessionId, uniquePhrase);

    const results = await searchChatHistory(uniquePhrase);
    const evidence = {
      project,
      uniquePhrase,
      results: results.map((result) => ({
        sessionId: result.sessionId,
        projectName: result.projectName,
        provider: result.provider || '',
        snippet: result.snippet || '',
      })),
    };
    await writeEvidence('search.json', evidence);

    assert.equal(
      results.some((result) => (
        result.sessionId === providerSessionId
        && result.projectName === project.name
        && String(result.snippet || '').includes(uniquePhrase)
      )),
      true,
      '搜索结果必须包含真实 Codex JSONL 所属 session、项目名和命中文本',
    );
  });
});
