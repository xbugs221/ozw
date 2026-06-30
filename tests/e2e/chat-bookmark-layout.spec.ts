// @ts-nocheck -- Playwright fixture auth imports are runtime-bound.
/**
 * PURPOSE: Verify chat message bookmarks live in the top workspace tab group
 * without creating a desktop gutter or sitting beside the mobile composer.
 */
import { test, expect } from '@playwright/test';
import {
  PLAYWRIGHT_FIXTURE_AUTH_DB,
  PLAYWRIGHT_FIXTURE_SESSION_IDS,
} from './helpers/playwright-fixture.ts';

process.env.DATABASE_PATH = PLAYWRIGHT_FIXTURE_AUTH_DB;

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../backend/middleware/auth.ts'),
  import('../../backend/database/db.ts'),
]);

const HISTORY_SCROLL_PROJECT_INDEX = 5;
const HISTORY_SCROLL_SESSION_ID = PLAYWRIGHT_FIXTURE_SESSION_IDS[HISTORY_SCROLL_PROJECT_INDEX];

/**
 * Build a valid auth token for the isolated Playwright user.
 */
function createLocalAuthToken() {
  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('No active user found for Playwright authentication');
  }

  return generateToken(user);
}

/**
 * Open the long fixture session so message bookmarks are available.
 */
async function openBookmarkFixture(page) {
  await page.goto(`/session/${HISTORY_SCROLL_SESSION_ID}`, { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('history scroll fixture session assistant turn 80');
}

/**
 * Return a visible element box with an explicit failure label.
 */
async function visibleBox(locator, label) {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).toBeTruthy();
  return box;
}

const AUTH_TOKEN = createLocalAuthToken();

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
  }, AUTH_TOKEN);
});

test('desktop bookmark trigger stays in the top tab group before the chat tab', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBookmarkFixture(page);

  const transcriptBox = await visibleBox(page.getByTestId('chat-scroll-container').last(), 'chat transcript');
  const triggerBox = await visibleBox(page.getByTestId('chat-bookmark-trigger'), 'desktop bookmark trigger');
  const chatTabBox = await visibleBox(page.getByTestId('tab-chat'), 'chat tab');

  expect(triggerBox.width).toBeLessThanOrEqual(44);
  expect(triggerBox.height).toBeLessThanOrEqual(44);
  expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(chatTabBox.x + 1);
  expect(triggerBox.y).toBeLessThan(transcriptBox.y);
});

test('mobile bookmark trigger stays in the top tab group instead of beside composer submit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBookmarkFixture(page);

  const transcriptBox = await visibleBox(page.getByTestId('chat-scroll-container').last(), 'mobile chat transcript');
  const triggerBox = await visibleBox(page.getByTestId('chat-bookmark-trigger'), 'mobile bookmark trigger');
  const chatTabBox = await visibleBox(page.getByTestId('tab-chat'), 'mobile chat tab');
  const textareaBox = await visibleBox(page.locator('textarea[placeholder]').first(), 'mobile composer textarea');

  expect(triggerBox.width).toBeLessThanOrEqual(44);
  expect(triggerBox.height).toBeLessThanOrEqual(44);
  expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(chatTabBox.x + 1);
  expect(triggerBox.y).toBeLessThan(transcriptBox.y);
  expect(triggerBox.y + triggerBox.height).toBeLessThan(textareaBox.y - 24);

  await page.getByTestId('chat-bookmark-trigger').click();
  const panelBox = await visibleBox(page.getByTestId('chat-bookmark-panel'), 'mobile bookmark panel');
  expect(panelBox.y + panelBox.height).toBeLessThan(textareaBox.y - 8);
});
