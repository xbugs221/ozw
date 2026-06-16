/**
 * Sources: 2026-06-17-18-项目域核心类型化拆分
 *
 * 文件目的：验证项目域拆分后的真实业务路径仍能通过项目配置和 Provider transcript 工作。
 * 业务场景：聊天搜索必须从真实 Provider 历史读取命中内容，而不是依赖项目清单或提案临时测试。
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  addProjectManually,
  clearProjectDirectoryCache,
  searchChatHistory,
} from '../../backend/projects.ts';

const EVIDENCE_DIR = path.join(process.cwd(), 'test-results', 'project-domain-business');

/**
 * Run one project-domain business scenario in an isolated HOME.
 */
async function withTemporaryHome(testBody: (tempHome: string) => Promise<void>): Promise<void> {
  const originalHome = process.env.HOME;
  const originalXdgStateHome = process.env.XDG_STATE_HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-project-domain-business-'));

  process.env.HOME = tempHome;
  process.env.XDG_STATE_HOME = path.join(tempHome, 'state');
  clearProjectDirectoryCache();

  try {
    await testBody(tempHome);
  } finally {
    clearProjectDirectoryCache();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalXdgStateHome;
    }
    await fs.rm(tempHome, { recursive: true, force: true });
  }
}

/**
 * Write a real Codex JSONL transcript that provider index and search can parse.
 */
async function writeCodexSessionFile(
  homeDir: string,
  projectPath: string,
  sessionId: string,
  userMessage: string,
): Promise<void> {
  const sessionDir = path.join(homeDir, '.codex', 'sessions', '2026', '06', '17');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-06-17T01:00:00.000Z',
        payload: { id: sessionId, cwd: projectPath, model: 'gpt-5-codex' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-06-17T01:00:01.000Z',
        payload: { type: 'user_message', message: userMessage },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-06-17T01:00:02.000Z',
        payload: { type: 'agent_message', message: '项目域业务搜索规格回复' },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

/**
 * Persist runtime evidence for search behavior under ignored test-results.
 */
async function writeEvidence(fileName: string, value: unknown): Promise<void> {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(path.join(EVIDENCE_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('searchChatHistory searches real Codex JSONL messages without polluting project list ownership', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'search-contract');
    const providerSessionId = 'codex-project-domain-business-search';
    const uniquePhrase = '项目域长期搜索规格唯一短语';
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, '项目域长期搜索规格');
    await writeCodexSessionFile(tempHome, projectPath, providerSessionId, uniquePhrase);

    const results = await searchChatHistory(uniquePhrase);
    const evidence = {
      projectName: project.name,
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
        && result.provider === 'codex'
        && String(result.snippet || '').includes(uniquePhrase)
      )),
      true,
      '搜索结果必须包含真实 Codex JSONL 所属 session、项目名、provider 和命中文本',
    );
  });
});
