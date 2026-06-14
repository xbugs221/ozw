import { test, expect } from '@playwright/test';
import { openFixtureProject } from '../spec/helpers/spec-test-helpers.ts';

test('debug auth', async ({ page }) => {
  await new Promise((r) => setTimeout(r, 2000));
  await openFixtureProject(page);
  await expect(page.getByTestId('project-workspace-overview')).toBeVisible();
});
