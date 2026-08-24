/**
 * 文件目的：验证聊天搜索的项目隔离、结果上限和按文件版本失效缓存合同。
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { addProjectManually, clearProjectDirectoryCache, searchChatHistory } from '../../backend/projects.ts';

/** Write one real Codex transcript and return its JSONL path. */
async function writeSession(home: string, projectPath: string, id: string, content: string): Promise<string> {
  const directory = path.join(home, '.codex', 'sessions', '2026', '08', '24');
  const filePath = path.join(directory, `${id}.jsonl`);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(filePath, [
    JSON.stringify({ type: 'session_meta', timestamp: '2026-08-24T01:00:00.000Z', payload: { id, cwd: projectPath } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-08-24T01:00:01.000Z', payload: { type: 'user_message', message: content } }),
  ].join('\n') + '\n', 'utf8');
  return filePath;
}

test('chat search scopes projects, limits results, and invalidates changed transcripts', { concurrency: false }, async () => {
  const previousHome = process.env.HOME;
  const previousStateHome = process.env.XDG_STATE_HOME;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-search-scope-'));
  process.env.HOME = home;
  process.env.XDG_STATE_HOME = path.join(home, 'state');
  clearProjectDirectoryCache();

  try {
    const alphaPath = path.join(home, 'workspace', 'alpha');
    const betaPath = path.join(home, 'workspace', 'beta');
    await Promise.all([fs.mkdir(alphaPath, { recursive: true }), fs.mkdir(betaPath, { recursive: true })]);
    const alpha = await addProjectManually(alphaPath, 'Alpha');
    await addProjectManually(betaPath, 'Beta');
    const alphaFile = await writeSession(home, alphaPath, 'search-alpha', 'shared-search-token alpha-only-token');
    await writeSession(home, betaPath, 'search-beta', 'shared-search-token beta-only-token');
    await writeSession(home, alphaPath, 'search-x-alpha', 'secondary alpha transcript');

    const scoped = await searchChatHistory('only-token', 'content', { projectPath: alphaPath });
    assert.equal(scoped.some((result) => result.sessionId === 'search-alpha'), true);
    assert.equal(scoped.some((result) => result.sessionId === 'search-beta'), false);
    assert.equal(scoped.every((result) => result.projectPath === alphaPath), true);

    const byName = await searchChatHistory('alpha-only-token', 'content', { projectName: alpha.name });
    assert.equal(byName.some((result) => result.sessionId === 'search-alpha'), true);
    const global = await searchChatHistory('beta-only-token');
    assert.equal(global.some((result) => result.sessionId === 'search-beta'), true);
    assert.equal((await searchChatHistory('shared-search-token', 'content', { limit: 1 })).length, 1);
    assert.equal((await searchChatHistory('shared-search-token', 'content', { limit: 999 })).length, 2);

    const fuzzy = await searchChatHistory('search-alpha', 'jsonl', { projectPath: alphaPath });
    assert.equal(fuzzy.length, 2, 'JSONL metadata search falls back to ordered-character fuzzy matching');
    assert.equal(fuzzy[0].sessionId, 'search-alpha', 'direct substring relevance ranks before fuzzy-only matches');

    await searchChatHistory('alpha-only-token', 'content', { projectPath: alphaPath });
    await fs.appendFile(alphaFile, `${JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-08-24T01:00:02.000Z',
      payload: { type: 'agent_message', message: 'cache-version-changed-token' },
    })}\n`, 'utf8');
    const changed = await searchChatHistory('cache-version-changed-token', 'content', { projectPath: alphaPath });
    assert.equal(changed.some((result) => result.sessionId === 'search-alpha'), true);
  } finally {
    clearProjectDirectoryCache();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousStateHome;
    await fs.rm(home, { recursive: true, force: true });
  }
});
