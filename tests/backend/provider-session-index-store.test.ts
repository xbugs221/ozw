// @ts-nocheck -- better-sqlite3 runtime fixtures keep migration assertions compact.
/**
 * PURPOSE: Verify the provider session SQLite read model persists session
 * ownership metadata used by project overview manual-session filtering.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { providerSessionIndexDb } from '../../backend/provider-session-index-store.ts';

/**
 * Create the pre-origin provider index schema used by existing installations.
 */
function createLegacyProviderSessionIndex(db) {
  /**
   * PURPOSE: Exercise the store's self-healing migration path instead of only
   * testing freshly initialized databases.
   */
  db.exec(`
    CREATE TABLE provider_session_index (
      provider TEXT NOT NULL,
      session_id TEXT NOT NULL,
      source_session_id TEXT,
      project_path TEXT NOT NULL,
      normalized_project_path TEXT NOT NULL,
      summary TEXT,
      title TEXT,
      model TEXT,
      thread TEXT,
      session_file_name TEXT,
      file_path TEXT NOT NULL,
      created_at TEXT,
      last_activity TEXT NOT NULL,
      message_count INTEGER,
      message_count_known INTEGER DEFAULT 0,
      file_mtime_ms REAL DEFAULT 0,
      indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, session_id)
    );
  `);
}

test('provider session index migrates old rows and persists workflow origin', () => {
  const db = new Database(':memory:');
  try {
    createLegacyProviderSessionIndex(db);

    providerSessionIndexDb.upsert(db, {
      provider: 'pi',
      id: 'pi-workflow-child',
      origin: 'workflow',
      projectPath: '/tmp/ozw-provider-index-origin',
      title: 'workflow state owned session',
      routeTitle: 'workflow state',
      filePath: '/tmp/pi-workflow-child.jsonl',
      createdAt: '2026-06-13T01:00:00.000Z',
      lastActivity: '2026-06-13T01:00:01.000Z',
    });

    const columns = db.prepare('PRAGMA table_info(provider_session_index)').all();
    assert.equal(columns.some((column) => column.name === 'origin'), true);
    assert.equal(columns.some((column) => column.name === 'route_title'), true);

    const sessions = providerSessionIndexDb.listForProject(db, 'pi', '/tmp/ozw-provider-index-origin', 10);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'pi-workflow-child');
    assert.equal(sessions[0].origin, 'workflow');
    assert.equal(sessions[0].routeTitle, 'workflow state');

    providerSessionIndexDb.upsert(db, {
      provider: 'pi',
      id: 'pi-workflow-child',
      projectPath: '/tmp/ozw-provider-index-origin',
      title: 'workflow state owned session',
      filePath: '/tmp/pi-workflow-child.jsonl',
      createdAt: '2026-06-13T01:00:00.000Z',
      lastActivity: '2026-06-13T01:00:02.000Z',
    });

    const updatedSessions = providerSessionIndexDb.listForProject(db, 'pi', '/tmp/ozw-provider-index-origin', 10);
    assert.equal(updatedSessions[0].origin, 'workflow');
  } finally {
    db.close();
  }
});

test('provider session index ignores unknown origin labels', () => {
  const db = new Database(':memory:');
  try {
    providerSessionIndexDb.upsert(db, {
      provider: 'codex',
      id: 'codex-provider-session',
      origin: 'external',
      projectPath: '/tmp/ozw-provider-index-origin',
      title: 'ordinary provider session',
      filePath: '/tmp/codex-provider-session.jsonl',
      createdAt: '2026-06-13T02:00:00.000Z',
      lastActivity: '2026-06-13T02:00:01.000Z',
    });

    const sessions = providerSessionIndexDb.listForProject(db, 'codex', '/tmp/ozw-provider-index-origin', 10);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].origin, undefined);
  } finally {
    db.close();
  }
});

test('provider session index locates Claude transcript by session identity', () => {
  /** PURPOSE: Keep explicit Claude history requests off recursive HOME scans. */
  const db = new Database(':memory:');
  try {
    providerSessionIndexDb.upsert(db, {
      provider: 'claude',
      id: 'claude-indexed-session',
      projectPath: '/tmp/ozw-claude-indexed-project',
      title: 'indexed Claude session',
      filePath: '/tmp/claude-indexed-session.jsonl',
      createdAt: '2026-07-18T02:00:00.000Z',
      lastActivity: '2026-07-18T02:00:01.000Z',
    });

    assert.equal(
      providerSessionIndexDb.getFilePath(db, 'claude', 'claude-indexed-session'),
      '/tmp/claude-indexed-session.jsonl',
    );
    assert.equal(providerSessionIndexDb.getFilePath(db, 'claude', 'missing-session'), '');
  } finally {
    db.close();
  }
});
