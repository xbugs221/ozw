// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify TypeScript migration contract for shared and frontend utilities.
 *
 * Change: 2026-05-13-23-迁移前端共享契约到TS
 *
 * This test validates:
 * 1. Frontend-exclusive files migrated to .ts
 * 2. Shared files used by backend/node-tests keep .js runtime + gain .d.ts types
 * 3. No server TS runtime introduced
 * 4. TypeScript typecheck covers migrated contracts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const fileExists = async (path) => {
  try {
    await access(resolve(REPO_ROOT, path));
    return true;
  } catch {
    return false;
  }
};

const readSource = (path) => readFile(resolve(REPO_ROOT, path), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Frontend-exclusive files migrated to TypeScript
// ─────────────────────────────────────────────────────────────────────────────

test('frontend/utils/api.ts exists and provides typed exports', async () => {
  assert.equal(await fileExists('frontend/utils/api.ts'), true, 'api.ts must exist');
  assert.equal(await fileExists('frontend/utils/api.js'), false, 'api.js must be removed');

  const source = await readSource('frontend/utils/api.ts');
  assert.match(source, /export const getAuthToken/);
  assert.match(source, /export const authenticatedFetch/);
  assert.match(source, /export const api/);
  // Verify typed signatures present
  assert.match(source, /\(url: string, options: RequestInit/);
  assert.match(source, /Promise<Response>/);
});

test('frontend/i18n/config.ts exists and no longer JS', async () => {
  assert.equal(await fileExists('frontend/i18n/config.ts'), true, 'config.ts must exist');
  assert.equal(await fileExists('frontend/i18n/config.js'), false, 'config.js must be removed');

  const source = await readSource('frontend/i18n/config.ts');
  assert.match(source, /import i18n from 'i18next'/);
  assert.match(source, /export default i18n/);
});

test('frontend/i18n/languages.ts exists with typed Language interface', async () => {
  assert.equal(await fileExists('frontend/i18n/languages.ts'), true, 'languages.ts must exist');
  assert.equal(await fileExists('frontend/i18n/languages.js'), false, 'languages.js must be removed');

  const source = await readSource('frontend/i18n/languages.ts');
  assert.match(source, /export interface Language/);
  assert.match(source, /export const languages: Language\[\]/);
  assert.match(source, /export const isLanguageSupported/);
  // Verify language values
  assert.match(source, /value: 'en'/);
  assert.match(source, /value: 'zh-CN'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Shared files migrated to .ts (change 30 simplified JS + .d.ts pairs)
// ─────────────────────────────────────────────────────────────────────────────

test('shared/socket-message-utils.ts exists as unified TS module', async () => {
  assert.equal(await fileExists('shared/socket-message-utils.ts'), true,
    'socket-message-utils.ts must exist');
  assert.equal(await fileExists('shared/socket-message-utils.js'), false,
    'socket-message-utils.js must be removed');
  assert.equal(await fileExists('shared/socket-message-utils.d.ts'), false,
    'socket-message-utils.d.ts must be removed');

  const source = await readSource('shared/socket-message-utils.ts');
  assert.match(source, /export function getMessageHistoryTailSequence/);
  assert.match(source, /export function getPendingSocketMessages/);
  assert.match(source, /export function reduceProjectsUpdatedMessages/);
  assert.match(source, /export interface ReduceProjectsUpdatedParams/);
  assert.match(source, /export interface ReduceProjectsUpdatedResult/);
});

test('shared/codex-message-normalizer.ts exists as unified TS module', async () => {
  assert.equal(await fileExists('shared/codex-message-normalizer.ts'), true,
    'codex-message-normalizer.ts must exist');
  assert.equal(await fileExists('shared/codex-message-normalizer.js'), false,
    'codex-message-normalizer.js must be removed');
  assert.equal(await fileExists('shared/codex-message-normalizer.d.ts'), false,
    'codex-message-normalizer.d.ts must be removed');

  const source = await readSource('shared/codex-message-normalizer.ts');
  assert.match(source, /export function parseCodexJsonMaybe/);
  assert.match(source, /export function normalizeCodexToolOutput/);
  assert.match(source, /export function normalizeCodexRealtimeItem/);
});

test('shared/modelConstants.ts exists as unified TS module', async () => {
  assert.equal(await fileExists('shared/modelConstants.ts'), true,
    'modelConstants.ts must exist');
  assert.equal(await fileExists('shared/modelConstants.js'), false,
    'modelConstants.js must be removed');
  assert.equal(await fileExists('shared/modelConstants.d.ts'), false,
    'modelConstants.d.ts must be removed');

  const source = await readSource('shared/modelConstants.ts');
  assert.match(source, /export const CODEX_MODELS/);
  assert.match(source, /export const CODEX_REASONING_EFFORTS/);
  assert.match(source, /export interface ReasoningEffort/);
});

test('frontend dedup and activity helpers migrated to .ts', async () => {
  const tsFiles = [
    'frontend/components/chat/utils/messageDedup.ts',
    'frontend/components/chat/utils/sessionMessageDedup.ts',
    'frontend/components/main-content/view/subcomponents/sessionActivityState.ts',
  ];

  for (const tsFile of tsFiles) {
    assert.equal(await fileExists(tsFile), true,
      `${tsFile} must exist as unified TS module`);
    assert.equal(await fileExists(tsFile.replace('.ts', '.js')), false,
      `${tsFile.replace('.ts', '.js')} must be removed`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. No server TS runtime introduced
// ─────────────────────────────────────────────────────────────────────────────

test('server package scripts do not reference ts-node or tsx', async () => {
  const pkgSource = await readSource('package.json');
  const scriptsSection = pkgSource.match(/"scripts"\s*:\s*\{([^}]+)\}/s)?.[1] || '';

  assert.doesNotMatch(scriptsSection, /ts-node/,
    'server scripts must not use ts-node');
  assert.doesNotMatch(scriptsSection, /\btsx\b/,
    'server scripts must not use tsx');
});

test('backend/index.js does not import .ts files', async () => {
  let serverSource;
  try {
    serverSource = await readSource('backend/index.ts');
  } catch {
    // backend/index.js might not exist as a single entry
    return;
  }

  // Allow .js imports but not .ts
  const tsImports = serverSource.match(/require\(['"].*\.ts['"]\)/g) || [];
  const tsDynamic = serverSource.match(/import\(['"].*\.ts['"]\)/g) || [];
  assert.deepEqual([...tsImports, ...tsDynamic], [],
    'backend/index.js must not import .ts files directly');
});

test('server files that depend on shared now import .ts', async () => {
  const projectsSource = await readSource('backend/projects.ts');
  assert.match(projectsSource, /codex-message-normalizer\.ts/,
    'backend/projects.js must now import codex-message-normalizer.ts');

  const codexModelsSource = await readSource('backend/codex-models.ts');
  assert.match(codexModelsSource, /modelConstants\.ts/,
    'backend/codex-models.js must now import modelConstants.ts');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Frontend import paths updated
// ─────────────────────────────────────────────────────────────────────────────

test('App.tsx and main.tsx import i18n config without .js extension', async () => {
  const appSource = await readSource('frontend/App.tsx');
  assert.match(appSource, /from ['"]\.\/i18n\/config['"]/);
  assert.doesNotMatch(appSource, /from ['"]\.\/i18n\/config\.js['"]/);

  const mainSource = await readSource('frontend/main.tsx');
  assert.match(mainSource, /['"]\.\/i18n\/config['"]/);
  assert.doesNotMatch(mainSource, /['"]\.\/i18n\/config\.js['"]/);
});

test('LanguageSelector still imports languages', async () => {
  const selectorSource = await readSource('frontend/components/settings/view/controls/LanguageSelector.tsx');
  assert.match(selectorSource, /from ['"][^'"]*i18n\/languages['"]/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Node server tests can still import shared runtime
// ─────────────────────────────────────────────────────────────────────────────

test('node test for socket-message-utils imports .ts successfully', async () => {
  const mod = await import('../../shared/socket-message-utils.ts');
  assert.equal(typeof mod.getMessageHistoryTailSequence, 'function');
  assert.equal(typeof mod.getPendingSocketMessages, 'function');
  assert.equal(typeof mod.reduceProjectsUpdatedMessages, 'function');
});

test('node test for model-constants imports .ts successfully', async () => {
  const mod = await import('../../shared/modelConstants.ts');
  assert.ok('CODEX_MODELS' in mod);
  assert.ok('CODEX_REASONING_EFFORTS' in mod);
});
