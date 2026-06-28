// @ts-nocheck -- Playwright fixture typing is intentionally lightweight here.
/**
 * PURPOSE: Verify current-session message bookmarks through the real browser
 * app, real auth token, and existing Codex history fixtures.
 */
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import {
  PLAYWRIGHT_FIXTURE_AUTH_DB,
} from '../../../../tests/e2e/helpers/playwright-fixture.ts';

process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../../../backend/middleware/auth.ts'),
  import('../../../../backend/database/db.ts'),
]);

const LONG_SESSION_ID = 'fixture-mixed-long-virtual-session';
const EVIDENCE_DIR = path.join(process.cwd(), 'test-results', 'chat-message-bookmarks');

/**
 * Build a valid local auth token for the fixture user.
 */
function createLocalAuthToken() {
  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('No active user found for Playwright authentication');
  }
  return generateToken(user);
}

/**
 * Persist a small JSON evidence artifact under test-results for manual review.
 */
function writeEvidenceFile(fileName, payload) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, fileName), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

const AUTH_TOKEN = createLocalAuthToken();

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
  }, AUTH_TOKEN);
});

test('@navigation desktop bookmark click moves the target user message into view', async ({ page }) => {
  const messageRequests = [];
  await page.route(/\/api\/(?:projects\/.*\/sessions|codex\/sessions)\/.*\/messages.*/, async (route) => {
    messageRequests.push(route.request().url());
    await route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`/session/${LONG_SESSION_ID}`, { waitUntil: 'networkidle' });

  const bookmarkRoot = page.getByTestId('chat-message-bookmarks');
  await expect(bookmarkRoot).toBeVisible();
  await expect(page.getByTestId('chat-bookmark-desktop-list')).toBeVisible();

  const latestBookmark = page
    .getByTestId('chat-message-bookmark-item')
    .filter({ hasText: 'mixed long virtual history turn 1050' })
    .first();
  await expect(latestBookmark).toBeVisible();

  const summaryText = await latestBookmark.getByTestId('chat-message-bookmark-summary').innerText();
  expect(Array.from(summaryText).length).toBeLessThanOrEqual(50);
  expect(summaryText).toContain('mixed long virtual markdown turn 1050');

  await latestBookmark.click();
  const targetUserMessage = page
    .locator('.chat-message.user')
    .filter({ hasText: 'mixed long virtual history turn 1050' })
    .first();
  await expect(targetUserMessage).toBeInViewport();

  const unboundedRequests = messageRequests.filter((url) => {
    const parsedUrl = new URL(url);
    return !parsedUrl.searchParams.has('limit') && !parsedUrl.searchParams.has('afterLine');
  });
  expect(unboundedRequests).toEqual([]);

  writeEvidenceFile('network.json', { messageRequests, unboundedRequests });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'desktop.png'), fullPage: true });
});

test('@responsive mobile uses a bookmark trigger and panel instead of the desktop list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/session/${LONG_SESSION_ID}`, { waitUntil: 'networkidle' });

  await expect(page.getByTestId('chat-bookmark-desktop-list')).toBeHidden();
  const trigger = page.getByTestId('chat-bookmark-mobile-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();

  const panel = page.getByTestId('chat-bookmark-mobile-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('chat-message-bookmark-item').first()).toBeVisible();
  await expect(page.getByRole('textbox')).toBeVisible();

  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'mobile.png'), fullPage: true });
});

test('@performance long session keeps paginated loading and virtual DOM bounds', async ({ page }) => {
  const messageRequests = [];
  await page.route(/\/api\/(?:projects\/.*\/sessions|codex\/sessions)\/.*\/messages.*/, async (route) => {
    messageRequests.push(route.request().url());
    await route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`/session/${LONG_SESSION_ID}`, { waitUntil: 'networkidle' });

  await expect(page.getByTestId('chat-message-bookmarks')).toBeVisible();
  await expect
    .poll(async () => page.locator('.chat-message').count())
    .toBeLessThanOrEqual(150);

  const summaryLengths = await page.getByTestId('chat-message-bookmark-summary').evaluateAll((nodes) =>
    nodes.map((node) => Array.from(node.textContent || '').length),
  );
  expect(summaryLengths.length).toBeGreaterThan(0);
  expect(Math.max(...summaryLengths)).toBeLessThanOrEqual(50);

  const unboundedRequests = messageRequests.filter((url) => {
    const parsedUrl = new URL(url);
    return !parsedUrl.searchParams.has('limit') && !parsedUrl.searchParams.has('afterLine');
  });
  expect(unboundedRequests).toEqual([]);

  writeEvidenceFile('state.json', {
    chatMessageDomCount: await page.locator('.chat-message').count(),
    bookmarkSummaryLengths: summaryLengths,
  });
  writeEvidenceFile('network.json', { messageRequests, unboundedRequests });
});
