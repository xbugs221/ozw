// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify missing-path project archival behavior for project discovery.
 * This test suite checks archival decisions, project list filtering, and
 * non-destructive handling of existing history files.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  clearProjectDirectoryCache,
  createDefaultProjectArchiveIndex,
  evaluateProjectArchival,
  getProjectArchiveFilePath,
  getProjects,
  loadProjectArchiveIndex,
} from '../../backend/projects.ts';

/**
 * Run a test body with an isolated HOME directory and restore original env.
 */
async function withTemporaryHome(testBody) {
  const originalHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-archive-test-'));

  process.env.HOME = tempHome;
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

    await fs.rm(tempHome, { recursive: true, force: true });
  }
}

/**
 * Create a configured manual project entry with a specific source path.
 */
async function createManualProjectConfig(homeDir, projectPath) {
  const ozwDir = path.join(homeDir, '.local', 'state', 'ozw');
  const projectName = projectPath.replace(/[\\/:\s~_]/g, '-');

  await fs.mkdir(ozwDir, { recursive: true });
  await fs.writeFile(
    path.join(ozwDir, 'conf.json'),
    JSON.stringify({
      [projectName]: {
        manuallyAdded: true,
        originalPath: projectPath,
        displayName: 'Missing Project',
      },
    }, null, 2),
    'utf8'
  );
}

/**
 * Create a minimal Codex session JSONL file for a given project path.
 */
async function createCodexSessionFile(homeDir, projectPath, sessionId) {
  const sessionDir = path.join(homeDir, '.codex', 'sessions', '2026', '03', '05');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-03-05T08:00:00.000Z',
        payload: {
          id: sessionId,
          cwd: projectPath,
          model: 'gpt-5',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-03-05T08:01:00.000Z',
        payload: {
          type: 'user_message',
          message: 'hello',
        },
      }),
    ].join('\n') + '\n',
    'utf8'
  );

  return sessionPath;
}

/**
 * Create a minimal Claude session file so project discovery can resolve cwd.
 */
async function createClaudeSessionFile(homeDir, projectPath, sessionId) {
  const projectName = projectPath.replace(/[\\/:\s~_]/g, '-');
  const projectDir = path.join(homeDir, '.claude', 'projects', projectName);
  const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);

  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        parentUuid: null,
        type: 'user',
        message: {
          role: 'user',
          content: 'hello fixture-project',
        },
        uuid: 'root-user-message',
        timestamp: '2026-03-15T08:00:00.000Z',
        cwd: projectPath,
        sessionId,
      }),
      JSON.stringify({
        parentUuid: 'root-user-message',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'hi',
            },
          ],
        },
        uuid: 'assistant-message',
        timestamp: '2026-03-15T08:01:00.000Z',
        cwd: projectPath,
        sessionId,
      }),
    ].join('\n') + '\n',
    'utf8'
  );
}

/**
 * Persist an archive record for a project path.
 */
async function createArchiveEntry(homeDir, projectPath, source = 'claude') {
  const archiveDir = path.join(homeDir, '.claude');
  const normalizedPath = path.resolve(projectPath);

  await fs.mkdir(archiveDir, { recursive: true });
  await fs.writeFile(
    path.join(archiveDir, 'project-archive.json'),
    JSON.stringify({
      version: 1,
      archivedProjects: {
        [normalizedPath]: {
          normalizedPath,
          path: projectPath,
          source,
          reason: 'path-missing',
          archivedAt: '2026-03-12T08:49:54.253Z',
          lastCheckedAt: '2026-03-12T08:49:54.253Z',
          errorCode: 'ENOENT',
        },
      },
    }, null, 2),
    'utf8'
  );
}

test('evaluateProjectArchival archives ENOENT paths and excludes project', async () => {
  const archiveIndex = createDefaultProjectArchiveIndex();
  const now = new Date('2026-03-05T00:00:00.000Z');

  const result = await evaluateProjectArchival({
    projectPath: '/tmp/ozw-missing-project',
    source: 'manual',
    archiveIndex,
    options: {
      now,
      access: async () => {
        const error = new Error('missing path');
        error.code = 'ENOENT';
        throw error;
      },
    },
  });

  assert.equal(result.excludeFromList, true);
  assert.equal(result.archiveUpdated, true);
  assert.ok(result.normalizedPath.length > 0);

  const archivedRecord = archiveIndex.archivedProjects[result.normalizedPath];
  assert.ok(archivedRecord);
  assert.equal(archivedRecord.reason, 'path-missing');
  assert.equal(archivedRecord.source, 'manual');
  assert.equal(archivedRecord.archivedAt, '2026-03-05T00:00:00.000Z');
});

test('evaluateProjectArchival does not archive permission errors', async () => {
  const archiveIndex = createDefaultProjectArchiveIndex();

  const result = await evaluateProjectArchival({
    projectPath: '/tmp/ozw-permission-denied',
    source: 'claude',
    archiveIndex,
    options: {
      access: async () => {
        const error = new Error('permission denied');
        error.code = 'EACCES';
        throw error;
      },
    },
  });

  assert.equal(result.excludeFromList, false);
  assert.equal(result.archiveUpdated, false);
  assert.equal(Object.keys(archiveIndex.archivedProjects).length, 0);
});

test('evaluateProjectArchival clears stale archive when project path exists again', async () => {
  const archiveIndex = createDefaultProjectArchiveIndex();
  const projectPath = '/tmp/ozw-restored-project';

  archiveIndex.archivedProjects[path.resolve(projectPath)] = {
    normalizedPath: path.resolve(projectPath),
    path: projectPath,
    source: 'claude',
    reason: 'path-missing',
    archivedAt: '2026-03-12T08:49:54.253Z',
    lastCheckedAt: '2026-03-12T08:49:54.253Z',
    errorCode: 'ENOENT',
  };

  const result = await evaluateProjectArchival({
    projectPath,
    source: 'claude',
    archiveIndex,
    options: {
      access: async () => {},
    },
  });

  assert.equal(result.excludeFromList, false);
  assert.equal(result.archiveUpdated, true);
  assert.equal(result.reason, 'archive-cleared-path-exists');
  assert.equal(Object.keys(archiveIndex.archivedProjects).length, 0);
});

test('getProjects archives missing manual project and omits it from active list', async () => {
  await withTemporaryHome(async (tempHome) => {
    const missingPath = path.join(tempHome, 'workspace', 'missing-project');
    await createManualProjectConfig(tempHome, missingPath);

    const projects = await getProjects();
    assert.deepEqual(projects, []);

    const archivePath = getProjectArchiveFilePath(tempHome);
    const archiveStat = await fs.stat(archivePath);
    assert.ok(archiveStat.isFile());

    const archiveIndex = await loadProjectArchiveIndex({ homeDir: tempHome });
    const archiveEntries = Object.values(archiveIndex.archivedProjects);
    assert.equal(archiveEntries.length, 1);
    assert.equal(archiveEntries[0].path, missingPath);
    assert.equal(archiveEntries[0].reason, 'path-missing');
    assert.equal(archiveEntries[0].source, 'manual');
  });
});

test('getProjects archival keeps Codex history files on disk', async () => {
  await withTemporaryHome(async (tempHome) => {
    const missingPath = path.join(tempHome, 'workspace', 'missing-codex-project');
    const sessionFilePath = await createCodexSessionFile(tempHome, missingPath, 'codex-session-1');

    const projects = await getProjects();
    assert.equal(projects.length, 0);

    const sessionFileStat = await fs.stat(sessionFilePath);
    assert.ok(sessionFileStat.isFile());

    const archiveIndex = await loadProjectArchiveIndex({ homeDir: tempHome });
    const archiveEntries = Object.values(archiveIndex.archivedProjects);
    assert.equal(archiveEntries.length, 1);
    assert.equal(archiveEntries[0].path, missingPath);
    assert.equal(archiveEntries[0].source, 'codex');
    assert.equal(archiveEntries[0].reason, 'path-missing');
  });
});

test('getProjects re-includes restored Codex project and clears stale archive entry', async () => {
  await withTemporaryHome(async (tempHome) => {
    const restoredPath = path.join(tempHome, 'workspace', 'fixture-project');
    await fs.mkdir(restoredPath, { recursive: true });
    await createCodexSessionFile(tempHome, restoredPath, 'codex-session-1');
    await createArchiveEntry(tempHome, restoredPath, 'codex');

    const projects = await getProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].fullPath, restoredPath);
    assert.equal(projects[0].codexSessions?.[0]?.id, 'codex-session-1');

    const archiveIndex = await loadProjectArchiveIndex({ homeDir: tempHome });
    assert.equal(Object.keys(archiveIndex.archivedProjects).length, 0);
  });
});
