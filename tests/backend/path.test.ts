/**
 * PURPOSE: Verify canonical project route paths for HOME-relative projects.
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildProjectRoutePath } from '../../backend/projects.ts';

test('HOME project route uses explicit tilde prefix', () => {
  /**
   * HOME itself has an empty relative path, so the UI needs a visible project
   * prefix before stable cN/wN route segments.
   */
  const homeDir = os.homedir();

  assert.equal(buildProjectRoutePath(homeDir), '/~');
});

test('HOME child project route remains home-relative', () => {
  /**
   * Nested projects keep the readable relative path used by existing routes.
   */
  const projectPath = path.join(os.homedir(), 'workspace', 'fixture-project');

  assert.equal(buildProjectRoutePath(projectPath), '/workspace/fixture-project');
});
