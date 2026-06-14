// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Regression tests for workspace dock resize direction and Git panel stability.
 * Exercises real project workspace behavior with mouse drags and tab switching.
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
   * Read the existing local test user and create a browser auth token.
   */
  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('No active user found for Playwright authentication');
  }
  return generateToken(user);
}

const AUTH_TOKEN = createLocalAuthToken();

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
    window.localStorage.removeItem('ozw:workspace-layout:v1');
    window.localStorage.removeItem('activeTab');
  }, AUTH_TOKEN);
});

async function openTestProject(page) {
  /**
   * Open the fixture workspace and enter the chat view that owns dock layout.
   */
  await page.goto('/workspace/fixture-project', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid^="tab-"]').first()).toBeVisible({ timeout: 10_000 });

  const sessionButton = page.locator('button', { hasText: /fixture-project manual-only session/ }).first();
  if (await sessionButton.isVisible().catch(() => false)) {
    await sessionButton.click();
    await page.waitForTimeout(300);
  }
}

async function openRightDock(page) {
  /**
   * Open the auxiliary files dock explicitly; desktop no longer opens it by default.
   */
  await page.locator('[data-testid="tab-files"]').click();
  await expect(page.locator('[data-testid="dock-panel-right"]')).toBeVisible();
}

async function openBottomDock(page) {
  /**
   * Open the terminal dock explicitly; desktop no longer opens it by default.
   */
  await page.locator('[data-testid="tab-shell"]').click();
  await expect(page.locator('[data-testid="dock-panel-bottom"]')).toBeVisible();
}

async function box(locator) {
  /**
   * Return a visible element bounding box or fail with a useful message.
   */
  const value = await locator.boundingBox();
  if (!value) {
    throw new Error('Expected locator to have a bounding box');
  }
  return value;
}

async function dragHandle(page, locator, deltaX, deltaY) {
  /**
   * Drag a resize handle by a pixel delta using the real mouse path.
   */
  const rect = await box(locator);
  const startX = rect.x + rect.width / 2;
  const startY = rect.y + rect.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

function expectNear(actual, expected, tolerance = 2) {
  /**
   * Compare layout pixels while allowing browser rounding differences.
   */
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

test('right dock drag direction follows the left boundary', async ({ page }) => {
  await openTestProject(page);
  await openRightDock(page);

  const rightDock = page.locator('[data-testid="dock-panel-right"]');
  const handle = page.locator('[data-testid="resize-handle-vertical"]');
  await expect(rightDock).toBeVisible();

  const initial = await box(rightDock);
  await dragHandle(page, handle, -80, 0);
  const wider = await box(rightDock);
  expect(wider.width).toBeGreaterThan(initial.width + 40);
  expect(wider.x).toBeLessThan(initial.x - 40);

  await dragHandle(page, handle, 60, 0);
  const narrower = await box(rightDock);
  expect(narrower.width).toBeLessThan(wider.width - 30);
  expect(narrower.width).toBeGreaterThanOrEqual(200);
  expect(narrower.x).toBeGreaterThan(180);
});

test('bottom dock drag direction follows the top boundary', async ({ page }) => {
  await openTestProject(page);
  await openBottomDock(page);

  const bottomDock = page.locator('[data-testid="dock-panel-bottom"]');
  const handle = page.locator('[data-testid="resize-handle-horizontal"]');
  await expect(bottomDock).toBeVisible();

  const initial = await box(bottomDock);
  await dragHandle(page, handle, 0, -70);
  const taller = await box(bottomDock);
  expect(taller.height).toBeGreaterThan(initial.height + 40);
  expect(taller.y).toBeLessThan(initial.y - 40);

  await dragHandle(page, handle, 0, 50);
  const shorter = await box(bottomDock);
  expect(shorter.height).toBeLessThan(taller.height - 25);
  expect(shorter.y).toBeGreaterThan(taller.y + 25);
  expect(shorter.height).toBeGreaterThanOrEqual(120);
});

test('reopening files keeps right dock size stable', async ({ page }) => {
  await openTestProject(page);
  await openRightDock(page);

  const rightDock = page.locator('[data-testid="dock-panel-right"]');
  const handle = page.locator('[data-testid="resize-handle-vertical"]');
  await dragHandle(page, handle, -90, 0);
  const filesBox = await box(rightDock);

  await page.locator('[data-testid="tab-files"]').click();
  await expect(rightDock).not.toBeVisible();
  await page.locator('[data-testid="tab-files"]').click();
  const reopenedBox = await box(rightDock);

  expectNear(reopenedBox.width, filesBox.width, 20);
  expectNear(reopenedBox.x, filesBox.x, 20);
  expect(reopenedBox.x).toBeGreaterThan(180);
});

test('repeated files dock toggling does not push into chat', async ({ page }) => {
  await openTestProject(page);
  await openRightDock(page);

  const rightDock = page.locator('[data-testid="dock-panel-right"]');
  const initial = await box(rightDock);

  for (let index = 0; index < 3; index += 1) {
    await page.locator('[data-testid="tab-files"]').click();
    await page.waitForTimeout(100);
    await page.locator('[data-testid="tab-files"]').click();
    await page.waitForTimeout(100);
  }

  const finalBox = await box(rightDock);
  expect(finalBox.width).toBeLessThanOrEqual(initial.width + 20);
  expect(finalBox.x).toBeGreaterThan(250);
});

test('bottom terminal fullscreen still exits back to bottom dock', async ({ page }) => {
  await openTestProject(page);
  await openBottomDock(page);

  const bottomDock = page.locator('[data-testid="dock-panel-bottom"]');
  await expect(bottomDock).toBeVisible();

  await bottomDock.locator('[data-testid="dock-panel-header"] button[title="全屏"]').first().click();
  await expect(bottomDock).not.toBeVisible();

  await page.locator('button[aria-label="退出全屏"]').first().click();
  await expect(bottomDock).toBeVisible();
});
