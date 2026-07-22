import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  decodeHermesScopedId,
  encodeHermesScopedId,
  getHermesSessionMessages,
  HERMES_HISTORY_MAX_PAGE_BYTES,
  listHermesSessionsForProject,
  listUnscopedHermesSessions,
} from '../../backend/domains/projects/hermes-session-read-model.js';
import { buildProjectOverviewReadModel } from '../../backend/domains/projects/project-overview-read-model.js';
import { handleGetSessionMessages } from '../../backend/session-messages-handler.js';

function createListDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version VALUES (22);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, started_at REAL NOT NULL,
      cwd TEXT, git_repo_root TEXT, title TEXT, archived INTEGER NOT NULL DEFAULT 0,
      parent_session_id TEXT, ended_at REAL, end_reason TEXT, model_config TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT, timestamp REAL NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT,
      reasoning TEXT, reasoning_content TEXT, reasoning_details TEXT
    );
  `);
  return db;
}

test('Hermes production read model reads an active WAL without mutating it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-hermes-production-'));
  const projectPath = path.join(root, 'project');
  const dbPath = path.join(root, 'state.db');
  await fs.mkdir(path.join(projectPath, 'nested'), { recursive: true });
  const writer = new Database(dbPath);
  try {
    writer.pragma('journal_mode = WAL');
    writer.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version VALUES (22);
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, started_at REAL NOT NULL,
        cwd TEXT, git_repo_root TEXT, title TEXT, archived INTEGER NOT NULL DEFAULT 0,
        parent_session_id TEXT, end_reason TEXT, model_config TEXT
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
        role TEXT NOT NULL, content TEXT, timestamp REAL NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
    `);
    writer.pragma('wal_checkpoint(TRUNCATE)');
    writer.prepare('INSERT INTO sessions (id, source, started_at, cwd, title) VALUES (?, ?, ?, ?, ?)')
      .run('wal-session', 'cli', 1, projectPath, 'WAL history');
    writer.prepare('INSERT INTO sessions (id, source, started_at, cwd, title) VALUES (?, ?, ?, ?, ?)')
      .run('nested-session', 'cli', 2, path.join(projectPath, 'nested'), 'Nested cwd');
    writer.prepare('INSERT INTO sessions (id, source, started_at, cwd, title) VALUES (?, ?, ?, ?, ?)')
      .run('branch-root', 'cli', 3, projectPath, 'Ordinary parent');
    writer.prepare('INSERT INTO sessions (id, source, started_at, cwd, title, parent_session_id, model_config) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('ordinary-branch', 'cli', 4, projectPath, 'Ordinary branch', 'branch-root', JSON.stringify({ _branched_from: 'branch-root' }));
    writer.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)')
      .run('wal-session', 'user', 'persisted in WAL', 1);
    writer.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)')
      .run('branch-root', 'user', 'PARENT_SHOULD_NOT_MERGE', 2);
    writer.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)')
      .run('ordinary-branch', 'user', 'BRANCH_ONLY', 3);
    const insertLong = writer.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)');
    for (let index = 0; index < 120; index += 1) {
      insertLong.run('wal-session', index % 2 ? 'assistant' : 'user', `long-${index}`, 10 + index);
    }

    const homes = [{ scope: 'default', dbPath }];
    const listed = await listHermesSessionsForProject(projectPath, { homes });
    assert.ok(listed.sessions.some((session) => session.id === 'default~nested-session'));
    const history = await getHermesSessionMessages(
      { providerScope: 'default', providerSessionId: 'wal-session' },
      { homes, limit: 50 },
    );
    assert.equal(history.total, 121);
    assert.equal(history.hasMore, true);
    assert.equal(history.nextMessageOffset, 50);
    assert.match(JSON.stringify(history.messages), /long-119/);
    assert.ok(history.nextCursor);
    writer.prepare("UPDATE messages SET active = 0 WHERE session_id = 'wal-session' AND id >= 104").run();
    const before = await fs.stat(dbPath);
    const olderHistory = await getHermesSessionMessages(
      { providerScope: 'default', providerSessionId: 'wal-session' },
      { homes, limit: 50, cursor: history.nextCursor },
    );
    assert.equal(olderHistory.nextMessageOffset, 100);
    assert.equal(olderHistory.hasMore, true);
    assert.equal(olderHistory.total, 121);
    const firstPageKeys = new Set(history.messages.map((message) => message.messageKey));
    assert.equal(olderHistory.messages.some((message) => firstPageKeys.has(message.messageKey)), false);
    assert.match(JSON.stringify(olderHistory.messages), /long-50/);
    assert.match(JSON.stringify(olderHistory.messages), /long-69/);
    const branchHistory = await getHermesSessionMessages(
      { providerScope: 'default', providerSessionId: 'ordinary-branch' },
      { homes },
    );
    assert.match(JSON.stringify(branchHistory.messages), /BRANCH_ONLY/);
    assert.doesNotMatch(JSON.stringify(branchHistory.messages), /PARENT_SHOULD_NOT_MERGE/);
    const after = await fs.stat(dbPath);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  } finally {
    writer.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Hermes overview globally sorts profiles, hides archived rows, and keeps scoped diagnostics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-hermes-overview-'));
  const projectPath = path.join(root, 'project');
  const profilesPath = path.join(root, 'profiles');
  const teamPath = path.join(profilesPath, 'team');
  const brokenPath = path.join(profilesPath, 'broken');
  await Promise.all([fs.mkdir(projectPath), fs.mkdir(teamPath, { recursive: true }), fs.mkdir(brokenPath, { recursive: true })]);
  const defaultDb = createListDb(path.join(root, 'state.db'));
  const teamDb = createListDb(path.join(teamPath, 'state.db'));
  const brokenDb = new Database(path.join(brokenPath, 'state.db'));
  const previousHome = process.env.HERMES_HOME;
  try {
    const insert = defaultDb.prepare('INSERT INTO sessions (id, source, started_at, cwd, title, archived) VALUES (?, ?, ?, ?, ?, ?)');
    for (let index = 1; index <= 12; index += 1) insert.run(`default-${index}`, 'cli', index, projectPath, `Default ${index}`, 0);
    insert.run('archived-newest', 'cli', 1000, projectPath, 'Archived newest', 1);
    teamDb.prepare('INSERT INTO sessions (id, source, started_at, cwd, title, archived) VALUES (?, ?, ?, ?, ?, 0)')
      .run('team-newest', 'cli', 999, projectPath, 'Team newest');
    brokenDb.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
    process.env.HERMES_HOME = root;

    const overview = await buildProjectOverviewReadModel(
      { name: 'project', displayName: 'project', fullPath: projectPath, path: projectPath },
      {
        summarizeProjectForList: (project = {}) => project,
        attachWorkflowMetadata: async (projects) => projects,
        getCodexSessions: async () => [],
        getPiSessions: async () => [],
        getClaudeSessions: async () => [],
      },
    );
    assert.equal(overview.hermesSessions.length, 10);
    assert.equal(overview.hermesSessions[0].providerSessionId, 'team-newest');
    assert.equal(overview.hermesSessions.some((session: any) => session.providerSessionId === 'archived-newest'), false);
    assert.equal(overview.hermesDiagnostics.some((item: any) => item.scope === 'broken' && item.status === 'incompatible'), true);
  } finally {
    if (previousHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = previousHome;
    defaultDb.close();
    teamDb.close();
    brokenDb.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Hermes projection uses valid ownership, message activity, atomic tool groups, and true compression continuations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-hermes-projection-'));
  const projectPath = path.join(root, 'project');
  const missingPath = path.join(root, 'removed-project');
  const dbPath = path.join(root, 'state.db');
  await fs.mkdir(projectPath);
  const db = createListDb(dbPath);
  try {
    const insertSession = db.prepare(`
      INSERT INTO sessions (id, source, started_at, cwd, title, parent_session_id, end_reason, model_config)
      VALUES (?, 'cli', ?, ?, ?, ?, ?, ?)
    `);
    insertSession.run('recent-start', 200, projectPath, 'Recent start', null, null, null);
    insertSession.run('old-start-new-activity', 100, projectPath, 'Old start, new activity', null, null, null);
    insertSession.run('compression-root', 50, projectPath, 'Compression root', null, 'compression', null);
    insertSession.run('ordinary-branch-child', 60, projectPath, 'Ordinary branch', 'compression-root', null, JSON.stringify({ _branched_from: 'compression-root' }));
    insertSession.run('tool-group', 40, projectPath, 'Tool group', null, null, null);
    insertSession.run('removed-cwd', 300, missingPath, 'Removed cwd', null, null, null);
    insertSession.run('rewind-unread', 30, projectPath, 'Rewind unread', null, null, null);
    db.prepare(`
      INSERT INTO sessions (id, source, started_at, cwd, git_repo_root, title)
      VALUES ('fallback-path', 'cli', 25, ?, ?, NULL)
    `).run(projectPath, missingPath);
    insertSession.run('echo-root', 20, projectPath, 'Echo root', null, 'compression', null);
    insertSession.run('echo-tip', 21, projectPath, null, 'echo-root', null, null);
    insertSession.run('oversized', 15, projectPath, 'Oversized', null, null, null);
    insertSession.run('page-budget', 14, projectPath, 'Page budget', null, null, null);

    const insertMessage = db.prepare(`
      INSERT INTO messages (session_id, role, content, timestamp, tool_call_id, tool_calls, tool_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertMessage.run('recent-start', 'user', 'started recently', 200, null, null, null);
    insertMessage.run('old-start-new-activity', 'user', 'active most recently', 999, null, null, null);
    insertMessage.run('compression-root', 'user', 'root only', 50, null, null, null);
    insertMessage.run('ordinary-branch-child', 'user', 'branch only', 60, null, null, null);
    insertMessage.run('tool-group', 'user', 'before tools', 1, null, null, null);
    insertMessage.run('tool-group', 'assistant', '', 2, null, JSON.stringify([
      { id: 'call-a', function: { name: 'terminal', arguments: '{"cmd":"a"}' } },
      { id: 'call-b', function: { name: 'terminal', arguments: '{"cmd":"b"}' } },
    ]), null);
    insertMessage.run('tool-group', 'tool', 'result a', 3, 'call-a', null, 'terminal');
    insertMessage.run('tool-group', 'tool', 'result b', 4, 'call-b', null, 'terminal');
    insertMessage.run('removed-cwd', 'user', 'history from removed cwd', 300, null, null, null);
    insertMessage.run('fallback-path', 'user', 'First visible user title', 25, null, null, null);
    insertMessage.run('echo-root', 'user', 'compression replay echo', 20, null, null, null);
    insertMessage.run('echo-tip', 'user', 'compression replay echo', 21, null, null, null);
    const hugeValue = 'x'.repeat(2_000_000);
    db.prepare(`
      INSERT INTO messages (session_id, role, content, timestamp, reasoning, tool_calls)
      VALUES ('oversized', 'assistant', ?, 15, ?, ?)
    `).run(hugeValue, hugeValue, JSON.stringify([
      { id: 'huge-call', function: { name: 'terminal', arguments: JSON.stringify({ value: hugeValue }) } },
    ]));
    insertMessage.run('oversized', 'tool', hugeValue, 16, 'huge-call', null, 'terminal');
    for (let index = 0; index < 20; index += 1) {
      insertMessage.run('page-budget', 'assistant', `${index}:${'p'.repeat(40_000)}`, 30 + index, null, null, null);
    }
    const insertRewind = db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)');
    for (let index = 0; index < 120; index += 1) {
      insertRewind.run('rewind-unread', 'user', `rewind-${index}`, 10 + index);
    }

    const homes = [{ scope: 'default', dbPath }];
    const listed = await listHermesSessionsForProject(projectPath, { homes });
    const listedIds = listed.sessions.map((session) => session.providerSessionId);
    assert.ok(listedIds.indexOf('old-start-new-activity') < listedIds.indexOf('recent-start'));
    assert.ok(listedIds.includes('compression-root'));
    assert.ok(listedIds.includes('ordinary-branch-child'));
    assert.equal(listedIds.includes('removed-cwd'), false);
    const fallbackPathSession = listed.sessions.find((session) => session.providerSessionId === 'fallback-path');
    assert.equal(fallbackPathSession?.projectPath, projectPath);
    assert.equal(fallbackPathSession?.title, 'First visible user title');
    const activityLimited = await listHermesSessionsForProject(projectPath, { homes, limit: 1 });
    assert.equal(activityLimited.sessions[0].providerSessionId, 'old-start-new-activity');

    const unscoped = await listUnscopedHermesSessions({ homes });
    assert.ok(unscoped.sessions.some((session) => session.providerSessionId === 'removed-cwd'));
    assert.equal(unscoped.sessions.some((session) => session.providerSessionId === 'fallback-path'), false);
    const removedHistory = await getHermesSessionMessages(
      { providerScope: 'default', providerSessionId: 'removed-cwd' },
      { homes },
    );
    assert.match(JSON.stringify(removedHistory.messages), /history from removed cwd/);

    const compressionRootHistory = await getHermesSessionMessages(
      { providerScope: 'default', providerSessionId: 'compression-root' },
      { homes },
    );
    const ordinaryBranchHistory = await getHermesSessionMessages(
      { providerScope: 'default', providerSessionId: 'ordinary-branch-child' },
      { homes },
    );
    assert.match(JSON.stringify(compressionRootHistory.messages), /root only/);
    assert.doesNotMatch(JSON.stringify(compressionRootHistory.messages), /branch only/);
    assert.match(JSON.stringify(ordinaryBranchHistory.messages), /branch only/);
    assert.doesNotMatch(JSON.stringify(ordinaryBranchHistory.messages), /root only/);

    const echoHistory = await getHermesSessionMessages(
      { providerScope: 'default', providerSessionId: 'echo-tip' },
      { homes, limit: 1 },
    );
    assert.equal(echoHistory.messages.filter((message) => JSON.stringify(message).includes('compression replay echo')).length, 1);
    assert.equal(echoHistory.messages[0]?.timestamp, new Date(20_000).toISOString());

    const oversizedHistory = await getHermesSessionMessages(
      { providerScope: 'default', providerSessionId: 'oversized' },
      { homes, limit: 10 },
    );
    const oversizedSerialized = JSON.stringify(oversizedHistory.messages);
    assert.ok(Buffer.byteLength(oversizedSerialized, 'utf8') <= HERMES_HISTORY_MAX_PAGE_BYTES);
    assert.match(oversizedSerialized, /truncated/i);
    assert.equal(oversizedSerialized.includes(hugeValue), false);

    const budgetPage = await getHermesSessionMessages(
      { providerScope: 'default', providerSessionId: 'page-budget' },
      { homes, limit: 50 },
    );
    assert.ok(Buffer.byteLength(JSON.stringify(budgetPage.messages), 'utf8') <= HERMES_HISTORY_MAX_PAGE_BYTES);
    assert.ok(Buffer.byteLength(JSON.stringify(budgetPage), 'utf8') <= HERMES_HISTORY_MAX_PAGE_BYTES);
    assert.equal(budgetPage.hasMore, true);
    assert.ok(budgetPage.nextCursor);

    const toolPage = await getHermesSessionMessages(
      { providerScope: 'default', providerSessionId: 'tool-group' },
      { homes, limit: 1 },
    );
    const toolUses = new Set(toolPage.messages.filter((message) => message.type === 'tool_use').map((message) => message.toolCallId));
    const toolResults = toolPage.messages.filter((message) => message.type === 'tool_result').map((message) => message.toolCallId);
    assert.deepEqual([...toolUses].sort(), ['call-a', 'call-b']);
    assert.deepEqual(toolResults.sort(), ['call-a', 'call-b']);
    assert.ok(toolResults.every((toolCallId) => toolUses.has(toolCallId)));
    assert.equal(toolPage.hasMore, true);
    const olderToolPage = await getHermesSessionMessages(
      { providerScope: 'default', providerSessionId: 'tool-group' },
      { homes, limit: 1, cursor: toolPage.nextCursor },
    );
    assert.match(JSON.stringify(olderToolPage.messages), /before tools/);
    assert.equal(olderToolPage.messages.some((message) => message.type === 'tool_result'), false);

    const rewindFirst = await getHermesSessionMessages(
      { providerScope: 'default', providerSessionId: 'rewind-unread' },
      { homes, limit: 50 },
    );
    const oldestReadId = Number(String(rewindFirst.messages[0].messageKey).split(':').at(-2));
    db.prepare('UPDATE messages SET active = 0 WHERE session_id = ? AND id < ?').run('rewind-unread', oldestReadId);
    const rewindSecond = await getHermesSessionMessages(
      { providerScope: 'default', providerSessionId: 'rewind-unread' },
      { homes, limit: 50, cursor: rewindFirst.nextCursor },
    );
    assert.equal(rewindSecond.messages.length, 0);
    assert.equal(rewindSecond.hasMore, false);
    assert.equal(rewindSecond.nextCursor, null);
    assert.equal(rewindSecond.total, 120);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Hermes history cursors retain all history when tool-result links are outside the page budget', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-hermes-tool-cursor-'));
  const projectPath = path.join(root, 'project');
  const dbPath = path.join(root, 'state.db');
  await fs.mkdir(projectPath);
  const db = createListDb(dbPath);
  try {
    const homes = [{ scope: 'default', dbPath }];
    const historyRows = 40;
    const padding = 'h'.repeat(16 * 1024);
    const insertSession = db.prepare('INSERT INTO sessions (id, source, started_at, cwd, title) VALUES (?, ?, ?, ?, ?)');
    const insertMessage = db.prepare(`
      INSERT INTO messages (session_id, role, content, timestamp, tool_call_id, tool_calls, tool_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertSession.run('orphan-tool', 'cli', 1, projectPath, 'Orphan tool result');
    insertSession.run('remote-tool', 'cli', 2, projectPath, 'Remote tool result');
    for (let index = 0; index < historyRows; index += 1) {
      insertMessage.run('orphan-tool', 'assistant', `orphan-${index}:${padding}`, index + 1, null, null, null);
    }
    insertMessage.run('orphan-tool', 'tool', 'ORPHAN_RESULT_MUST_NOT_RENDER', historyRows + 1, 'never-declared', null, 'terminal');

    insertMessage.run('remote-tool', 'assistant', 'remote-call-origin', 1000, null, JSON.stringify([
      { id: 'far-call', function: { name: 'terminal', arguments: '{"cmd":"pwd"}' } },
    ]), null);
    for (let index = 0; index < historyRows; index += 1) {
      insertMessage.run('remote-tool', 'assistant', `remote-${index}:${padding}`, 1001 + index, null, null, null);
    }
    insertMessage.run('remote-tool', 'tool', 'REMOTE_RESULT_MUST_NOT_RENDER', 2000, 'far-call', null, 'terminal');

    const readAllPages = async (providerSessionId: string) => {
      let cursor: string | null = null;
      let pageCount = 0;
      const messages: any[] = [];
      const messageKeys = new Set<string>();
      let firstPage: any = null;
      do {
        const page = await getHermesSessionMessages(
          { providerScope: 'default', providerSessionId },
          { homes, limit: 1, cursor },
        );
        if (!firstPage) firstPage = page;
        assert.ok(Buffer.byteLength(JSON.stringify(page), 'utf8') <= HERMES_HISTORY_MAX_PAGE_BYTES);
        for (const message of page.messages) {
          assert.equal(messageKeys.has(message.messageKey), false, `duplicated message key ${message.messageKey}`);
          messageKeys.add(message.messageKey);
          messages.push(message);
        }
        if (page.hasMore) assert.ok(page.nextCursor, 'a non-terminal page must provide a cursor');
        else assert.equal(page.nextCursor, null);
        cursor = page.nextCursor;
        pageCount += 1;
        assert.ok(pageCount <= historyRows + 2, 'cursor must make forward progress');
      } while (cursor);
      return { firstPage, messages, pageCount };
    };

    const orphan = await readAllPages('orphan-tool');
    const orphanSerialized = JSON.stringify(orphan.messages);
    assert.ok(orphan.firstPage.hasMore);
    assert.ok(orphan.firstPage.nextCursor);
    assert.match(orphanSerialized, /matching tool call is unavailable within this page budget/);
    assert.doesNotMatch(orphanSerialized, /ORPHAN_RESULT_MUST_NOT_RENDER/);
    assert.equal(orphan.messages.some((message) => message.type === 'tool_result'), false);
    for (let index = 0; index < historyRows; index += 1) {
      assert.match(orphanSerialized, new RegExp(`orphan-${index}:`));
    }

    const remote = await readAllPages('remote-tool');
    const remoteSerialized = JSON.stringify(remote.messages);
    assert.ok(remote.firstPage.hasMore);
    assert.ok(remote.firstPage.nextCursor);
    assert.match(remoteSerialized, /matching tool call is unavailable within this page budget/);
    assert.match(remoteSerialized, /remote-call-origin/);
    assert.doesNotMatch(remoteSerialized, /REMOTE_RESULT_MUST_NOT_RENDER/);
    const remoteToolUses = new Set(remote.messages.filter((message) => message.type === 'tool_use').map((message) => message.toolCallId));
    const remoteToolResults = remote.messages.filter((message) => message.type === 'tool_result').map((message) => message.toolCallId);
    assert.ok(remoteToolResults.every((toolCallId) => remoteToolUses.has(toolCallId)));
    for (let index = 0; index < historyRows; index += 1) {
      assert.match(remoteSerialized, new RegExp(`remote-${index}:`));
    }
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Hermes scoped identity round-trips delimiter, percent, and Unicode through the production HTTP handler', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-hermes-identity-'));
  const projectPath = path.join(root, 'project');
  const scope = 'team~蓝%';
  const rawSessionId = 'session~会话%';
  const profilePath = path.join(root, 'profiles', scope);
  await Promise.all([fs.mkdir(projectPath), fs.mkdir(profilePath, { recursive: true })]);
  const db = createListDb(path.join(profilePath, 'state.db'));
  const previousHome = process.env.HERMES_HOME;
  try {
    db.prepare('INSERT INTO sessions (id, source, started_at, cwd, title) VALUES (?, ?, ?, ?, ?)')
      .run(rawSessionId, 'cli', 1, projectPath, 'Scoped identity');
    db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)')
      .run(rawSessionId, 'user', 'scoped identity history', 1);
    process.env.HERMES_HOME = root;

    const listed = await listHermesSessionsForProject(projectPath);
    const session = listed.sessions.find((candidate) => candidate.providerSessionId === rawSessionId);
    assert.ok(session);
    assert.equal(session.id, encodeHermesScopedId(scope, rawSessionId));
    assert.equal((String(session.id).match(/~/g) || []).length, 1);
    assert.deepEqual(decodeHermesScopedId(session.id), { providerScope: scope, providerSessionId: rawSessionId });

    const response = {
      statusCode: 200,
      payload: null as any,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: any) { this.payload = payload; return this; },
    };
    await handleGetSessionMessages({
      params: { projectName: 'project', sessionId: session.id },
      query: { provider: 'hermes', limit: '10' },
    }, response);
    assert.equal(response.statusCode, 200);
    assert.match(JSON.stringify(response.payload), /scoped identity history/);
  } finally {
    if (previousHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = previousHome;
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
