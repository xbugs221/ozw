/**
 * PURPOSE: Guard high-value frontend module boundaries after proposal-local tests are archived.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const ENTRY_BUDGETS = [
  ['frontend/components/chat/view/ChatInterface.tsx', 1050],
  ['frontend/components/chat/view/subcomponents/ChatMessagesPane.tsx', 430],
  ['frontend/hooks/useProjectsState.ts', 760],
] as const;
const FOCUSED_MODULES = [
  'frontend/components/chat/view/chatInterfaceSearchNavigation.ts',
  'frontend/components/chat/view/chatInterfaceStatusReconcile.ts',
  'frontend/components/chat/view/subcomponents/chatMessagesPaneLayoutController.ts',
  'frontend/hooks/projectsStateRefreshController.ts',
  'frontend/hooks/projectsStateReducers.ts',
];

function read(relativePath: string): string {
  /** Read production files for durable boundary checks. */
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('high-value entry modules stay below reviewable line budgets', () => {
  for (const [relativePath, maxLines] of ENTRY_BUDGETS) {
    const source = read(relativePath);
    assert.ok(source.split(/\r?\n/).length <= maxLines, `${relativePath} must stay within ${maxLines} lines`);
    assert.equal(source.includes('@ts-nocheck'), false, `${relativePath} must not use @ts-nocheck`);
  }
});

test('focused modules own extracted search, status, layout, refresh, and reducer logic', () => {
  for (const relativePath of FOCUSED_MODULES) {
    assert.ok(fs.existsSync(path.join(ROOT, relativePath)), `${relativePath} must exist`);
    assert.match(read(relativePath).slice(0, 240), /PURPOSE|文件目的|业务目的/);
  }
});
