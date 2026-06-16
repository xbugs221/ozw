// @ts-nocheck -- Real-service performance regression uses host-local ozw state.
/**
 * PURPOSE: Verify the real project homepage renders workflow and manual-session
 * lists quickly against the host ozw service and database.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

const REAL_PERF_ENABLED = process.env.OZW_REAL_OVERVIEW_PERF === '1';
const PROJECT_PATH = process.env.OZW_REAL_OVERVIEW_PROJECT_PATH || '/home/zzl/projects/ozw';
const PROJECT_ROUTE = process.env.OZW_REAL_OVERVIEW_PROJECT_ROUTE || '/projects/ozw';
const DEBUG_SCREENSHOT_DIR = path.resolve(
  process.cwd(),
  'docs/debug/20260617-1739-project-overview-slow/screenshots',
);

test.skip(!REAL_PERF_ENABLED, 'Set OZW_REAL_OVERVIEW_PERF=1 against a running local ozw service to validate real overview performance.');

test('real ozw project homepage loads workflow and manual session lists within one second', async ({ page }) => {
  /**
   * PURPOSE: Exercise the exact user-visible page instead of a mocked API or
   * isolated fixture project, because the regression is tied to real history size.
   */
  let overviewStartedAt = 0;
  let overviewDurationMs = 0;

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/projects/') && url.includes('/overview')) {
      overviewStartedAt = Date.now();
    }
  });
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/projects/') && url.includes('/overview') && overviewStartedAt > 0) {
      overviewDurationMs = Date.now() - overviewStartedAt;
    }
  });

  const targetUrl = `${PROJECT_ROUTE}?projectPath=${encodeURIComponent(PROJECT_PATH)}`;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('project-workspace-overview')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('project-overview-workflows')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('project-overview-manual-sessions')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({
    path: path.join(DEBUG_SCREENSHOT_DIR, 'real-project-overview-loaded.png'),
    fullPage: true,
  });

  expect(overviewDurationMs).toBeGreaterThan(0);
  expect(overviewDurationMs).toBeLessThan(1000);
});
