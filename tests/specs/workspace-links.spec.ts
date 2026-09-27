/**
 * PURPOSE: Verify chat file links resolve across WSL mount and Windows drive path spellings.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWorkspaceFileReference } from '../../frontend/components/chat/utils/workspaceLinks.ts';

test('WSL drive mount links resolve against a Windows project root', () => {
  const result = parseWorkspaceFileReference(
    '/mnt/c/work/project/src/app.ts',
    { name: 'project', fullPath: 'C:\\work\\project', path: 'C:\\work\\project' } as any,
  );

  assert.deepEqual(result, { filePath: 'src/app.ts', line: undefined, column: undefined });
});

test('Windows drive links resolve against a WSL project root', () => {
  const result = parseWorkspaceFileReference(
    'C:\\work\\project\\src\\app.ts',
    { name: 'project', fullPath: '/mnt/c/work/project', path: '/mnt/c/work/project' } as any,
  );

  assert.deepEqual(result, { filePath: 'src/app.ts', line: undefined, column: undefined });
});

test('WSL drive mount links outside the selected project stay unresolved', () => {
  const result = parseWorkspaceFileReference(
    '/mnt/d/other/src/app.ts',
    { name: 'project', fullPath: 'C:\\work\\project', path: 'C:\\work\\project' } as any,
  );

  assert.equal(result, null);
});
