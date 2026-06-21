// @ts-nocheck -- Real-service performance regression uses host-local ozw state.
/**
 * PURPOSE: Verify the real project homepage renders workflow and manual-session
 * lists quickly against the host ozw service and database.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { authenticatePage, authHeaders } from '../spec/helpers/spec-test-helpers.ts';
import { PLAYWRIGHT_FIXTURE_PROJECT_PATHS } from './helpers/playwright-fixture.ts';
import { getProjectLocalConfigPath } from '../../backend/project-config-store.ts';

const PROJECT_PATH = process.env.OZW_REAL_OVERVIEW_PROJECT_PATH || PLAYWRIGHT_FIXTURE_PROJECT_PATHS[5];
const PROJECT_LIST_ITEM_TEST_ID = process.env.OZW_REAL_OVERVIEW_PROJECT_ITEM_TEST_ID
  || 'project-list-item-history-scroll-desktop-surface';
const DEBUG_SCREENSHOT_DIR = path.resolve(
  process.cwd(),
  'docs/debug/20260617-1739-project-overview-slow/screenshots',
);

async function seedOverviewProjectSessions(projectPath: string): Promise<void> {
  /** Seed real project-local session metadata so bulk selection exercises provider-aware cards. */
  const projectConfigPath = getProjectLocalConfigPath(projectPath);
  await fs.mkdir(path.dirname(projectConfigPath), { recursive: true });
  await fs.writeFile(projectConfigPath, `${JSON.stringify({
    schemaVersion: 2,
    chat: {
      1: {
        sessionId: 'fixture-history-scroll-session',
        provider: 'codex',
        providerSessionId: 'fixture-history-scroll-session',
        origin: 'manual',
        title: 'Overview Codex session',
      },
      2: {
        sessionId: 'fixture-mixed-long-virtual-session',
        provider: 'codex',
        providerSessionId: 'fixture-mixed-long-virtual-session',
        origin: 'manual',
        title: 'Overview second Codex session',
      },
    },
    manuallyAdded: true,
    originalPath: projectPath,
    displayName: 'history-scroll',
    manualSessionNextRouteIndex: 2,
  }, null, 2)}\n`, 'utf8');
}

async function measureOverviewApiRequest(page, projectPath: string): Promise<number> {
  /** Measure the real authenticated overview route when UI state is already hydrated before click. */
  const projectName = path.basename(projectPath);
  const startedAt = Date.now();
  const response = await page.request.get(
    `/api/projects/${encodeURIComponent(projectName)}/overview?projectPath=${encodeURIComponent(projectPath)}`,
    { headers: authHeaders() },
  );
  expect(response.ok(), `overview request must succeed: ${response.status()}`).toBe(true);
  await response.json();
  return Date.now() - startedAt;
}

test('real ozw project homepage refreshes and supports provider-aware bulk session selection', async ({ page }) => {
  /**
   * PURPOSE: Exercise the exact user-visible page instead of a mocked API or
   * isolated fixture project, because the regression is tied to real history size.
   */
  await seedOverviewProjectSessions(PROJECT_PATH);
  await authenticatePage(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  const overviewStartedAt = Date.now();
  const overviewResponse = await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes('/api/projects/') && response.url().includes('/overview'),
      { timeout: 5_000 },
    ).catch(() => null),
    page.getByTestId(PROJECT_LIST_ITEM_TEST_ID).click(),
  ]).then(([response]) => response);
  let overviewDurationMs = overviewResponse ? Date.now() - overviewStartedAt : 0;

  await expect(page.getByTestId('project-workspace-overview')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('project-overview-workflows')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('project-overview-manual-sessions')).toBeVisible({ timeout: 10_000 });
  if (overviewDurationMs === 0) {
    overviewDurationMs = await measureOverviewApiRequest(page, PROJECT_PATH);
  }

  await page.getByTestId('project-overview-session-selection-toggle').click();
  await expect(page.getByTestId('project-overview-session-bulk-toolbar')).toBeVisible({ timeout: 10_000 });

  const sessionCards = page.getByTestId('project-overview-session-card');
  const sessionCount = await sessionCards.count();
  expect(sessionCount).toBeGreaterThan(0);

  await sessionCards.first().click();
  await expect(sessionCards.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('project-overview-bulk-favorite')).toBeVisible();
  await expect(page.getByTestId('project-overview-bulk-pending')).toBeVisible();
  await expect(page.getByTestId('project-overview-bulk-hide')).toBeVisible();

  const firstProvider = await sessionCards.first().getAttribute('data-provider');
  expect(['codex', 'pi']).toContain(firstProvider);

  await page.getByTestId('project-overview-bulk-clear').click();
  await expect(page.getByTestId('project-overview-session-bulk-toolbar')).toBeHidden();
  await page.screenshot({
    path: path.join(DEBUG_SCREENSHOT_DIR, 'real-project-overview-loaded.png'),
    fullPage: true,
  });

  expect(overviewDurationMs).toBeGreaterThan(0);
  expect(overviewDurationMs).toBeLessThan(1000);
});
