// @ts-nocheck -- Test typing: parameter annotations pending.
/**
 * PURPOSE: Source shape contract test for the simplification change.
 * Change: 30-进一步精简仓库源码和脚本资源
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

function findRepoRoot(startDir: string) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return startDir;
}

const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

function grepSourceFiles(pattern) {
  const results = [];
  const dirs = ['frontend/', 'backend/', 'shared/'];

  for (const dir of dirs) {
    const fullDir = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;

    function walkDir(currentDir) {
      const entries = fs.readdirSync(path.join(REPO_ROOT, currentDir), { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          try {
            const content = fs.readFileSync(path.join(REPO_ROOT, fullPath), 'utf8');
            if (pattern.test(content)) results.push(fullPath);
          } catch { /* skip */ }
        }
      }
    }
    walkDir(dir);
  }
  return results;
}

test('no lucide references remain in active source code', async () => {
  const matches = grepSourceFiles(/lucide/i);
  const activeMatches = matches.filter((f) => !f.includes('docs/') && !f.includes('tests/'));
  assert.deepStrictEqual(activeMatches, [], 'lucide references remain');
});

test('converted TS files contain PURPOSE documentation', async () => {
  const convertedFiles = [
    'shared/codex-message-normalizer.ts',
    'shared/modelConstants.ts',
    'shared/socket-message-utils.ts',
    'frontend/components/chat/utils/messageDedup.ts',
    'frontend/components/chat/utils/sessionMessageDedup.ts',
    'frontend/components/main-content/view/subcomponents/sessionActivityState.ts',
  ];
  for (const tsPath of convertedFiles) {
    const content = fs.readFileSync(path.join(REPO_ROOT, tsPath), 'utf8');
    assert.ok(content.includes('PURPOSE'), `Missing PURPOSE in ${tsPath}`);
  }
});

test('deleted chat subcomponents no longer exist', async () => {
  const deletedFiles = [
    'frontend/components/chat/view/subcomponents/ChatInputControls.tsx',
    'frontend/components/chat/view/subcomponents/PermissionRequestsBanner.tsx',
    'frontend/components/chat/view/subcomponents/TokenUsagePie.tsx',
  ];
  for (const file of deletedFiles) {
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, file)), `Should not exist: ${file}`);
  }
});

test('deleted public resources and scripts no longer exist', async () => {
  const deletedFiles = [
    'public/clear-cache.html',
    'public/generate-icons.js',
    'scripts/check-missing-project-archive.sh',
  ];
  for (const file of deletedFiles) {
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, file)), `Should not exist: ${file}`);
  }
});
