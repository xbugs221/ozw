/**
 * PURPOSE: Verify project-scoped header titles identify the active project.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { getMainContentTabTitle } from '../../frontend/components/main-content/utils/mainContentTitle.ts';

const translate = (key: string) => ({
  'tabs.overview': 'Home',
  'mainContent.projectFiles': 'Files',
}[key] || key);

test('Shell/TUI header uses the concrete project display name', () => {
  /** The default “Project” label must not hide which project owns the TUI. */
  const project = {
    name: 'ozw',
    displayName: 'OZW Workspace',
  } as never;

  assert.equal(getMainContentTabTitle('shell', project, translate), 'OZW Workspace');
  assert.equal(getMainContentTabTitle('overview', project, translate), 'Home');
  assert.equal(getMainContentTabTitle('files', project, translate), 'Files');
});
