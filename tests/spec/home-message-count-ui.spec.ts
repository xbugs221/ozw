/**
 * PURPOSE: Browser acceptance for change 39 home/sidebar session count rendering.
 */
import { test, expect } from '@playwright/test';
import { openFixtureProject } from './helpers/spec-test-helpers.ts';

test('unknown provider message counts are hidden on project home and sidebar session rows', async ({ page }) => {
  await openFixtureProject(page);

  await expect(page.getByTestId('project-overview-manual-sessions')).toBeVisible();
  await expect(page.getByTestId('project-overview-manual-sessions')).not.toContainText(/0 条消息/);
  await expect(page.getByTestId('project-list')).not.toContainText(/0 条/);
});
