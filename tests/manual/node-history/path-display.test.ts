/**
 * PURPOSE: Verify UI-only path formatting keeps workspace paths readable without
 * changing paths that point outside the selected repository.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPathRelativeToProject,
  formatPathTextRelativeToProject,
} from '../../../frontend/utils/pathDisplay';

test('workspace absolute paths display relative to the selected project root', () => {
  /**
   * PURPOSE: The transcript should hide repo-root prefixes while preserving the
   * path users need to identify the file.
   */
  const projectRoot = '/home/user/projects/matx';

  assert.equal(
    formatPathRelativeToProject('/home/user/projects/matx/src/index.ts', projectRoot),
    'src/index.ts',
  );
  assert.equal(formatPathRelativeToProject('/home/user/projects/matx', projectRoot), '.');
});

test('absolute paths outside the selected project stay absolute', () => {
  /**
   * PURPOSE: External files must keep their absolute path so users can see they
   * are outside the current repository boundary.
   */
  assert.equal(
    formatPathRelativeToProject('/tmp/generated/report.md', '/home/user/projects/matx'),
    '/tmp/generated/report.md',
  );
});

test('path fragments inside labels display relative to the project root', () => {
  /**
   * PURPOSE: Search labels such as `in /repo/src` should follow the same display
   * rule as direct file-operation paths.
   */
  assert.equal(
    formatPathTextRelativeToProject('in /home/user/projects/matx/src', '/home/user/projects/matx'),
    'in src',
  );
  assert.equal(
    formatPathTextRelativeToProject('/home/user/projects/matx/src/index.ts', '/home/user/projects/matx'),
    'src/index.ts',
  );
  assert.equal(
    formatPathTextRelativeToProject('cat /home/user/projects/matx/src/index.ts', '/home/user/projects/matx'),
    'cat src/index.ts',
  );
});
