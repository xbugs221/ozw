// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify project display-name persistence behavior for rename flows.
 * This suite covers path-keyed custom names, legacy compatibility, and fallback naming.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addProjectManually,
  clearProjectDirectoryCache,
  getProjects,
  loadProjectConfig,
  renameProject,
  saveProjectConfig,
} from '../../backend/projects.ts';

let homeIsolationQueue = Promise.resolve();

/**
 * Execute each test case under an isolated HOME directory.
 */
async function withTemporaryHome(testBody) {
  const run = async () => {
    const originalHome = process.env.HOME;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-rename-test-'));

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
  };

  const runPromise = homeIsolationQueue.then(run, run);
  homeIsolationQueue = runPromise.catch(() => {});
  return runPromise;
}

/**
 * Create a minimal Codex session JSONL file with a session_meta record.
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
}

test('Codex-only project rename survives refresh using path-keyed display names', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-demo');
    await fs.mkdir(projectPath, { recursive: true });
    await createCodexSessionFile(tempHome, projectPath, 'codex-session-1');

    const initialProjects = await getProjects();
    assert.equal(initialProjects.length, 1);

    const codexProject = initialProjects[0];
    await renameProject(codexProject.name, 'Codex Friendly Name', codexProject.fullPath);

    const refreshedProjects = await getProjects();
    assert.equal(refreshedProjects.length, 1);
    assert.equal(refreshedProjects[0].displayName, 'Codex Friendly Name');
  });
});

test('Empty rename clears custom name but keeps manual project and falls back to auto name', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'manual-reset-demo');
    await fs.mkdir(projectPath, { recursive: true });

    const createdProject = await addProjectManually(projectPath, 'Manual Display Name');

    await renameProject(createdProject.name, '', projectPath);

    const refreshedProjects = await getProjects();
    assert.equal(refreshedProjects.length, 1);
    assert.equal(refreshedProjects[0].name, createdProject.name);
    assert.equal(refreshedProjects[0].displayName, 'manual-reset-demo');
  });
});

test('Path-keyed custom name takes precedence over legacy projectName key', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'path-priority-demo');
    await fs.mkdir(projectPath, { recursive: true });

    const createdProject = await addProjectManually(projectPath, 'Legacy Name');
    const config = await loadProjectConfig();

    config[createdProject.name].displayName = 'Legacy Name';
    config.displayNameByPath = {
      ...(config.displayNameByPath || {}),
      [path.resolve(projectPath)]: 'Path Priority Name',
    };

    await saveProjectConfig(config);

    const refreshedProjects = await getProjects();
    assert.equal(refreshedProjects.length, 1);
    assert.equal(refreshedProjects[0].displayName, 'Path Priority Name');
  });
});
