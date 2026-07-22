// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify Pi sessions read model: piSessions in project payload,
 * session collection, and route index assignment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  clearProjectDirectoryCache,
  createManualSessionDraft,
  finalizeManualSessionRoute,
  getManualSessionRouteRuntime,
  getPiSessions,
  loadProjectConfig,
  searchChatHistory,
  updateSessionUiState,
  saveProjectConfig,
  initManualSessionRoute,
  bindManualSessionProvider,
} from '../../backend/projects.ts';

// Helper: create a temporary project directory with a .ozw config
async function setupTempProject(label) {
  const dir = path.join(os.tmpdir(), `ozw-pi-sessions-${label}-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Write a minimal Pi JSONL transcript that the real Pi index can discover.
 */
async function writePiSessionFile(homeDir, projectPath, sessionId, firstUserMessage) {
  const sessionDir = path.join(homeDir, '.pi', 'agent', 'sessions', '2026', '05', '26');
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: 'session',
        id: sessionId,
        cwd: projectPath,
        timestamp: '2026-05-26T01:00:00.000Z',
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-05-26T01:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: firstUserMessage }],
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

test('Empty Pi manual draft is kept in config but hidden from piSessions', async () => {
  const projectPath = await setupTempProject('draft');
  const projectName = projectPath.replace(/\//g, '-');

  try {
    // Create a Pi manual session draft
    const result = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi 测试会话');

    assert.ok(result.id);
    assert.match(result.id, /^c\d+$/);

    const config = await loadProjectConfig(projectPath);
    const routeEntry = Object.entries(config.chat || {}).find(
      ([, record]) => record?.sessionId === result.id,
    );
    assert.ok(routeEntry, 'Route entry should exist so the current draft route can resolve');

    // Verify an untouched empty draft does not occupy the project overview list.
    const piSessions = await getPiSessions(projectPath, { includeHidden: true });
    const found = piSessions.find((s) => s.id === result.id);
    assert.equal(found, undefined);

    // Cleanup handled by fs.rm in finally block
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('Pi session draft stores provider=pi in project config', async () => {
  const projectPath = await setupTempProject('config');
  const projectName = projectPath.replace(/\//g, '-');

  try {
    const result = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi 配置会话');

    const config = await loadProjectConfig(projectPath);
    const routeEntry = Object.entries(config.chat || {}).find(
      ([, record]) => record?.sessionId === result.id,
    );
    assert.ok(routeEntry, 'Route entry should exist in config.chat');
    const [, record] = routeEntry;
    assert.equal(record.provider, 'pi');
    assert.equal(record.sessionId, result.id);

    // Cleanup handled by fs.rm in finally block
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('Unknown provider still rejected for manual draft creation', async () => {
  const projectPath = await setupTempProject('unknown');
  const projectName = projectPath.replace(/\//g, '-');

  try {
    await assert.rejects(
      createManualSessionDraft(projectName, projectPath, 'unknown', '未知 Provider 会话'),
      /provider must be/,
    );
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('Bound Pi manual drafts are sorted by creation time in piSessions', async () => {
  const projectPath = await setupTempProject('sort');
  const projectName = projectPath.replace(/\//g, '-');
  const draftIds = [];

  try {
    // Create two Pi drafts
    for (const label of ['第一个 Pi 会话', '第二个 Pi 会话']) {
      const result = await createManualSessionDraft(projectName, projectPath, 'pi', label);
      draftIds.push(result.id);
      const config = await loadProjectConfig(projectPath);
      const routeEntry = Object.entries(config.chat || {}).find(
        ([, record]) => record?.sessionId === result.id,
      );
      assert.ok(routeEntry, 'Route entry should exist before marking the draft started');
      const [routeIndex, record] = routeEntry;
      config.chat[routeIndex] = {
        ...record,
        providerSessionId: `pi-provider-${result.id}`,
      };
      await saveProjectConfig(config, projectPath);
      // Small delay to ensure different creation times
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const piSessions = await getPiSessions(projectPath, { includeHidden: true });
    const ourSessions = piSessions.filter((s) => draftIds.includes(s.id));

    // Should find both sessions; newest first by creation time
    assert.equal(ourSessions.length, 2);

    // Cleanup handled by fs.rm in finally block
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('Pi session activity uses transcript timestamp instead of file mtime', async () => {
  const previousHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-time-home-'));
  const projectPath = path.join(tempHome, 'workspace', 'pi-time');
  const oldActivity = '2026-05-26T01:00:01.000Z';

  process.env.HOME = tempHome;
  clearProjectDirectoryCache();
  try {
    await fs.mkdir(projectPath, { recursive: true });
    await writePiSessionFile(tempHome, projectPath, 'pi-old-activity', '历史 Pi 会话');

    const sessionFile = path.join(tempHome, '.pi', 'agent', 'sessions', '2026', '05', '26', 'pi-old-activity.jsonl');
    const touchedAt = new Date('2026-05-27T09:30:00.000Z');
    await fs.utimes(sessionFile, touchedAt, touchedAt);

    const piSessions = await getPiSessions(projectPath, { limit: 0, includeHidden: true });
    const session = piSessions.find((candidate) => candidate.id === 'pi-old-activity');

    assert.ok(session, 'Pi session should be discovered');
    assert.equal(session.lastActivity, oldActivity);
    assert.equal(session.updated_at, oldActivity);
  } finally {
    process.env.HOME = previousHome;
    clearProjectDirectoryCache();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('Pi cN route sessions preserve provider transcript activity time', async () => {
  const previousHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-route-time-home-'));
  const projectPath = path.join(tempHome, 'workspace', 'pi-route-time');
  const oldActivity = '2026-05-26T01:00:01.000Z';

  process.env.HOME = tempHome;
  clearProjectDirectoryCache();
  try {
    await fs.mkdir(projectPath, { recursive: true });
    await writePiSessionFile(tempHome, projectPath, 'pi-provider-route-time', '历史 Pi 路由会话');

    const config = await loadProjectConfig(projectPath);
    config.chat = {
      ...(config.chat || {}),
      7: {
        sessionId: 'pi-provider-route-time',
        title: '历史 Pi 路由会话',
        provider: 'pi',
        origin: 'manual',
      },
    };
    await saveProjectConfig(config, projectPath);

    clearProjectDirectoryCache();
    const piSessions = await getPiSessions(projectPath, {
      limit: 0,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });
    const session = piSessions.find((candidate) => candidate.providerSessionId === 'pi-provider-route-time');

    assert.ok(session, 'Pi cN route session should be recovered from config.chat');
    assert.equal(session.lastActivity, oldActivity);
    assert.equal(session.updated_at, oldActivity);
  } finally {
    process.env.HOME = previousHome;
    clearProjectDirectoryCache();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('Persisted Pi cN route with providerSessionId preserves provider transcript activity time', async () => {
  const previousHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-route-provider-id-home-'));
  const projectPath = path.join(tempHome, 'workspace', 'pi-route-provider-id-time');
  const oldActivity = '2026-05-26T01:00:01.000Z';

  process.env.HOME = tempHome;
  clearProjectDirectoryCache();
  try {
    await fs.mkdir(projectPath, { recursive: true });
    await writePiSessionFile(tempHome, projectPath, 'pi-provider-route-id-time', '历史 Pi cN 路由会话');

    const config = await loadProjectConfig(projectPath);
    config.chat = {
      ...(config.chat || {}),
      9: {
        sessionId: 'c9',
        providerSessionId: 'pi-provider-route-id-time',
        title: '历史 Pi cN 路由会话',
        provider: 'pi',
        origin: 'manual',
        updatedAt: new Date().toISOString(),
      },
    };
    await saveProjectConfig(config, projectPath);

    clearProjectDirectoryCache();
    const piSessions = await getPiSessions(projectPath, {
      limit: 0,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });
    const session = piSessions.find((candidate) => candidate.providerSessionId === 'pi-provider-route-id-time');

    assert.ok(session, 'Pi cN route session should be recovered by providerSessionId');
    assert.equal(session.id, 'c9');
    assert.equal(session.lastActivity, oldActivity);
    assert.equal(session.updated_at, oldActivity);
  } finally {
    process.env.HOME = previousHome;
    clearProjectDirectoryCache();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('Pi manual session list exposes provider JSONL regardless of ozw origin tags', async () => {
  const previousHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-origin-home-'));
  const projectPath = path.join(tempHome, 'workspace', 'pi-origin-filter');
  const projectName = projectPath.replace(/\//g, '-');

  process.env.HOME = tempHome;
  clearProjectDirectoryCache();
  try {
    await fs.mkdir(projectPath, { recursive: true });
    const draftSession = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi 会话1');
    await writePiSessionFile(tempHome, projectPath, 'pi-manual-real', '真实 Pi 手动会话');
    await finalizeManualSessionRoute(projectName, draftSession.id, 'pi-manual-real', 'pi', projectPath);
    // Sessions without ozw origin tags are legitimate CLI provider JSONL.
    await writePiSessionFile(tempHome, projectPath, 'pi-wo-clean-orphan', '提案落地：wo clean 后残留的 Pi 内部会话');
    await writePiSessionFile(tempHome, projectPath, 'pi-untagged-provider-session', '未标记 origin 的 Pi provider 会话仍可搜索');

    const config = await loadProjectConfig(projectPath);
    const manualRecord = Object.values(config.chat || {}).find((record) => record?.sessionId === 'pi-manual-real');
    assert.equal(manualRecord?.origin, 'manual');
    config.chat[99] = {
      sessionId: 'pi-auto-import-polluted',
      title: '旧索引导入污染出的 Pi 会话',
      provider: 'pi',
      titleSource: 'auto-import',
      origin: 'manual',
    };
    await saveProjectConfig(config, projectPath);
    await writePiSessionFile(tempHome, projectPath, 'pi-auto-import-polluted', '旧索引导入污染出的 Pi 会话');

    clearProjectDirectoryCache();
    const piSessions = await getPiSessions(projectPath, {
      limit: 0,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });
    const sessionIds = piSessions.map((session) => session.id);

    // Bound manual draft still visible via cN route.
    assert.equal(sessionIds.includes(draftSession.id), true);
    // CLI provider JSONL session without ozw origin tag is now visible.
    assert.equal(sessionIds.includes('pi-wo-clean-orphan'), true);
    // Untagged provider session is visible because it is not workflow-internal.
    assert.equal(sessionIds.includes('pi-untagged-provider-session'), true);
    // Auto-imported session bound to cN route is visible (not workflow).
    // When a provider session has a config.chat entry, getPiSessions renders
    // it under the cN route id, not the raw provider session id.
    assert.equal(sessionIds.some((id) => id === 'c99' || id === 'pi-auto-import-polluted'), true);

    const searchResults = await searchChatHistory('未标记 origin 的 Pi provider 会话仍可搜索');
    assert.equal(searchResults.some((result) => result.provider === 'pi' && result.sessionId === 'pi-untagged-provider-session'), true);
  } finally {
    process.env.HOME = previousHome;
    clearProjectDirectoryCache();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('Finalized Pi manual route keeps its cN route and provider binding', async () => {
  const previousHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-route-bound-home-'));
  const projectPath = path.join(tempHome, 'workspace', 'pi-route-bound');
  const projectName = projectPath.replace(/\//g, '-');

  process.env.HOME = tempHome;
  clearProjectDirectoryCache();
  try {
    await fs.mkdir(projectPath, { recursive: true });
    const draftSession = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi 三连发');
    await initManualSessionRoute(projectName, projectPath, draftSession.id, 'pi');
    await writePiSessionFile(tempHome, projectPath, 'pi-provider-real', 'pi provider message');
    await finalizeManualSessionRoute(projectName, draftSession.id, 'pi-provider-real', 'pi', projectPath);

    const piSessions = await getPiSessions(projectPath, { limit: 0, includeHidden: true });
    const routedSession = piSessions.find((session) => session.id === draftSession.id);
    assert.ok(routedSession, 'finalized Pi manual session must stay visible at its original cN route');
    assert.equal(routedSession.routeIndex, draftSession.routeIndex);
    assert.equal(routedSession.providerSessionId, 'pi-provider-real');
    assert.equal(piSessions.some((session) => session.id === 'pi-provider-real'), false);

    const runtime = await getManualSessionRouteRuntime(projectName, projectPath, draftSession.id);
    assert.equal(runtime?.provider, 'pi');
    assert.equal(runtime?.providerSessionId, 'pi-provider-real');

    const config = await loadProjectConfig(projectPath);
    const routeRecord = config.chat[String(draftSession.routeIndex)];
    assert.equal(routeRecord.sessionId, draftSession.id);
    assert.equal(routeRecord.providerSessionId, 'pi-provider-real');
  } finally {
    process.env.HOME = previousHome;
    clearProjectDirectoryCache();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('Recently finalized Pi manual route is visible before Pi index sees JSONL', async () => {
  const previousHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-route-index-lag-home-'));
  const projectPath = path.join(tempHome, 'workspace', 'pi-route-index-lag');
  const projectName = projectPath.replace(/\//g, '-');

  process.env.HOME = tempHome;
  clearProjectDirectoryCache();
  try {
    await fs.mkdir(projectPath, { recursive: true });
    const draftSession = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi 索引延迟');
    await finalizeManualSessionRoute(projectName, draftSession.id, 'pi-provider-not-indexed-yet', 'pi', projectPath);

    const piSessions = await getPiSessions(projectPath, { limit: 0, includeHidden: true });
    const routedSession = piSessions.find((session) => session.id === draftSession.id);
    assert.ok(routedSession, 'manual Pi cN route must survive immediate refresh before the provider index catches up');
    assert.equal(routedSession.providerSessionId, 'pi-provider-not-indexed-yet');

    const config = await loadProjectConfig(projectPath);
    const routeRecord = config.chat[String(draftSession.routeIndex)];
    assert.equal(routeRecord.sessionId, draftSession.id);
    assert.equal(routeRecord.providerSessionId, 'pi-provider-not-indexed-yet');
  } finally {
    process.env.HOME = previousHome;
    clearProjectDirectoryCache();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Session UI state normalization regression (review-3 finding)
// ─────────────────────────────────────────────────────────────────────────────

test('Pi session favorite/hidden/pending state is stored under pi key, not codex', async () => {
  // Use a project path without dashes to avoid extractProjectDirectory ambiguity
  const projectPath = path.join(os.tmpdir(), `ozw_pi_ui_${Date.now()}`);
  const projectName = projectPath.replace(/\//g, '-');

  try {
    await fs.mkdir(projectPath, { recursive: true });
    const result = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi UI state session');
    const sessionId = result.id;

    // Use the real projectPath directly (not via extractProjectDirectory)
    const config = await loadProjectConfig(projectPath);

    // Verify chat record has provider=pi
    const chatRecord = Object.values(config.chat || {}).find(
      (r) => r?.sessionId === sessionId,
    );
    assert.ok(chatRecord, 'chat record should exist for the pi session');
    assert.equal(chatRecord.provider, 'pi', 'chat record provider must be pi');

    // Manually set ui state on the record and save directly
    chatRecord.ui = { favorite: true, pending: true, hidden: true };
    await saveProjectConfig(config, projectPath);

    // Reload and verify
    const reloaded = await loadProjectConfig(projectPath);
    const reloadedRecord = Object.values(reloaded.chat || {}).find(
      (r) => r?.sessionId === sessionId,
    );
    assert.ok(reloadedRecord, 'chat record must exist after reload');
    assert.equal(reloadedRecord.provider, 'pi', 'provider must stay pi after reload');
    assert.equal(reloadedRecord.ui?.favorite, true, 'favorite flag must survive save/reload');
    assert.equal(reloadedRecord.ui?.pending, true, 'pending flag must survive save/reload');
    assert.equal(reloadedRecord.ui?.hidden, true, 'hidden flag must survive save/reload');

    // Verify no codex key exists for this session in legacy map
    const legacyMap = reloaded.sessionUiStateByPath || {};
    for (const key of Object.keys(legacyMap)) {
      if (key.startsWith('codex:') && key.includes(sessionId)) {
        assert.fail(`pi session ${sessionId} must not appear under codex key: ${key}`);
      }
    }
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});
