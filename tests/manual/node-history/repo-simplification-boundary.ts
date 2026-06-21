// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Repository simplification boundary contract test.
 * Change: 30-进一步精简仓库源码和脚本资源
 *
 * Asserts that tracked files remain within expected boundaries,
 * and that simplification has cleaned up the right files.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

function findRepoRoot(startDir) {
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

const IGNORED_PREFIXES = [
  'node_modules/',
  'dist/',
  '.wo/',
  '.agents/cache/',
  '.openspec/cache/',
  'tests/test-results/',
  'authdb/',
];

function getTrackedFiles() {
  const output = execSync('git ls-files', { encoding: 'utf8', cwd: REPO_ROOT });
  return output.trim().split('\n').filter(Boolean);
}

test('tracked files are not inside gitignore-ignored directories', async () => {
  const trackedFiles = getTrackedFiles();
  const violations = [];

  for (const file of trackedFiles) {
    for (const pattern of IGNORED_PREFIXES) {
      if (file.startsWith(pattern)) {
        violations.push(file);
        break;
      }
    }
  }

  assert.deepStrictEqual(violations, [], 'Tracked files found inside ignored directories');
});

test('.gitignore includes expected ignore patterns', async () => {
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
  const required = ['node_modules/', 'dist/', '.wo/', 'authdb/'];
  for (const pattern of required) {
    assert.ok(gitignore.includes(pattern), `.gitignore missing: ${pattern}`);
  }
});

test('simplified files are no longer on disk', async () => {
  const deletedFiles = [
    'scripts/check-missing-project-archive.sh',
    'public/clear-cache.html',
    'public/generate-icons.js',
    'shared/codex-message-normalizer.js',
    'shared/codex-message-normalizer.d.ts',
    'shared/modelConstants.js',
    'shared/modelConstants.d.ts',
    'shared/socket-message-utils.js',
    'shared/socket-message-utils.d.ts',
    'frontend/components/chat/utils/messageDedup.js',
    'frontend/components/chat/utils/messageDedup.d.ts',
    'frontend/components/chat/utils/sessionMessageDedup.js',
    'frontend/components/chat/utils/sessionMessageDedup.d.ts',
    'frontend/components/chat/view/subcomponents/ChatInputControls.tsx',
    'frontend/components/chat/view/subcomponents/PermissionRequestsBanner.tsx',
    'frontend/components/chat/view/subcomponents/TokenUsagePie.tsx',
    'frontend/components/main-content/view/subcomponents/sessionActivityState.js',
    'frontend/components/main-content/view/subcomponents/sessionActivityState.d.ts',
  ];

  for (const file of deletedFiles) {
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, file)), `File still exists: ${file}`);
  }
});

test('TS replacements exist for converted JS + .d.ts pairs', async () => {
  const tsPaths = [
    'shared/codex-message-normalizer.ts',
    'shared/modelConstants.ts',
    'shared/socket-message-utils.ts',
    'frontend/components/chat/utils/messageDedup.ts',
    'frontend/components/chat/utils/sessionMessageDedup.ts',
    'frontend/components/main-content/view/subcomponents/sessionActivityState.ts',
  ];

  for (const tsPath of tsPaths) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, tsPath)), `Missing TS: ${tsPath}`);
  }
});
