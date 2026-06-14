/**
 * PURPOSE: Verify live provider sessions are surfaced in project discovery before history files are persisted.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Build an isolated HOME directory for project discovery tests.
 * @returns {Promise<string>} Temporary HOME path.
 */
async function createTempHome() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ozw-active-sessions-'));
}

test('getProjects ignores live Claude SDK sessions after provider removal', { concurrency: false }, async () => {
  const originalHome = process.env.HOME;
  const tempHome = await createTempHome();
  process.env.HOME = tempHome;

  const liveProjectPath = path.join(tempHome, 'workspace', 'live-claude-project');
  await fs.mkdir(liveProjectPath, { recursive: true });

  try {
    const { getProjects } = await import(`../../backend/projects.js?test=${Date.now()}`);
    const projects = await getProjects();

    assert.equal(projects.length, 0, 'Claude live sessions should no longer create projects');
  } finally {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
  }
});

test('getSessions returns an empty result when the Claude project history directory is missing', { concurrency: false }, async () => {
  const originalHome = process.env.HOME;
  const tempHome = await createTempHome();
  process.env.HOME = tempHome;

  try {
    const { getSessions } = await import(`../../backend/projects.js?test=${Date.now()}`);
    const result = await getSessions('missing-project-directory', 5, 0, { includeHidden: true });

    assert.deepEqual(result, {
      sessions: [],
      hasMore: false,
      total: 0,
      offset: 0,
      limit: 5,
    });
  } finally {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
  }
});
