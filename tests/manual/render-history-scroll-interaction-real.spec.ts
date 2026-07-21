/**
 * PURPOSE: Verify the real Render transcript respects user scrolling while
 * an older history page is still loading.
 */
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const REAL_SESSION_URL = process.env.OZW_REAL_SCROLL_URL
  || 'http://localhost:4001/projects/matsci_proj/rescu/c8';
const SCREENSHOT_PATH = path.join(
  process.cwd(),
  'docs/debug/20260721-1421-loading-scroll-jump/screenshots/fixed-user-scroll-preserved.png',
);
const RECORDING_PATH = path.join(
  process.cwd(),
  'docs/debug/20260721-1421-loading-scroll-jump/scroll-after-restart-verified.webm',
);
const SCROLL_STATE_PATH = path.join(
  process.cwd(),
  'docs/debug/20260721-1421-loading-scroll-jump/scroll-after-restart-state.json',
);

test('加载旧消息期间用户的新滚动位置优先', async ({ browser }) => {
  /** Exercise the exact reported route with its real transcript and history API. */
  const videoDirectory = path.join(process.cwd(), '.tmp/playwright-scroll-video');
  fs.mkdirSync(videoDirectory, { recursive: true });
  const context = await browser.newContext({
    recordVideo: { dir: videoDirectory, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const recording = page.video();
  const initialHistory = page.waitForResponse((response) => {
    /** Wait for the transcript state used to build the explicit Render snapshot. */
    const url = new URL(response.url());
    return url.pathname.includes('/messages') && url.searchParams.get('offset') === '0';
  });
  await page.goto(REAL_SESSION_URL, { waitUntil: 'domcontentloaded' });
  await initialHistory;
  await page.getByTestId('tab-chat').click();
  await expect(page.getByTestId('chat-tui-panel')).toBeVisible();
  await page.getByTestId('tab-shell').click();
  await expect(page.getByTestId('tab-shell')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('tab-chat').click();
  await expect(page.getByTestId('chat-rendered-snapshot-pane')).toBeVisible();

  const scrollContainer = page.getByTestId('chat-scroll-container');
  const isOlderPage = (requestUrl: string): boolean => {
    /** Identify bounded history pages after the initial Render window. */
    const url = new URL(requestUrl);
    return url.pathname.includes('/messages')
      && url.searchParams.get('limit') === '50'
      && Number(url.searchParams.get('offset')) >= 50;
  };
  await page.route(/\/api\/(?:projects\/.*\/sessions|codex\/sessions)\/.*\/messages.*/, async (route) => {
    /** Delay, but never replace, the real backend response. */
    if (isOlderPage(route.request().url())) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await route.continue();
  });

  const olderRequest = page.waitForRequest((request) => isOlderPage(request.url()));
  const olderResponse = page.waitForResponse((response) => isOlderPage(response.url()));
  await scrollContainer.hover();
  const triggerTop = await scrollContainer.evaluate((element) => {
    /** Enter the one-viewport prefetch zone and start the real older-page request. */
    element.scrollTop = Math.min(160, Math.max(1, element.scrollHeight - element.clientHeight - 1));
    element.dispatchEvent(new Event('scroll'));
    return element.scrollTop;
  });
  await page.waitForTimeout(25);
  await page.mouse.wheel(0, 800);
  await expect
    .poll(async () => scrollContainer.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(triggerTop + 200);
  const userChosenTop = await scrollContainer.evaluate((element) => element.scrollTop);

  await olderRequest;
  const completedOlderResponse = await olderResponse;
  expect(completedOlderResponse.ok()).toBe(true);
  await page.waitForTimeout(500);
  const settledTop = await scrollContainer.evaluate((element) => element.scrollTop);
  expect(settledTop).toBeGreaterThan(triggerTop + 200);
  expect(Math.abs(settledTop - userChosenTop)).toBeLessThanOrEqual(80);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(100);
  const afterFinalUp = await scrollContainer.evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, 360);
  await page.waitForTimeout(400);
  await expect.poll(async () => scrollContainer.evaluate((element) => element.scrollTop)).toBeGreaterThan(afterFinalUp);
  const finalTop = await scrollContainer.evaluate((element) => element.scrollTop);
  fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });
  fs.writeFileSync(SCROLL_STATE_PATH, `${JSON.stringify({
    triggerTop,
    userChosenTop,
    settledTop,
    afterFinalUp,
    finalTop,
    olderHistoryStatus: completedOlderResponse.status(),
  }, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
  await context.close();
  if (recording) {
    await recording.saveAs(RECORDING_PATH);
  }
});
