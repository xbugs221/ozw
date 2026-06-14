/**
 * PURPOSE: Verify project discovery hides obvious Codex test leftovers while
 * keeping real duplicate-name projects distinguishable by path context.
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { __projectDiscoveryForTest } from '../../backend/projects.ts';

test('project discovery filters empty /tmp/Test.../001 projects', async () => {
  const tempProjectPath = path.join(os.tmpdir(), `TestCcflowEmptyCodexProject${Date.now()}`, '001');
  const projects = await __projectDiscoveryForTest.filterAndDisambiguateProjects([
    {
      name: 'tmp-test',
      path: tempProjectPath,
      fullPath: tempProjectPath,
      displayName: '001',
      sessions: [],
      codexSessions: [],
      opencodeSessions: [],
    },
    {
      name: 'ozw',
      path: '/home/user/projects/ozw',
      fullPath: '/home/user/projects/ozw',
      displayName: 'ozw',
      sessions: [],
      codexSessions: [{ id: 'codex-session-a' }],
      opencodeSessions: [],
    },
  ]);

  assert.deepEqual(projects.map((project) => project.fullPath), ['/home/user/projects/ozw']);
});

test('project discovery disambiguates remaining duplicate basenames without changing paths', async () => {
  const firstPath = path.join(os.tmpdir(), 'TestRealWorktreeA', '001');
  const secondPath = path.join(os.tmpdir(), 'TestRealWorktreeB', '001');
  const projects = await __projectDiscoveryForTest.filterAndDisambiguateProjects([
    {
      name: 'first',
      path: firstPath,
      fullPath: firstPath,
      routePath: '/projects/first',
      displayName: '001',
      sessions: [],
      codexSessions: [{ id: 'codex-session-a' }],
      opencodeSessions: [],
    },
    {
      name: 'second',
      path: secondPath,
      fullPath: secondPath,
      routePath: '/projects/second',
      displayName: '001',
      sessions: [],
      codexSessions: [{ id: 'codex-session-b' }],
      opencodeSessions: [],
    },
  ]);

  assert.deepEqual(projects.map((project) => project.fullPath), [firstPath, secondPath]);
  assert.deepEqual(projects.map((project) => project.routePath), ['/projects/first', '/projects/second']);
  assert.equal(new Set(projects.map((project) => project.displayName)).size, 2);
  assert.ok(projects.every((project) => project.displayName.startsWith('001 - TestRealWorktree')));
});
