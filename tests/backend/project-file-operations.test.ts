// @ts-nocheck -- Test typing: parameter annotations pending.
/**
 * PURPOSE: Verify project file path resolution stays confined while allowing
 * read-only inspection of oz flow runtime artifacts owned by the selected project.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveFlowRunsRoot } from '../../backend/domains/workflows/flow-runtime-paths.ts';
import { resolveReadableProjectPath } from '../../backend/project-file-operations.ts';

async function withRuntimeStateHome(callback) {
  /**
   * Run path-resolution checks against an isolated XDG_STATE_HOME.
   */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-file-ops-'));
  const originalXdgStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = path.join(tempRoot, 'state');

  try {
    await callback(tempRoot);
  } finally {
    if (originalXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalXdgStateHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test('readable path resolution allows same-project oz flow runtime artifacts as read-only files', async () => {
  await withRuntimeStateHome(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const runDir = path.join(resolveFlowRunsRoot(projectPath), 'run-a');
    const artifactPath = path.join(runDir, 'fix-1.md');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(artifactPath, '# fix\n', 'utf8');

    const resolved = await resolveReadableProjectPath(projectPath, artifactPath, {
      projectPathHint: projectPath,
    });

    assert.equal(resolved.absolutePath, artifactPath);
    assert.equal(resolved.readOnly, true);
    assert.equal(resolved.scope, 'workflow-runtime');
  });
});

test('readable path resolution still rejects unrelated absolute paths', async () => {
  await withRuntimeStateHome(async (tempRoot) => {
    const projectPath = path.join(tempRoot, 'project');
    const outsidePath = path.join(tempRoot, 'outside.md');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(outsidePath, '# outside\n', 'utf8');

    await assert.rejects(
      () => resolveReadableProjectPath(projectPath, outsidePath, { projectPathHint: projectPath }),
      /Path must be under project root/,
    );
  });
});
