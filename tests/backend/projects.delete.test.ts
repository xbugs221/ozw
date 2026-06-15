// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify destructive project deletion is guarded by active provider sessions.
 * These tests cover Codex sessions and manual drafts before config removal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addProjectManually,
  clearProjectDirectoryCache,
  createManualSessionDraft,
  deleteProject,
  getProjects,
  isProjectEmpty,
  loadProjectConfig,
} from '../../backend/projects.ts';

let homeIsolationQueue = Promise.resolve();

/**
 * Execute test logic under an isolated HOME.
 */
async function withTemporaryHome(testBody) {
  const run = async () => {
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-project-delete-test-'));

    process.env.HOME = tempHome;
    process.env.PATH = originalPath || '';
    clearProjectDirectoryCache();

    try {
      await testBody(tempHome);
    } finally {
      clearProjectDirectoryCache();
      process.env.PATH = originalPath || '';
      restoreEnvValue('HOME', originalHome);
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  };

  const runPromise = homeIsolationQueue.then(run, run);
  homeIsolationQueue = runPromise.catch(() => {});
  return runPromise;
}

/**
 * Restore an environment variable to its prior process value.
 */
function restoreEnvValue(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

/**
 * Create a minimal Codex session JSONL file bound to a project path.
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
    'utf8',
  );

  return sessionPath;
}

/**
 * Assert delete guard errors without printing expected rejection logs.
 */
async function assertDeleteWithoutForceRejects(projectName) {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      () => deleteProject(projectName, false),
      /Cannot delete project with existing sessions/,
    );
  } finally {
    console.error = originalConsoleError;
  }
}

test('Codex-only project cannot be deleted without force', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-delete-guard');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Delete Guard');
    const sessionPath = await createCodexSessionFile(tempHome, projectPath, 'codex-delete-guard-session');

    assert.equal(await isProjectEmpty(project.name), false);
    await assertDeleteWithoutForceRejects(project.name);

    const config = await loadProjectConfig();
    assert.ok(config[project.name]);
    await assert.doesNotReject(fs.access(sessionPath));
  });
});

test('provider-only Codex project deletes by real project path instead of synthetic name', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'oz-cli-perm-codex');
    await fs.mkdir(projectPath, { recursive: true });

    const sessionPath = await createCodexSessionFile(tempHome, projectPath, 'provider-only-delete-session');
    const projectsBefore = await getProjects(null, { lightweightList: true });
    const providerOnlyProject = projectsBefore.find((project) => project.fullPath === projectPath);

    assert.ok(providerOnlyProject, 'provider-only project should be discovered from Codex JSONL cwd');
    assert.notEqual(providerOnlyProject.name, projectPath, 'provider-only route name should be synthetic');

    await deleteProject(providerOnlyProject.name, true);

    await assert.rejects(fs.access(sessionPath), /ENOENT/);
    const projectsAfter = await getProjects(null, { lightweightList: true });
    assert.equal(
      projectsAfter.some((project) => project.fullPath === projectPath),
      false,
      'deleted provider-only project should not be rediscovered from stale JSONL/index data',
    );
  });
});
