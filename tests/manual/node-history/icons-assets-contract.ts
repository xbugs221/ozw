// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Contract test verifying lucide-react dependency and stale asset references are removed.
 * Change: 2026-05-16-29-移除TaskMaster和lucide图标依赖
 *
 * Verifies:
 * - package.json does not depend on lucide-react
 * - No source file imports lucide-react or uses LucideIcon type
 * - index.html does not reference deleted favicon/manifest/PWA icons
 * - manifest.json does not contain deleted icon references
 * - No source file references deleted icon/logo assets (/logo.svg, /icons/codex.svg, etc.)
 * - Deleted CodexLogo/ClaudeLogo components no longer exist
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = resolve('.');

const readRepoFile = (path) => readFile(resolve(REPO_ROOT, path), 'utf8');

const exists = async (path) => {
  try {
    await stat(resolve(REPO_ROOT, path));
    return true;
  } catch {
    return false;
  }
};

// --- Dependency contract checks ---

test('package.json does not depend on lucide-react', async () => {
  const content = await readRepoFile('package.json');
  const pkg = JSON.parse(content);
  assert.equal('lucide-react' in (pkg.dependencies || {}), false);
  assert.equal('lucide-react' in (pkg.devDependencies || {}), false);
});

test('No source file imports lucide-react', () => {
  const result = execSync(
    `grep -rl "from 'lucide-react'" "${resolve(REPO_ROOT, 'src')}" 2>/dev/null || true`,
    { encoding: 'utf8' },
  ).trim();
  assert.equal(result, '');
});

test('No source file uses LucideIcon type from lucide-react', () => {
  const result = execSync(
    `grep -rl "LucideIcon" "${resolve(REPO_ROOT, 'src')}" 2>/dev/null || true`,
    { encoding: 'utf8' },
  ).trim();
  assert.equal(result, '');
});

// --- HTML/manifest contract checks ---

test('index.html does not reference deleted favicon files', async () => {
  const content = await readRepoFile('index.html');
  assert.doesNotMatch(content, /\/favicon\.svg/);
  assert.doesNotMatch(content, /\/favicon\.png/);
});

test('index.html does not reference deleted PWA icons or manifest', async () => {
  const content = await readRepoFile('index.html');
  assert.doesNotMatch(content, /apple-touch-icon/);
  // manifest.json link was already absent in change 29; change 30 deleted the file entirely.
  assert.doesNotMatch(content, /manifest\.json/);
});

test('index.html still loads the app entry script', async () => {
  const content = await readRepoFile('index.html');
  assert.match(content, /src\/main\.jsx/);
});

test('manifest.json is removed — no PWA manifest entry in index.html', async () => {
  // Change 30 deleted public/manifest.json because index.html has no
  // <link rel="manifest"> and the app no longer publishes a PWA manifest.
  assert.equal(await exists('public/manifest.json'), false,
    'public/manifest.json must no longer exist');
  const html = await readRepoFile('index.html');
  assert.doesNotMatch(html, /manifest\.json/,
    'index.html must not reference manifest.json');
});

// --- Asset reference contract checks ---

test('No source file references deleted /logo.svg', () => {
  const result = execSync(
    `grep -rl "/logo\\.svg" "${resolve(REPO_ROOT, 'src')}" 2>/dev/null || true`,
    { encoding: 'utf8' },
  ).trim();
  assert.equal(result, '');
});

test('No source file references deleted /icons/codex.svg or /icons/codex-white.svg', () => {
  const result = execSync(
    `grep -rl "/icons/codex\\(-white\\)\\?\\.svg" "${resolve(REPO_ROOT, 'src')}" 2>/dev/null || true`,
    { encoding: 'utf8' },
  ).trim();
  assert.equal(result, '');
});

test('No source file references deleted /icons/claude-ai-icon.svg', () => {
  const result = execSync(
    `grep -rl "/icons/claude-ai-icon\\.svg" "${resolve(REPO_ROOT, 'src')}" 2>/dev/null || true`,
    { encoding: 'utf8' },
  ).trim();
  assert.equal(result, '');
});

test('Deleted CodexLogo component no longer exists', async () => {
  assert.equal(await exists('frontend/components/llm-logo-provider/CodexLogo.tsx'), false);
});

test('Deleted ClaudeLogo component no longer exists', async () => {
  assert.equal(await exists('frontend/components/llm-logo-provider/ClaudeLogo.tsx'), false);
});

test('SetupForm does not reference /logo.svg asset', async () => {
  const content = await readRepoFile('frontend/components/auth/SetupForm.tsx');
  assert.doesNotMatch(content, /\/logo\.svg/);
  assert.match(content, /aria-label="ozw"/);
});
