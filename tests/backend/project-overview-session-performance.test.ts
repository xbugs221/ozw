// @ts-nocheck -- Runtime-shaped provider fixtures keep the performance contract readable.
/**
 * PURPOSE: Verify project overview reads provider sessions and workflow cards
 * from synchronized DB indexes instead of scanning JSONL/state files on demand.
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
   * JSONL readers during background synchronization.
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
  const [projects, workflows, flowPaths, projectIndexSync] = await Promise.all([
    import(`../../backend/projects.ts?overviewPerf=${cacheKey}`),
    import(`../../backend/workflows.ts?overviewPerf=${cacheKey}`),
    import(`../../backend/domains/workflows/flow-runtime-paths.ts?overviewPerf=${cacheKey}`),
    import(`../../backend/domains/projects/project-index-sync-service.ts?overviewPerf=${cacheKey}`),
  ]);
  return { projects, workflows, flowPaths, projectIndexSync };
}

/**
 * Install a fake oz executable that records accidental CLI calls.
 */
async function installFakeOz(homeDir) {
  /**
   * PURPOSE: Project overview synchronization must read sealed state directly
   * and must not shell out to oz flow status/graph for card summaries.
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

/**
 * Read overview sessions while proving provider directories are not scanned.
 */
async function readSessionsWithProviderScanGuard(readSessions) {
  /**
   * PURPOSE: Turn accidental request-time provider discovery into a visible
   * test failure while allowing ordinary non-provider filesystem reads.
   */
  const originalReaddir = fs.readdir;
  let providerDirectoryScanCount = 0;
  fs.readdir = (async (...args) => {
    const target = String(args[0] || '');
    if (target.includes(`${path.sep}.codex`) || target.includes(`${path.sep}.pi${path.sep}agent${path.sep}sessions`)) {
      providerDirectoryScanCount += 1;
      return [];
    }
    return originalReaddir(...args);
  });
  try {
    const result = await readSessions();
    return { ...result, providerDirectoryScanCount };
  } finally {
    fs.readdir = originalReaddir;
  }
}

test('project overview uses synchronized DB indexes for sessions and workflows', async () => {
  await withTemporaryHome(async (homeDir) => {
    const { projects, workflows, flowPaths, projectIndexSync } = await importIsolatedRuntime();
    const { clearProjectDirectoryCache, getCodexSessions, getPiSessions } = projects;
    const {
      attachIndexedWorkflowMetadata,
      syncProjectWorkflowOverviewIndex,
    } = workflows;
    const { backfillProjectIndex } = projectIndexSync;
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

    const coldRead = await readSessionsWithProviderScanGuard(async () => ({
      codexSessions: await getCodexSessions(projectPath, {
        limit: 10,
        includeHidden: true,
        excludeWorkflowChildSessions: true,
        skipProviderScan: true,
        workflowOwnedSessionIds: new Set(['codex-overview-workflow']),
      }),
      piSessions: await getPiSessions(projectPath, {
        limit: 10,
        includeHidden: true,
        excludeWorkflowChildSessions: true,
        skipProviderScan: true,
        workflowOwnedSessionIds: new Set(['pi-overview-workflow']),
      }),
    }));
    assert.equal(coldRead.providerDirectoryScanCount, 0);
    assert.deepEqual(coldRead.codexSessions, []);
    assert.deepEqual(coldRead.piSessions, []);

    const [coldWorkflowProject] = await attachIndexedWorkflowMetadata([{
      name: 'matscigo',
      path: projectPath,
      fullPath: projectPath,
    }]);
    assert.deepEqual(coldWorkflowProject.workflows, []);

    const syncedWorkflows = await syncProjectWorkflowOverviewIndex(projectPath);
    assert.equal(syncedWorkflows.length, 1);
    await assert.rejects(fs.access(fakeOzMarkerPath));

    const [overviewProject] = await attachIndexedWorkflowMetadata([{
      name: 'matscigo',
      path: projectPath,
      fullPath: projectPath,
    }]);
    assert.equal(overviewProject.workflows.length, 1);
    assert.equal(overviewProject.workflows[0].title, 'overview-fast-workflow');
    assert.equal(overviewProject.workflows[0].stage, 'execution');
    assert.equal(
      overviewProject.workflows[0].childSessions.some((session) => session.id === 'codex-overview-workflow'),
      true,
    );

    const initialBackfill = await backfillProjectIndex();
    assert.equal(initialBackfill.providerCount, 4);

    const indexedRead = await readSessionsWithProviderScanGuard(async () => ({
      codexSessions: await getCodexSessions(projectPath, {
        limit: 10,
        includeHidden: true,
        excludeWorkflowChildSessions: true,
        skipProviderScan: true,
        workflowOwnedSessionIds: new Set(['codex-overview-workflow']),
      }),
      piSessions: await getPiSessions(projectPath, {
        limit: 10,
        includeHidden: true,
        excludeWorkflowChildSessions: true,
        skipProviderScan: true,
        workflowOwnedSessionIds: new Set(['pi-overview-workflow']),
      }),
    }));

    assert.equal(indexedRead.providerDirectoryScanCount, 0);
    assert.deepEqual(indexedRead.codexSessions.map((session) => session.id), ['codex-overview-visible']);
    assert.deepEqual(indexedRead.piSessions.map((session) => session.id), ['pi-overview-visible']);

    const db = new Database(process.env.DATABASE_PATH);
    try {
      const workflowRows = db.prepare(`
        SELECT run_id
        FROM workflow_overview_index
        WHERE normalized_project_path = ? AND visible = 1
      `).all(path.resolve(projectPath));
      assert.deepEqual(workflowRows, [{ run_id: 'run-overview-fast' }]);

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

    const newOfflineCodexPath = path.join(
      homeDir,
      '.codex',
      'sessions',
      '2026',
      '06',
      '17',
      'rollout-2026-06-17T02-00-00-codex-cli-offline-new.jsonl',
    );
    const newOfflinePiPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'matscigo', 'pi-cli-offline-new.jsonl');
    await writeJsonl(newOfflineCodexPath, [
      {
        type: 'session_meta',
        timestamp: '2026-06-17T02:00:00.000Z',
        payload: { id: 'source-codex-cli-offline-new', cwd: projectPath, model: 'gpt-5-codex' },
      },
      {
        type: 'event_msg',
        timestamp: '2026-06-17T02:00:01.000Z',
        payload: { type: 'user_message', message: 'new Codex CLI session created while ozw watcher is offline' },
      },
    ]);
    await writeJsonl(newOfflinePiPath, [
      {
        type: 'session',
        id: 'pi-cli-offline-new',
        timestamp: '2026-06-17T02:10:00.000Z',
        cwd: projectPath,
      },
      {
        type: 'message',
        timestamp: '2026-06-17T02:10:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'new Pi CLI session created while ozw watcher is offline' }],
        },
      },
    ]);

    const beforeRepairRead = await readSessionsWithProviderScanGuard(async () => ({
      codexSessions: await getCodexSessions(projectPath, {
        limit: 10,
        includeHidden: true,
        excludeWorkflowChildSessions: true,
        skipProviderScan: true,
        workflowOwnedSessionIds: new Set(['codex-overview-workflow']),
      }),
      piSessions: await getPiSessions(projectPath, {
        limit: 10,
        includeHidden: true,
        excludeWorkflowChildSessions: true,
        skipProviderScan: true,
        workflowOwnedSessionIds: new Set(['pi-overview-workflow']),
      }),
    }));
    assert.equal(beforeRepairRead.providerDirectoryScanCount, 0);
    assert.deepEqual(beforeRepairRead.codexSessions.map((session) => session.id), ['codex-overview-visible']);
    assert.deepEqual(beforeRepairRead.piSessions.map((session) => session.id), ['pi-overview-visible']);

    const repairBackfill = await backfillProjectIndex();
    assert.equal(repairBackfill.providerCount, 6);

    const repairedRead = await readSessionsWithProviderScanGuard(async () => ({
      codexSessions: await getCodexSessions(projectPath, {
        limit: 10,
        includeHidden: true,
        excludeWorkflowChildSessions: true,
        skipProviderScan: true,
        workflowOwnedSessionIds: new Set(['codex-overview-workflow']),
      }),
      piSessions: await getPiSessions(projectPath, {
        limit: 10,
        includeHidden: true,
        excludeWorkflowChildSessions: true,
        skipProviderScan: true,
        workflowOwnedSessionIds: new Set(['pi-overview-workflow']),
      }),
    }));

    assert.equal(repairedRead.providerDirectoryScanCount, 0);
    assert.deepEqual(repairedRead.codexSessions.map((session) => session.id).slice(0, 2), [
      'codex-cli-offline-new',
      'codex-overview-visible',
    ]);
    assert.deepEqual(repairedRead.piSessions.map((session) => session.id).slice(0, 2), [
      'pi-cli-offline-new',
      'pi-overview-visible',
    ]);

    await fs.rm(path.join(homeDir, '.codex'), { recursive: true, force: true });
    await fs.rm(path.join(homeDir, '.pi'), { recursive: true, force: true });
    clearProjectDirectoryCache();

    const indexedAfterFilesDeleted = await readSessionsWithProviderScanGuard(async () => ({
      codexSessions: await getCodexSessions(projectPath, {
        limit: 10,
        includeHidden: true,
        excludeWorkflowChildSessions: true,
        skipProviderScan: true,
        workflowOwnedSessionIds: new Set(['codex-overview-workflow']),
      }),
      piSessions: await getPiSessions(projectPath, {
        limit: 10,
        includeHidden: true,
        excludeWorkflowChildSessions: true,
        skipProviderScan: true,
        workflowOwnedSessionIds: new Set(['pi-overview-workflow']),
      }),
    }));

    assert.equal(indexedAfterFilesDeleted.providerDirectoryScanCount, 0);
    assert.deepEqual(indexedAfterFilesDeleted.codexSessions.map((session) => session.id), [
      'codex-cli-offline-new',
      'codex-overview-visible',
    ]);
    assert.deepEqual(indexedAfterFilesDeleted.piSessions.map((session) => session.id), [
      'pi-cli-offline-new',
      'pi-overview-visible',
    ]);
  });
});
