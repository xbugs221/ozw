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
  const originalPath = process.env.PATH;
  const originalFakeOzMarker = process.env.OZW_FAKE_OZ_MARKER;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-overview-sessions-'));

  process.env.HOME = homeDir;
  process.env.XDG_STATE_HOME = path.join(homeDir, '.local', 'state');
  process.env.DATABASE_PATH = path.join(homeDir, 'auth.db');
  try {
    await testBody(homeDir);
  } finally {
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
    if (originalPath) {
      process.env.PATH = originalPath;
    } else {
      delete process.env.PATH;
    }
    if (originalFakeOzMarker) {
      process.env.OZW_FAKE_OZ_MARKER = originalFakeOzMarker;
    } else {
      delete process.env.OZW_FAKE_OZ_MARKER;
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

/**
 * Import production modules after temporary environment variables are set.
 */
async function importIsolatedRuntime() {
  /**
   * PURPOSE: Keep DATABASE_PATH/HOME-bound modules pointed at the test's real
   * temporary filesystem instead of the developer's default database.
   */
  const cacheKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [projects, workflows, flowPaths] = await Promise.all([
    import(`../../backend/projects.ts?overviewPerf=${cacheKey}`),
    import(`../../backend/workflows.ts?overviewPerf=${cacheKey}`),
    import(`../../backend/domains/workflows/flow-runtime-paths.ts?overviewPerf=${cacheKey}`),
  ]);
  return { projects, workflows, flowPaths };
}

/**
 * Install a fake oz executable that records accidental CLI calls.
 */
async function installFakeOz(homeDir) {
  /**
   * PURPOSE: Project overview must read sealed state directly and must not
   * shell out to oz flow status/graph for card summaries.
   */
  const binDir = path.join(homeDir, 'bin');
  const markerPath = path.join(homeDir, 'fake-oz-called.txt');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'oz'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$OZW_FAKE_OZ_MARKER"\nexit 42\n',
    { mode: 0o755 },
  );
  process.env.OZW_FAKE_OZ_MARKER = markerPath;
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ''}`;
  return markerPath;
}

test('project overview reads recent provider sessions and filters workflow-owned ids', async () => {
  await withTemporaryHome(async (homeDir) => {
    const { projects, workflows, flowPaths } = await importIsolatedRuntime();
    const { clearProjectDirectoryCache, getCodexSessions, getPiSessions } = projects;
    clearProjectDirectoryCache();

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

    const fakeOzMarkerPath = await installFakeOz(homeDir);
    const workflowStatePath = flowPaths.resolveFlowRunStatePath(projectPath, 'run-overview-fast');
    await fs.mkdir(path.dirname(workflowStatePath), { recursive: true });
    await fs.writeFile(
      workflowStatePath,
      JSON.stringify({
        run_id: 'run-overview-fast',
        change_name: 'overview-fast-workflow',
        status: 'running',
        stage: 'execution',
        updated_at: '2026-06-12T03:00:00.000Z',
        stages: {
          execution: 'running',
          review_1: 'pending',
        },
        sessions: {
          'codex:executor': 'codex-overview-workflow',
          'pi:qa': 'pi-overview-workflow',
        },
        processes: [
          {
            stage: 'execution',
            role: 'executor',
            status: 'running',
            session_id: 'codex-overview-workflow',
            provider: 'codex',
          },
        ],
        paths: {
          executor_log: '.wo/runs/run-overview-fast/logs/executor.log',
        },
        workflow_config: {},
      }),
      'utf8',
    );

    const [overviewProject] = await workflows.attachWorkflowMetadata([{
      name: 'matscigo',
      path: projectPath,
      fullPath: projectPath,
    }]);
    assert.equal(overviewProject.workflows.length, 1);
    assert.equal(overviewProject.workflows[0].title, 'overview-fast-workflow');
    assert.equal(overviewProject.workflows[0].stage, 'execution');
    assert.equal(overviewProject.workflows[0].childSessions.some((session) => session.id === 'codex-overview-workflow'), true);
    await assert.rejects(fs.access(fakeOzMarkerPath));

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
