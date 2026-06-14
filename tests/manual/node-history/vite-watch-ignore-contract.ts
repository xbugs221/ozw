/**
 * PURPOSE: Prevent Vite from watching repository-local caches and generated
 * directories that make ozw dev and Playwright browser specs fail with ENOSPC.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();

/**
 * Read the Vite config source used by both local dev and Playwright setup.
 */
function readViteConfig(): string {
  return fs.readFileSync(path.join(REPO_ROOT, 'vite.config.ts'), 'utf8');
}

test('Vite dev server ignores repository caches and generated outputs', () => {
  const source = readViteConfig();
  const requiredIgnoredPaths = [
    '.pnpm-store',
    '.tmp',
    '.playwright-cli',
    'dist',
    'dist-node',
    'tests/test-results',
    'node_modules',
  ];

  assert.match(source, /\bwatch\s*:/, 'vite.config.ts must configure server.watch');

  for (const ignoredPath of requiredIgnoredPaths) {
    assert.match(
      source,
      new RegExp(ignoredPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `Vite watcher must ignore ${ignoredPath}`,
    );
  }
});
