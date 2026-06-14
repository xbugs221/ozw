// @ts-nocheck -- Provider fixture tests use runtime-shaped session payloads.
/**
 * PURPOSE: Verify lightweight provider discovery uses Codex/Pi JSONL headers
 * and OpenCode SQLite rows for project/session overview without deep history reads.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  buildCodexSessionsIndex,
  buildOpencodeSessionsIndexFromSqlite,
  buildPiSessionsIndex,
  clearProjectDirectoryCache,
  addProjectManually,
  getCodexSessionMessages,
  getPiSessions,
  getProjects,
  parseCodexSessionHeader,
} from '../../../backend/projects.ts';

/**
 * Run provider discovery with an isolated HOME so real user histories are not scanned.
 */
async function withTemporaryHome(testBody) {
  const originalHome = process.env.HOME;
  const originalOpencodeDbPath = process.env.OPENCODE_DB_PATH;
  const originalXdgStateHome = process.env.XDG_STATE_HOME;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-provider-fast-'));

  process.env.HOME = homeDir;
  process.env.XDG_STATE_HOME = path.join(homeDir, '.local', 'state');
  delete process.env.OPENCODE_DB_PATH;
  clearProjectDirectoryCache();
  try {
    await testBody(homeDir);
  } finally {
    clearProjectDirectoryCache();
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (originalOpencodeDbPath) {
      process.env.OPENCODE_DB_PATH = originalOpencodeDbPath;
    } else {
      delete process.env.OPENCODE_DB_PATH;
    }
    if (originalXdgStateHome) {
      process.env.XDG_STATE_HOME = originalXdgStateHome;
    } else {
      delete process.env.XDG_STATE_HOME;
    }
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

/**
 * Write one provider JSONL session under the given HOME-relative path.
 */
async function writeJsonl(filePath, records) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${records.join('\n')}\n`, 'utf8');
}

test('Codex project discovery uses session_meta header and ignores malformed later content', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'codex-project');
    const sessionPath = path.join(homeDir, '.codex', 'sessions', '2026', '05', '18', 'rollout-2026-05-18T01-02-03-codex-fast.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(sessionPath, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-18T01:02:03.000Z',
        payload: { id: 'source-codex-fast', cwd: projectPath, model: 'gpt-5' },
      }),
      '{"this later line is intentionally malformed"',
    ]);

    const header = await parseCodexSessionHeader(sessionPath);
    assert.equal(header.id, 'codex-fast');
    assert.equal(header.cwd, projectPath);

    const index = await buildCodexSessionsIndex();
    const sessions = index.get(path.resolve(projectPath)) || [];
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].provider, 'codex');
    assert.equal(sessions[0].messageCount, null);
  });
});

test('Codex old-format fixture falls back to deep parse for cwd discovery', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'codex-old');
    const sessionPath = path.join(homeDir, '.codex', 'sessions', '2026', '05', '18', 'old-codex.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(sessionPath, [
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-05-18T02:00:00.000Z',
        cwd: projectPath,
        payload: { type: 'user_message', message: '旧格式仍应归属到项目' },
      }),
    ]);

    const index = await buildCodexSessionsIndex();
    const sessions = index.get(path.resolve(projectPath)) || [];
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'old-codex');
    assert.match(sessions[0].summary, /旧格式/);
  });
});

test('Pi project discovery uses first type=session JSONL record', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'pi-project');
    const sessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'encoded-project', 'pi-fast.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(sessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-fast',
        timestamp: '2026-05-18T03:00:00.000Z',
        cwd: projectPath,
      }),
      '{"later":"content that project discovery must not need"',
    ]);

    const index = await buildPiSessionsIndex();
    const sessions = index.get(path.resolve(projectPath)) || [];
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'pi-fast');
    assert.equal(sessions[0].provider, 'pi');

    const piSessions = await getPiSessions(projectPath, { includeHidden: true });
    assert.equal(piSessions.some((session) => session.id === 'pi-fast'), true);
  });
});

test('Pi project sessions hide indexed workflow child sessions from normal lists', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'pi-workflow-project');
    const childSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'workflow', 'pi-child.jsonl');
    const manualSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'workflow', 'pi-manual.jsonl');

    await fs.mkdir(path.join(projectPath, '.ozw'), { recursive: true });
    await writeJsonl(childSessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-child',
        timestamp: '2026-05-18T03:10:00.000Z',
        cwd: projectPath,
      }),
    ]);
    await writeJsonl(manualSessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-manual',
        timestamp: '2026-05-18T03:11:00.000Z',
        cwd: projectPath,
      }),
    ]);
    await fs.writeFile(
      path.join(projectPath, '.ozw', 'conf.json'),
      JSON.stringify({
        schemaVersion: 2,
        workflows: {
          1: {
            title: 'Pi child workflow',
            chat: {
              1: { sessionId: 'pi-child', provider: 'pi', stageKey: 'execution' },
            },
          },
        },
      }),
      'utf8',
    );

    const piSessions = await getPiSessions(projectPath, {
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });
    const sessionIds = piSessions.map((session) => session.id);

    assert.equal(sessionIds.includes('pi-child'), false);
    assert.equal(sessionIds.includes('pi-manual'), true);
  });
});

test('OpenCode project discovery reads SQLite session table without CLI fallback', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'opencode-project');
    const dbPath = path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db');

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.exec(`
      create table session (
        id text primary key,
        title text,
        directory text,
        time_created text,
        time_updated text,
        project_id text,
        agent text,
        model text
      );
      insert into session values (
        'oc-fast',
        'SQLite session',
        '${projectPath.replace(/'/g, "''")}',
        '2026-05-18T04:00:00.000Z',
        '2026-05-18T04:05:00.000Z',
        'project-1',
        'build',
        'model-a'
      );
    `);
    db.close();

    const index = await buildOpencodeSessionsIndexFromSqlite(dbPath);
    const sessions = index.get(path.resolve(projectPath)) || [];
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'oc-fast');
    assert.equal(sessions[0].provider, 'opencode');
    assert.equal(sessions[0].messageCount, null);
    assert.equal(sessions[0].messageCountKnown, false);
  });
});

test('getProjects returns manual projects when a provider index exceeds the home budget', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'manual-budget-project');
    const codexSessionsRoot = path.join(homeDir, '.codex', 'sessions');
    const originalReaddir = fs.readdir;

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(codexSessionsRoot, { recursive: true });
    await addProjectManually(projectPath, 'Manual Budget Project');
    clearProjectDirectoryCache();

    fs.readdir = async (...args) => {
      if (path.resolve(String(args[0])) === path.resolve(codexSessionsRoot)) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      return originalReaddir(...args);
    };

    try {
      const startedAt = Date.now();
      const projects = await getProjects();
      const durationMs = Date.now() - startedAt;

      assert.equal(projects.some((project) => project.fullPath === projectPath), true);
      assert.ok(durationMs < 3500, `manual project discovery should degrade within the home budget, got ${durationMs}ms`);
    } finally {
      fs.readdir = originalReaddir;
    }
  });
});

test('concurrent getProjects calls share one Codex session index build', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'codex-concurrent-project');
    const codexSessionsRoot = path.join(homeDir, '.codex', 'sessions');
    const sessionPath = path.join(codexSessionsRoot, '2026', '05', '18', 'rollout-2026-05-18T04-30-00-codex-concurrent.jsonl');
    const originalReaddir = fs.readdir;
    let rootIndexReadCount = 0;

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(sessionPath, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-18T04:30:00.000Z',
        payload: { id: 'source-codex-concurrent', cwd: projectPath },
      }),
    ]);

    fs.readdir = async (...args) => {
      if (path.resolve(String(args[0])) === path.resolve(codexSessionsRoot)) {
        rootIndexReadCount += 1;
      }
      return originalReaddir(...args);
    };

    try {
      const [firstProjects, secondProjects] = await Promise.all([getProjects(), getProjects()]);
      assert.equal(firstProjects.some((project) => project.fullPath === projectPath), true);
      assert.equal(secondProjects.some((project) => project.fullPath === projectPath), true);
      assert.equal(rootIndexReadCount, 1);
    } finally {
      fs.readdir = originalReaddir;
    }
  });
});

test('getProjects keeps Codex, Pi, and OpenCode sessions separated for the same project', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'mixed-project');
    const codexPath = path.join(homeDir, '.codex', 'sessions', '2026', '05', '18', 'rollout-2026-05-18T05-00-00-codex-mixed.jsonl');
    const piPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'mixed', 'pi-mixed.jsonl');
    const dbPath = path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(codexPath, [
      JSON.stringify({ type: 'session_meta', timestamp: '2026-05-18T05:00:00.000Z', payload: { id: 'codex-source', cwd: projectPath } }),
    ]);
    await writeJsonl(piPath, [
      JSON.stringify({ type: 'session', id: 'pi-mixed', timestamp: '2026-05-18T05:01:00.000Z', cwd: projectPath }),
    ]);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.exec(`
      create table session (
        id text primary key,
        title text,
        directory text,
        time_created text,
        time_updated text,
        project_id text,
        agent text,
        model text
      );
      insert into session values ('oc-mixed', 'OpenCode mixed', '${projectPath.replace(/'/g, "''")}', '2026-05-18T05:02:00.000Z', '2026-05-18T05:02:00.000Z', 'project-2', 'agent', 'model');
    `);
    db.close();

    const projects = await getProjects();
    const project = projects.find((candidate) => candidate.fullPath === projectPath);
    assert.ok(project, 'mixed provider project should be discovered');
    assert.equal(project.codexSessions.some((session) => session.provider === 'codex'), true);
    assert.equal(project.piSessions.some((session) => session.provider === 'pi'), true);
    assert.equal(project.opencodeSessions.some((session) => session.provider === 'opencode'), true);
  });
});

test('Codex detail messages still deep-read transcript after header overview discovery', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'codex-detail');
    const sessionPath = path.join(homeDir, '.codex', 'sessions', '2026', '05', '18', 'rollout-2026-05-18T06-00-00-codex-detail.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(sessionPath, [
      JSON.stringify({ type: 'session_meta', timestamp: '2026-05-18T06:00:00.000Z', payload: { id: 'source-detail', cwd: projectPath } }),
      JSON.stringify({ type: 'event_msg', timestamp: '2026-05-18T06:01:00.000Z', payload: { type: 'user_message', message: '详情消息必须仍可读取' } }),
    ]);

    const index = await buildCodexSessionsIndex();
    assert.equal((index.get(path.resolve(projectPath)) || [])[0].messageCount, null);

    const detail = await getCodexSessionMessages('codex-detail', null, 0);
    assert.equal(detail.messages.some((message) => message.message?.content === '详情消息必须仍可读取'), true);
  });
});
