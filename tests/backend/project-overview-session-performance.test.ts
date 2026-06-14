// @ts-nocheck -- Runtime-shaped provider fixtures keep the performance contract readable.
/**
 * PURPOSE: Verify project overview session loading uses bounded single-project
 * provider reads and can reuse workflow-owned session ids without rescanning
 * workflow state for each provider.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  clearProjectDirectoryCache,
  getCodexSessions,
  getPiSessions,
} from '../../backend/projects.ts';

/**
 * Run one test body with isolated provider and ozw state roots.
 */
async function withTemporaryHome(testBody) {
  /**
   * PURPOSE: Keep provider JSONL discovery on real files without reading the
   * developer's actual Codex/Pi histories during the regression test.
   */
  const originalHome = process.env.HOME;
  const originalXdgStateHome = process.env.XDG_STATE_HOME;
  const originalDatabasePath = process.env.DATABASE_PATH;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-overview-sessions-'));

  process.env.HOME = homeDir;
  process.env.XDG_STATE_HOME = path.join(homeDir, '.local', 'state');
  process.env.DATABASE_PATH = path.join(homeDir, 'auth.db');
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
    if (originalXdgStateHome) {
      process.env.XDG_STATE_HOME = originalXdgStateHome;
    } else {
      delete process.env.XDG_STATE_HOME;
    }
    if (originalDatabasePath) {
      process.env.DATABASE_PATH = originalDatabasePath;
    } else {
      delete process.env.DATABASE_PATH;
    }
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

/**
 * Write newline-delimited JSON records and ensure the parent directory exists.
 */
async function writeJsonl(filePath, records) {
  /**
   * PURPOSE: Produce real provider transcript files that exercise production
   * JSONL readers instead of mocked session arrays.
   */
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

test('project overview reads recent provider sessions and filters workflow-owned ids', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'matscigo');
    await fs.mkdir(projectPath, { recursive: true });

    const codexSessionPath = path.join(
      homeDir,
      '.codex',
      'sessions',
      '2026',
      '06',
      '12',
      'rollout-2026-06-12T01-00-00-codex-overview-visible.jsonl',
    );
    const codexWorkflowSessionPath = path.join(
      homeDir,
      '.codex',
      'sessions',
      '2026',
      '06',
      '12',
      'rollout-2026-06-12T01-01-00-codex-overview-workflow.jsonl',
    );
    await writeJsonl(codexSessionPath, [
      {
        type: 'session_meta',
        timestamp: '2026-06-12T01:00:00.000Z',
        payload: { id: 'codex-overview-visible', cwd: projectPath, model: 'gpt-5-codex' },
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-12T01:00:01.000Z',
        payload: { type: 'user_message', message: 'visible Codex project overview session' },
      },
    ]);
    await writeJsonl(codexWorkflowSessionPath, [
      {
        type: 'session_meta',
        timestamp: '2026-06-12T01:01:00.000Z',
        payload: { id: 'codex-overview-workflow', cwd: projectPath, model: 'gpt-5-codex' },
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-12T01:01:01.000Z',
        payload: { type: 'user_message', message: 'workflow-owned Codex session' },
      },
    ]);

    const piSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'matscigo', 'pi-overview-visible.jsonl');
    const piWorkflowSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'matscigo', 'pi-overview-workflow.jsonl');
    await writeJsonl(piSessionPath, [
      {
        type: 'session',
        id: 'pi-overview-visible',
        timestamp: '2026-06-12T02:00:00.000Z',
        cwd: projectPath,
      },
      {
        type: 'message',
        timestamp: '2026-06-12T02:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'visible Pi project overview session' }],
        },
      },
    ]);
    await writeJsonl(piWorkflowSessionPath, [
      {
        type: 'session',
        id: 'pi-overview-workflow',
        timestamp: '2026-06-12T02:01:00.000Z',
        cwd: projectPath,
      },
      {
        type: 'message',
        timestamp: '2026-06-12T02:01:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'workflow-owned Pi session' }],
        },
      },
    ]);

    const codexSessions = await getCodexSessions(projectPath, {
      limit: 10,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
      preferRecentProjectScan: true,
      workflowOwnedSessionIds: new Set(['codex-overview-workflow']),
    });
    const piSessions = await getPiSessions(projectPath, {
      limit: 10,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
      preferRecentProjectScan: true,
      workflowOwnedSessionIds: new Set(['pi-overview-workflow']),
    });

    assert.deepEqual(codexSessions.map((session) => session.id), ['codex-overview-visible']);
    assert.deepEqual(piSessions.map((session) => session.id), ['pi-overview-visible']);

    const db = new Database(process.env.DATABASE_PATH);
    try {
      const rows = db.prepare(`
        SELECT provider, session_id, origin
        FROM provider_session_index
        WHERE session_id IN ('codex-overview-workflow', 'pi-overview-workflow')
        ORDER BY provider, session_id
      `).all();
      assert.deepEqual(rows, [
        { provider: 'codex', session_id: 'codex-overview-workflow', origin: 'workflow' },
        { provider: 'pi', session_id: 'pi-overview-workflow', origin: 'workflow' },
      ]);
    } finally {
      db.close();
    }

    await fs.rm(path.join(homeDir, '.codex'), { recursive: true, force: true });
    await fs.rm(path.join(homeDir, '.pi'), { recursive: true, force: true });
    clearProjectDirectoryCache();

    const indexedCodexSessions = await getCodexSessions(projectPath, {
      limit: 10,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
      preferRecentProjectScan: true,
      workflowOwnedSessionIds: new Set(['codex-overview-workflow']),
    });
    const indexedPiSessions = await getPiSessions(projectPath, {
      limit: 10,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
      preferRecentProjectScan: true,
      workflowOwnedSessionIds: new Set(['pi-overview-workflow']),
    });

    assert.deepEqual(indexedCodexSessions.map((session) => session.id), ['codex-overview-visible']);
    assert.deepEqual(indexedPiSessions.map((session) => session.providerSessionId || session.id), ['pi-overview-visible']);
  });
});
