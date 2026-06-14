/**
 * PURPOSE: Covers project-local config persistence behavior that protects
 * workflow/session reads from partial writes and concurrent writer collisions.
 * Updated: config now writes to XDG state directory, not project .ozw.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeProjectLocalConfig,
  getProjectLocalConfigPath,
} from '../../backend/project-config-store.ts';

test('project config concurrent writes use unique temp files', async () => {
  /**
   * PURPOSE: Reproduce startup scans writing the same project config in quick
   * succession; each writer must own a distinct temp path before atomic rename.
   */
  const projectPath = await mkdtemp(join(tmpdir(), 'ozw-config-write-'));
  try {
    await Promise.all(
      Array.from({ length: 12 }, (_, index) => writeProjectLocalConfig(projectPath, {
        schemaVersion: 2,
        marker: index,
      })),
    );

    const configPath = getProjectLocalConfigPath(projectPath);
    const rawConfig = await readFile(configPath, 'utf8');
    const parsedConfig = JSON.parse(rawConfig);
    assert.equal(parsedConfig.schemaVersion, 2);
    assert.equal(Number.isInteger(parsedConfig.marker), true);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
