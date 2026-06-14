// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify mobile session history states, scrolling, and composer visibility.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

process.env.DATABASE_PATH = path.join(process.env.HOME || '', '.ozw', 'auth.db');

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../../backend/middleware/auth.ts'),
  import('../../../backend/database/db.ts'),
]);

function createLocalAuthToken() {
  /**
   * Create a browser token from the local test user.
   */
  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('No active user found for Playwright authentication');
  }
  return generateToken(user);
}

const AUTH_TOKEN = createLocalAuthToken();

test.use({ viewport: { width: 390, height: 720 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
    window.localStorage.removeItem('ozw:workspace-layout:v1');
    window.localStorage.removeItem('activeTab');
  }, AUTH_TOKEN);
});

function buildHistoryMessages(count) {
  /**
   * Build a deterministic provider transcript that is tall enough to require scrolling.
   */
  return Array.from({ length: count }, (_, index) => {
    const role = index % 2 === 0 ? 'user' : 'assistant';
    return {
      timestamp: new Date(Date.UTC(2026, 4, 11, 8, 0, index)).toISOString(),
      messageKey: `mobile-history-${index}`,
      message: {
        role,
        content: `${role === 'user' ? '用户' : '助手'}移动端历史消息 ${index + 1} `.repeat(3),
      },
    };
  });
}

async function mockSessionMessages(page, payload, status = 200) {
  /**
   * Serve session messages from a fixture so the test does not depend on local chat history.
   */
  await page.route('**/messages?**', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

async function openMobileSession(page) {
  /**
   * Open the fixture project and enter a real session route in the mobile single-view shell.
   */
  await page.goto('/workspace/fixture-project/c3', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="mobile-workspace-chat"]')).toBeVisible();
}

async function expectComposerInViewport(page) {
  /**
   * Assert the composer remains visible and editable inside the mobile viewport.
   */
  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeEditable();

  const bottom = await textarea.evaluate((node) => node.getBoundingClientRect().bottom);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(bottom).toBeLessThanOrEqual(viewportHeight);
}

test('mobile long session scrolls inside transcript while composer stays visible', async ({ page }) => {
  await mockSessionMessages(page, {
    messages: buildHistoryMessages(80),
    total: 80,
    hasMore: false,
  });
  await openMobileSession(page);

  const scrollContainer = page.locator('[data-testid="chat-scroll-container"]');
  await expect(scrollContainer.getByText('助手移动端历史消息 80')).toBeVisible({ timeout: 10_000 });

  const metrics = await scrollContainer.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    scrollTop: node.scrollTop,
  }));
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

  await scrollContainer.evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.waitForTimeout(50);
  await scrollContainer.evaluate((node) => {
    node.scrollTop = Math.floor(node.scrollHeight / 2);
  });
  const movedTop = await scrollContainer.evaluate((node) => node.scrollTop);
  expect(movedTop).toBeGreaterThan(0);
  await expectComposerInViewport(page);
});

test('mobile existing session renders history and empty state without blank content', async ({ page }) => {
  await mockSessionMessages(page, {
    messages: buildHistoryMessages(2),
    total: 2,
    hasMore: false,
  });
  await openMobileSession(page);
  await expect(page.getByText('助手移动端历史消息 2')).toBeVisible({ timeout: 10_000 });
  await expectComposerInViewport(page);

  await page.unroute('**/messages?**');
  await mockSessionMessages(page, { messages: [], total: 0, hasMore: false });
  await page.reload({ waitUntil: 'networkidle' });
  await openMobileSession(page);
  await expect(page.locator('[data-testid="chat-empty-session-state"]')).toBeVisible({ timeout: 10_000 });
  await expectComposerInViewport(page);
});

test('mobile message load failure shows an explicit error state', async ({ page }) => {
  await mockSessionMessages(page, { error: 'fixture failure' }, 500);
  await openMobileSession(page);

  await expect(page.locator('[data-testid="chat-session-load-error"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="chat-empty-session-state"]')).toHaveCount(0);
  await expectComposerInViewport(page);
});
