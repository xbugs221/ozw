// @ts-nocheck -- Browser geometry and route instrumentation are intentionally dynamic.
/**
 * PURPOSE: Verify Render history warms older data after first paint and reveals
 * buffered pages without making readers wait at the top of a long session.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import {
  PLAYWRIGHT_FIXTURE_AUTH_DB,
} from './helpers/playwright-fixture.ts';

process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../backend/middleware/auth.ts'),
  import('../../backend/database/db.ts'),
]);

const LONG_SESSION_ID = 'fixture-mixed-long-virtual-session';
const EVIDENCE_SCREENSHOT_PATH = process.env.OZW_HISTORY_EVIDENCE_SCREENSHOT || '';
const CAPTURE_BASELINE = process.env.OZW_HISTORY_EVIDENCE_BASELINE === '1';

/**
 * Return an authenticated browser token for the isolated fixture server.
 */
function createLocalAuthToken(): string {
  /** Keep the test on the same public single-user path as the real application. */
  const user = userDb.getFirstUser();
  if (!user) throw new Error('No active fixture user found');
  return generateToken(user);
}

/**
 * Decide whether a request is loading history older than the first tail page.
 */
function isOlderHistoryRequest(requestUrl: string): boolean {
  /** The first Render page always starts at offset zero. */
  const url = new URL(requestUrl);
  return url.pathname.includes('/messages')
    && Number(url.searchParams.get('offset')) >= 50;
}

test.beforeEach(async ({ page }) => {
  const token = createLocalAuthToken();
  await page.addInitScript((authToken) => {
    window.localStorage.setItem('auth-token', authToken);
  }, token);
});

test('long Render history appears before its idle warm-up page finishes', async ({ page }) => {
  /** The newest messages must remain interactive while older data warms quietly. */
  let olderRequestStartedAt = 0;
  let olderRequestFinishedAt = 0;
  await page.route(/\/api\/(?:projects\/.*\/sessions|codex\/sessions)\/.*\/messages.*/, async (route) => {
    if (isOlderHistoryRequest(route.request().url())) {
      olderRequestStartedAt ||= Date.now();
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
      olderRequestFinishedAt = Date.now();
      return;
    }
    await route.continue();
  });

  await page.goto(`/session/${LONG_SESSION_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('tab-chat').click();
  const pane = page.getByTestId('chat-rendered-snapshot-pane');
  await expect(pane).toBeVisible();
  await expect(page.locator('body')).toContainText('mixed long virtual history turn 1050');
  const firstContentVisibleAt = Date.now();

  await expect.poll(() => olderRequestStartedAt, { timeout: 5_000 }).toBeGreaterThan(0);
  expect(firstContentVisibleAt).toBeLessThan(olderRequestFinishedAt || Number.POSITIVE_INFINITY);
  await expect.poll(() => olderRequestFinishedAt, { timeout: 5_000 }).toBeGreaterThan(olderRequestStartedAt);
  await expect(pane).toHaveAttribute('data-history-prefetch-state', 'ready');
});

test('buffered history prepends immediately and preserves the visible row anchor', async ({ page }) => {
  /** A deliberately slow next request must not block data already held in memory. */
  await page.route(/\/api\/(?:projects\/.*\/sessions|codex\/sessions)\/.*\/messages.*/, async (route) => {
    if (isOlderHistoryRequest(route.request().url())) {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    }
    await route.continue();
  });

  await page.goto(`/session/${LONG_SESSION_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('tab-chat').click();
  const pane = page.getByTestId('chat-rendered-snapshot-pane');
  const scroller = page.getByTestId('chat-scroll-container');
  await expect(pane).toBeVisible();
  await expect(page.locator('body')).toContainText('mixed long virtual history turn 1050');
  if (!CAPTURE_BASELINE) {
    await expect(pane).toHaveAttribute('data-history-prefetch-state', 'ready');
  }

  await expect(pane).toHaveAttribute('data-has-more-history', 'true');
  await scroller.evaluate((element) => {
    /** Leave the top reserve once so a following upward scroll is a fresh crossing. */
    element.scrollTop = Math.min(
      Math.max(1, Math.floor(element.clientHeight * 1.25)),
      Math.max(1, element.scrollHeight - element.clientHeight - 1),
    );
    element.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(50);

  const initialRevision = Number(await pane.getAttribute('data-history-revision'));
  const anchor = await scroller.evaluate((element) => {
    /** Capture the first rendered row intersecting the viewport before the prepend. */
    element.scrollTop = Math.min(
      Math.max(1, Math.floor(element.clientHeight * 0.5)),
      Math.max(1, element.scrollHeight - element.clientHeight - 1),
    );
    const containerTop = element.getBoundingClientRect().top;
    const rows = Array.from(element.querySelectorAll<HTMLElement>('[data-virtual-row-key], .chat-message'));
    const row = rows.find((candidate) => candidate.getBoundingClientRect().bottom > containerTop);
    if (!row) return null;
    return {
      key: row.dataset.virtualRowKey || row.getAttribute('data-message-key') || '',
      offset: row.getBoundingClientRect().top - containerTop,
    };
  });
  expect(anchor?.key).toBeTruthy();

  await scroller.evaluate((element) => element.dispatchEvent(new Event('scroll')));
  if (EVIDENCE_SCREENSHOT_PATH) {
    await page.waitForTimeout(100);
    fs.mkdirSync(path.dirname(EVIDENCE_SCREENSHOT_PATH), { recursive: true });
    await page.screenshot({ path: EVIDENCE_SCREENSHOT_PATH, fullPage: false });
  }
  await expect.poll(async () => Number(await pane.getAttribute('data-history-revision')), {
    timeout: 500,
  }).toBeGreaterThan(initialRevision);

  const restoredOffset = await scroller.evaluate((element, anchorKey) => {
    /** Read the same row position after older blocks were inserted above it. */
    const row = Array.from(element.querySelectorAll<HTMLElement>('[data-virtual-row-key], .chat-message'))
      .find((candidate) => (
        candidate.dataset.virtualRowKey === anchorKey
        || candidate.getAttribute('data-message-key') === anchorKey
      ));
    if (!row) return null;
    return row.getBoundingClientRect().top - element.getBoundingClientRect().top;
  }, anchor?.key || '');
  expect(restoredOffset).not.toBeNull();
  expect(Math.abs(Number(restoredOffset) - Number(anchor?.offset))).toBeLessThanOrEqual(12);
  await expect.poll(async () => page.locator('[data-virtual-row-key]').count()).toBeLessThanOrEqual(150);
});
