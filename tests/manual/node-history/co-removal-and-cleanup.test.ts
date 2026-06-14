/**
 * PURPOSE: Verify ozw no longer ships co protocol compatibility and deletes
 * legacy ozw-owned co state without touching provider-native history.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

type LegacyCoCleanupModule = {
  removeLegacyCoState: (options: { stateHome: string }) => Promise<{ removed: boolean; path: string }>;
};

const REPO_ROOT = process.cwd();

async function readRepoFile(relativePath: string): Promise<string> {
  /**
   * PURPOSE: Read real source files so this contract catches production co
   * compatibility code instead of checking a stale manifest.
   */
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

async function listSourceFiles(relativeRoot: string): Promise<string[]> {
  /**
   * PURPOSE: Recursively collect production files while ignoring generated
   * output and historical proposal archives.
   */
  const root = path.join(REPO_ROOT, relativeRoot);
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'dist-node', '.git'].includes(entry.name)) continue;
        await walk(absolute);
      } else if (/\.(ts|tsx|js|json)$/.test(entry.name)) {
        files.push(path.relative(REPO_ROOT, absolute));
      }
    }
  }
  await walk(root);
  return files;
}

async function loadCleanupModule(): Promise<LegacyCoCleanupModule> {
  /**
   * PURPOSE: Load the cleanup entry that execution must provide for deleting
   * legacy ozw co data during startup or migration.
   */
  const modulePath = path.join(REPO_ROOT, 'backend/legacy-co-cleanup.ts');
  try {
    const mod = await import(pathToFileURL(modulePath).href) as Partial<LegacyCoCleanupModule>;
    assert.equal(typeof mod.removeLegacyCoState, 'function', 'backend/legacy-co-cleanup.ts must export removeLegacyCoState');
    return mod as LegacyCoCleanupModule;
  } catch (error) {
    assert.fail(`Expected legacy co cleanup module to be importable: ${(error as Error).message}`);
  }
}

test('production source no longer ships co protocol modules or rewrite scripts', () => {
  assert.equal(existsSync(path.join(REPO_ROOT, 'backend/co-client.ts')), false, 'backend/co-client.ts must be deleted');
  assert.equal(existsSync(path.join(REPO_ROOT, 'backend/co-read-model.ts')), false, 'backend/co-read-model.ts must be deleted');
  assert.equal(
    existsSync(path.join(REPO_ROOT, 'scripts/remove-co-from-index.js')),
    false,
    'one-off co rewrite script must be deleted after co removal',
  );
});

test('production source no longer references co file protocol contracts', async () => {
  const sourceFiles = [
    ...(await listSourceFiles('server')),
    ...(await listSourceFiles('src')),
    ...(await listSourceFiles('shared')),
    ...(await listSourceFiles('scripts')),
  ];
  const forbidden = /\b(?:co-client|co-read-model|CCFLOW_CO_HOME|resolveCoHome|writeCoRequest|readCoConversation|CO_REQUEST_CONTRACT|co-request-v1|co-conversation-v1|co-turn-v1)\b/;
  const offenders: string[] = [];

  for (const file of sourceFiles) {
    const source = await readRepoFile(file);
    if (forbidden.test(source)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, [], `production source must not reference co protocol: ${offenders.join(', ')}`);
});

test('legacy co cleanup removes ozw-owned co state idempotently', async () => {
  const { removeLegacyCoState } = await loadCleanupModule();
  const stateHome = await mkdtemp(path.join(os.tmpdir(), 'ozw-legacy-co-state-'));
  const coRoot = path.join(stateHome, 'ozw', 'co');
  const providerCodexRoot = path.join(stateHome, '.codex');
  const providerPiRoot = path.join(stateHome, '.pi');

  await mkdir(path.join(coRoot, 'requests', 'pending'), { recursive: true });
  await mkdir(path.join(coRoot, 'conversations', 'c1'), { recursive: true });
  await mkdir(path.join(coRoot, 'turns', 't1'), { recursive: true });
  await writeFile(path.join(coRoot, 'requests', 'pending', 'r1.json'), '{"contract":"co-request-v1"}\n');
  await mkdir(providerCodexRoot, { recursive: true });
  await mkdir(providerPiRoot, { recursive: true });

  const firstResult = await removeLegacyCoState({ stateHome });
  const secondResult = await removeLegacyCoState({ stateHome });

  assert.equal(firstResult.removed, true, 'first cleanup should remove existing legacy co state');
  assert.equal(secondResult.removed, false, 'second cleanup should be idempotent');
  assert.equal(existsSync(coRoot), false, 'legacy ozw co state directory must be gone');
  assert.equal(existsSync(providerCodexRoot), true, 'cleanup must not delete provider-native Codex state');
  assert.equal(existsSync(providerPiRoot), true, 'cleanup must not delete provider-native Pi state');

  await rm(stateHome, { recursive: true, force: true });
});
