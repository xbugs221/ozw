// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Script and public resource traceability contract test.
 * Change: 30-进一步精简仓库源码和脚本资源
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

function getTrackedFiles(dir) {
  try {
    const output = execSync(`git ls-files ${dir}/`, { encoding: 'utf8', cwd: REPO_ROOT });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function grepAll(query, searchDirs = 'package.json README.md index.html frontend/ backend/ tests/') {
  try {
    execSync(
      'grep -rl "' + query + '" ' + searchDirs + ' ' +
      '--include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" ' +
      '--include="*.json" --include="*.md" --include="*.html" --include="*.sh"',
      { encoding: 'utf8', cwd: REPO_ROOT }
    );
    return true;
  } catch {
    return false;
  }
}

test('all scripts/ files have traceable references', async () => {
  const scriptFiles = getTrackedFiles('scripts');
  assert.ok(scriptFiles.length > 0, 'Scripts directory must not be empty');
  const unreferenced = [];

  for (const scriptPath of scriptFiles) {
    const basename = path.basename(scriptPath);
    if (basename.startsWith('.')) continue;
    const absPath = path.join(REPO_ROOT, scriptPath);
    if (!fs.existsSync(absPath)) continue; // deleted from working tree, still tracked
    if (!grepAll(basename)) {
      unreferenced.push(scriptPath);
    }
  }

  assert.deepStrictEqual(unreferenced, [], 'Scripts without traceable references');
});

test('all public/ files have traceable references from runtime entry points', async () => {
  const publicFiles = getTrackedFiles('public');
  assert.ok(publicFiles.length >= 0, 'Public directory check');
  const unreferenced = [];
  // Per spec: public resources must be referenced by index.html, manifest,
  // frontend source, backend static service, or README — NOT by tests alone.
  const runtimeDirs = 'package.json README.md index.html frontend/ backend/';

  for (const filePath of publicFiles) {
    const basename = path.basename(filePath);
    if (basename.startsWith('.')) continue;
    const absPath = path.join(REPO_ROOT, filePath);
    if (!fs.existsSync(absPath)) continue; // deleted from working tree, still tracked
    if (!grepAll(basename, runtimeDirs)) {
      unreferenced.push(filePath);
    }
  }

  assert.deepStrictEqual(unreferenced, [], 'Public files without traceable runtime references');
});

test('dev-watch.sh has a package.json script entry', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const hasDevWatch = Object.values(pkg.scripts || {}).some(
    (s) => typeof s === 'string' && s.includes('dev-watch.sh'),
  );
  assert.ok(hasDevWatch, 'dev-watch.sh not referenced in package.json');
});

test('fix-node-pty.ts is referenced in package.json', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const hasFix = Object.values(pkg.scripts || {}).some(
    (s) => typeof s === 'string' && s.includes('fix-node-pty.ts'),
  );
  assert.ok(hasFix, 'fix-node-pty.ts not referenced in package.json');
});

test('verify-missing-session-visibility.ts is referenced', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const hasVerify = Object.values(pkg.scripts || {}).some(
    (s) => typeof s === 'string' && s.includes('verify-missing-session-visibility'),
  );
  assert.ok(hasVerify, 'verify-missing-session-visibility not referenced');
});
