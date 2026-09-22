/**
 * PURPOSE: Verify the current project navigation contract in a fast CI gate.
 * Covers active-project visibility and the intentionally collapsed workflow section.
 */
import { test, expect } from '@playwright/test';
import { openFixtureProject } from './helpers/spec-test-helpers.ts';

test('project navigation smoke gate @ci', async ({ page }) => {
  /** The home page keeps workflows collapsed until the user opens them. */
  await openFixtureProject(page, { expandWorkflows: false });
  const workflows = page.getByTestId('project-overview-workflows');
  await expect(workflows.getByRole('heading', { name: '自动工作流' })).toBeVisible();
  await expect(workflows.getByRole('button', { name: /登录升级/ })).toHaveCount(0);
  await workflows.getByRole('button', { name: /自动工作流/ }).click();
  await expect(workflows.getByRole('button', { name: /登录升级/ })).toBeVisible();
});
