/**
 * PURPOSE: Verify workflow metadata attachment does not break the project list
 * when a single project-local workflow config is unreadable.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { attachWorkflowMetadata } from '../../backend/workflows.ts';

test('attachWorkflowMetadata keeps projects visible when workflow config JSON is corrupt', async () => {
  /**
   * PURPOSE: Reproduce /api/projects reading workflow metadata for every
   * project; a bad .ozw/conf.json should not turn the whole response into 500.
   */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-corrupt-workflow-config-'));
  const projectPath = path.join(tempRoot, 'workspace', 'project-a');

  try {
    await fs.mkdir(path.join(projectPath, '.ozw'), { recursive: true });
    await fs.writeFile(
      path.join(projectPath, '.ozw', 'conf.json'),
      '{"schemaVersion":2}\n{"trailing":"invalid"}\n',
      'utf8',
    );

    const projects = await attachWorkflowMetadata([{
      name: 'project-a',
      path: projectPath,
      fullPath: projectPath,
    }]);

    assert.equal(projects.length, 1);
    assert.deepEqual(projects[0].workflows, []);
    assert.equal(projects[0].hasUnreadActivity, false);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
