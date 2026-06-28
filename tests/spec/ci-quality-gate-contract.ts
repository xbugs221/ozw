/**
 * PURPOSE: Guard the shared local and GitHub CI quality gate for Node checks.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function read(relativePath: string): string {
  /** Read repository config files used by local and GitHub quality gates. */
  return fs.readFileSync(relativePath, 'utf8');
}

test('test:ci covers the same Node checks required by GitHub CI', () => {
  const scripts = JSON.parse(read('package.json')).scripts || {};
  const testCi = scripts['test:ci'] || '';
  for (const command of ['typecheck', 'test:vitest', 'test:server', 'test:spec:node']) {
    assert.match(testCi, new RegExp(command), `test:ci must include ${command}`);
  }
});

test('GitHub node-checks runs the shared CI gate without skip semantics', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /node-version-file:\s+\.nvmrc/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm run test:ci/);
  assert.doesNotMatch(workflow, /--skip|test\.skip|continue-on-error:\s*true/);
});
