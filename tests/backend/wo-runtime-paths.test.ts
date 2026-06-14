/**
 * PURPOSE: Verify ozw resolves wo user-state runtime paths with the same
 * repository isolation rules used by the external runner.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import test from 'node:test';

import {
  formatFlowStatePathForDiagnostics,
  resolveFlowRepoKey,
  resolveFlowRunsRoot,
  resolveFlowStateRoot,
  sanitizeFlowRepoBasename,
} from '../../backend/domains/workflows/flow-runtime-paths.ts';

/**
 * Compute the expected repo key independently from the production helper.
 */
function expectedRepoKey(projectPath: string) {
  const absolutePath = path.resolve(projectPath);
  const prefix = path.basename(absolutePath).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';
  const hash = crypto.createHash('sha1').update(absolutePath).digest('hex').slice(0, 10);
  return `${prefix}-${hash}`;
}

test('wo runtime paths isolate repositories with the same basename', () => {
  const left = path.join('/tmp', 'left', 'same-name');
  const right = path.join('/tmp', 'right', 'same-name');

  assert.equal(resolveFlowRepoKey(left), expectedRepoKey(left));
  assert.equal(resolveFlowRepoKey(right), expectedRepoKey(right));
  assert.notEqual(resolveFlowRepoKey(left), resolveFlowRepoKey(right));
});

test('wo runtime paths sanitize special repository basenames', () => {
  const projectPath = path.join('/tmp', 'My Repo__测试!!');

  assert.equal(sanitizeFlowRepoBasename(projectPath), 'my-repo');
  assert.match(resolveFlowRepoKey(projectPath), /^my-repo-[0-9a-f]{10}$/);
});

test('wo runtime paths use XDG_STATE_HOME for runs root and diagnostics', () => {
  const env = { XDG_STATE_HOME: path.join('/tmp', 'ozw-state') };
  const projectPath = path.join('/tmp', 'project');
  const repoKey = expectedRepoKey(projectPath);
  const runsRoot = resolveFlowRunsRoot(projectPath, env);
  const statePath = path.join(runsRoot, 'run-a', 'state.json');

  assert.equal(resolveFlowStateRoot(env), path.join(env.XDG_STATE_HOME, 'oz', 'flow'));
  assert.equal(runsRoot, path.join(env.XDG_STATE_HOME, 'oz', 'flow', 'repos', repoKey, 'runs'));
  assert.equal(
    formatFlowStatePathForDiagnostics(statePath, env),
    path.posix.join('${XDG_STATE_HOME:-~/.local/state}', 'oz', 'flow', 'repos', repoKey, 'runs', 'run-a', 'state.json'),
  );
});
