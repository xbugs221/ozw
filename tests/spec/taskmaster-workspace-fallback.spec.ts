/**
 * PURPOSE: Verify that stale activeTab=tasks from localStorage does not leave
 * the workspace blank after TaskMaster removal (change 29).
 *
 * When a user previously had tasks tab active and TaskMaster is now removed,
 * the workspace must fall back to chat and must not persist tasks as activeTab.
 */
import { test, expect } from '@playwright/test';
import {
  ensurePlaywrightFixture,
} from '../e2e/helpers/playwright-fixture.ts';
import {
  PRIMARY_FIXTURE_LABEL,
  authenticatePage,
} from './helpers/spec-test-helpers.ts';

test.beforeEach(() => {
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
});

test('stale activeTab=tasks falls back to chat and tasks tab is absent', async ({ page }) => {
  await authenticatePage(page);

  // Simulate a user who previously had tasks tab active
  await page.addInitScript(() => {
    window.localStorage.setItem('activeTab', 'tasks');
  });

  // Navigate to the fixture project workspace
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).not.toContainText('Loading...');

  // Select the fixture project
  const projectButton = page.getByRole('button', { name: new RegExp(`^${PRIMARY_FIXTURE_LABEL}\\b`, 'i') }).first();
  await expect(projectButton).toBeVisible({ timeout: 10_000 });
  await projectButton.click();

  // Wait for workspace to render
  await expect(page.getByTestId('project-workspace-overview')).toBeVisible({ timeout: 10_000 });

  // Verify the Messages (chat) tab button is visible - it's a retained tab
  await expect(page.getByTestId('tab-chat')).toBeVisible({ timeout: 5_000 });

  // Verify tasks tab does NOT exist
  await expect(page.getByTestId('tab-tasks')).toHaveCount(0);

  // Verify activeTab is no longer persisted as 'tasks'
  const persistedTab = await page.evaluate(() => localStorage.getItem('activeTab'));
  expect(persistedTab).not.toBe('tasks');


});
