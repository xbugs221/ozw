/**
 * PURPOSE: Ensure current runtime documentation no longer advertises OpenCode.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = process.cwd();

test('README and active runtime specs describe Codex/Pi instead of OpenCode support', async () => {
  const checkedDocs = [
    'README.md',
    'docs/specs/dependencies-and-tooling.md',
    'tests/spec/README.md',
  ];

  for (const relativePath of checkedDocs) {
    const text = await readFile(path.join(repoRoot, relativePath), 'utf8');
    assert.equal(text.includes('OpenCode'), false, `${relativePath} must not mention OpenCode`);
    assert.equal(text.includes('opencode'), false, `${relativePath} must not mention opencode`);
  }
});
