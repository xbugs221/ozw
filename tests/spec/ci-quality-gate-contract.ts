/**
 * PURPOSE: Guard the shared local and GitHub CI quality gate for Node checks.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

test('local pre-commit hook runs only staged tests without changing staged files', () => {
  /** Keep all local commits focused; the GitHub workflow remains the complete gate. */
  const packageJson = JSON.parse(read('package.json'));
  const hook = read('.githooks/pre-commit');
  const precommit = read('scripts/pre-commit.sh');
  const nodeVersion = read('.nvmrc').trim();

  assert.equal(packageJson.scripts?.precommit, './scripts/pre-commit.sh');
  assert.equal(packageJson.engines?.node, nodeVersion.replace(/^v/, ''));
  assert.match(nodeVersion, /^v\d+\.\d+\.\d+$/);
  assert.match(hook, /scripts\/pre-commit\.sh/);
  assert.match(precommit, /git diff --cached --quiet/);
  assert.match(precommit, /GIT_REFLOG_ACTION/);
  assert.match(precommit, /squash/);
  assert.match(precommit, /scripts\/list-staged-tests\.mjs/);
  assert.match(precommit, /pnpm exec vitest run/);
  assert.doesNotMatch(precommit, /pnpm run test:ci/);
  assert.doesNotMatch(precommit, /git add|format-code\.sh/);
});

test('staged-test selector excludes every unchanged test', () => {
  /** Keep a source-only change from rerunning test files that were not edited. */
  const sourceOnly = execFileSync(
    process.execPath,
    ['scripts/list-staged-tests.mjs', 'frontend/components/chat/utils/chatFormatting.ts'],
    { encoding: 'utf8' },
  );
  const changedTest = execFileSync(
    process.execPath,
    ['scripts/list-staged-tests.mjs', 'tests/unit/chat-markdown-fence-normalization.test.ts'],
    { encoding: 'utf8' },
  );

  assert.equal(sourceOnly, '');
  assert.equal(changedTest, 'unit\ttests/unit/chat-markdown-fence-normalization.test.ts\n');
  assert.equal(
    execFileSync(process.execPath, ['scripts/list-staged-tests.mjs', 'tests/e2e/helpers/playwright-fixture.ts'], { encoding: 'utf8' }),
    '',
  );
});
