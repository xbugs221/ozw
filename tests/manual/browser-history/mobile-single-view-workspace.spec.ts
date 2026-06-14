// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify workspace dock layout behavior.
 * Tests default layout, tab clicks, collapse/resize/fullscreen, and persistence.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

process.env.DATABASE_PATH = path.join(process.env.HOME || '', '.ozw', 'auth.db');

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../../backend/middleware/auth.ts'),
  import('../../../backend/database/db.ts'),
]);

function createLocalAuthToken() {
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
  }, AUTH_TOKEN);
});

async function openTestProject(page) {
  await page.goto('/workspace/fixture-project', { waitUntil: 'networkidle' });
  // Wait for project to load
  await expect(page.locator('[data-testid^="tab-"]').first()).toBeVisible({ timeout: 10_000 });

  // Click on a session to enter the chat workspace with dock layout
  const sessionButton = page.locator('button', { hasText: /fixture-project manual-only session/ }).first();
  if (await sessionButton.isVisible().catch(() => false)) {
    await sessionButton.click();
    // Wait for chat workspace to load
    await page.waitForTimeout(500);
  }
}

async function clickTab(page, tabName) {
  const tab = page.locator(`[data-testid="tab-${tabName}"]`);
  await tab.click();
  return tab;
}

test.describe('workspace dock layout', () => {
  test('default layout keeps auxiliary docks closed', async ({ page }) => {
    await openTestProject(page);

    await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.locator('[data-testid="dock-panel-right"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="dock-panel-bottom"]')).not.toBeVisible();
  });

  test('clicking files toggles right dock while chat stays active', async ({ page }) => {
    await openTestProject(page);

    await clickTab(page, 'files');

    // Right dock should be visible with chat remaining the main tab.
    await expect(page.locator('[data-testid="dock-panel-right"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-chat"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="tab-files"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('source control tab is no longer exposed in the workspace header', async ({ page }) => {
    await openTestProject(page);

    await expect(page.locator('[data-testid="tab-files"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-shell"]')).toBeVisible();
    await expect(page.locator(`[data-testid="tab-${'git'}"]`)).toHaveCount(0);
  });

  test('files dock opens without becoming the main tab', async ({ page }) => {
    await openTestProject(page);

    await clickTab(page, 'files');
    await expect(page.locator('[data-testid="dock-panel-right"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-files"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="tab-chat"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('clicking terminal toggles bottom dock collapse', async ({ page }) => {
    await openTestProject(page);

    // First click shell opens the closed bottom dock.
    await clickTab(page, 'shell');
    await expect(page.locator('[data-testid="dock-panel-bottom"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-chat"]')).toHaveAttribute('aria-pressed', 'true');

    // Second click shell collapses it without hiding chat.
    await clickTab(page, 'shell');
    await expect(page.locator('[data-testid="dock-panel-bottom"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="tab-chat"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('resize handles are present and interactive', async ({ page }) => {
    await openTestProject(page);
    await clickTab(page, 'files');
    await clickTab(page, 'shell');

    const rightHandle = page.locator('[data-testid="resize-handle-vertical"]');
    const bottomHandle = page.locator('[data-testid="resize-handle-horizontal"]');

    await expect(rightHandle).toBeVisible();
    await expect(bottomHandle).toBeVisible();
  });

  test('layout persists after page refresh', async ({ page }) => {
    await openTestProject(page);
    await clickTab(page, 'files');

    // Collapse right dock by clicking the active files tab.
    const rightDock = page.locator('[data-testid="dock-panel-right"]');
    await expect(rightDock).toBeVisible();

    await page.locator('[data-testid="tab-files"]').click();

    // Wait a moment for state to update
    await page.waitForTimeout(300);

    // Refresh page
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-testid^="tab-"]').first()).toBeVisible({ timeout: 10_000 });

    // Right dock should still be collapsed (not visible)
    await expect(page.locator('[data-testid="dock-panel-right"]')).not.toBeVisible();
  });

  test('corrupted layout state falls back to default', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('ozw:workspace-layout:v1', 'invalid-json{{');
    });

    await openTestProject(page);

    await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
    await expect(page.locator('[data-testid="dock-panel-right"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="dock-panel-bottom"]')).not.toBeVisible();
  });

  test('old activeTab state is migrated to dock layout', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('activeTab', 'files');
      window.localStorage.removeItem('ozw:workspace-layout:v1');
    });

    await openTestProject(page);

    // Legacy main tab state must not force auxiliary docks open by default.
    await expect(page.locator('[data-testid="dock-panel-right"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="tab-chat"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="tab-files"]')).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('mobile workspace layout', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('mobile defaults to chat without desktop dock or overlay controls', async ({ page }) => {
    await openTestProject(page);

    await expect(page.locator('[data-testid="mobile-workspace-chat"]')).toBeVisible();
    await expect(page.locator('[data-testid="project-workspace-overview"]')).toBeVisible();
    await expect(page.locator('[data-testid="dock-panel-right"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="dock-panel-bottom"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="resize-handle-vertical"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="resize-handle-horizontal"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="mobile-overlay-close"]')).toHaveCount(0);
  });

  test('mobile switches between files, terminal, and chat as single views', async ({ page }) => {
    await openTestProject(page);

    await clickTab(page, 'files');
    await expect(page.locator('[data-testid="mobile-workspace-files"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-files"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="dock-panel-right"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="mobile-overlay-close"]')).toHaveCount(0);
    await expect(page.getByText('SUMMARY.md').first()).toBeVisible();

    await clickTab(page, 'shell');
    await expect(page.locator('[data-testid="mobile-workspace-shell"]')).toBeVisible();
    await expect(page.locator('.xterm')).toBeVisible();
    await expect(page.locator('[data-testid="dock-panel-bottom"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '移动终端' })).toHaveCount(0);

    await clickTab(page, 'chat');
    await expect(page.locator('[data-testid="mobile-workspace-chat"]')).toBeVisible();
    await expect(page.locator('[data-testid="project-workspace-overview"]')).toBeVisible();
  });

  test('mobile keeps file editor inside the files view after opening a file', async ({ page }) => {
    await openTestProject(page);

    await clickTab(page, 'files');
    await page.getByText('SUMMARY.md').first().click();

    await expect(page.locator('[data-testid="mobile-workspace-files"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-files"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('SUMMARY.md').first()).toBeVisible();
    await expect(page.locator('[data-testid="chat-scroll-container"]')).toHaveCount(0);
  });

  test('mobile sidebar add-project folder browser opens without a blank overlay', async ({ page }) => {
    await openTestProject(page);

    await page.getByLabel('Open menu').click();
    await page.locator('[data-testid="create-project"]:visible').click();
    await page.getByRole('button', { name: /Next|下一步/ }).click();
    await page.getByTitle('Browse folders').click();

    await expect(page.getByText('Select Folder')).toBeVisible();
    await expect(page.getByRole('button', { name: /Use this folder|使用此文件夹/ })).toBeVisible();
  });
});

test.describe('workspace dock fullscreen and terminal move', () => {
  test('right dock fullscreen toggle', async ({ page }) => {
    await openTestProject(page);
    await clickTab(page, 'files');

    // Right dock should be visible
    await expect(page.locator('[data-testid="dock-panel-right"]')).toBeVisible();

    // Click fullscreen button on right dock
    const fullscreenButton = page.locator('[data-testid="dock-panel-right"] button[title="全屏"]').first();
    await fullscreenButton.click();

    // After fullscreen, the dock panel should occupy the whole area
    // The original right dock structure won't be present; instead we see fullscreen view
    await expect(page.locator('[data-testid="dock-panel-right"]')).not.toBeVisible();

    // Exit fullscreen
    const exitFullscreenButton = page.locator('button[aria-label="退出全屏"]').first();
    await exitFullscreenButton.click();

    // Right dock should be back
    await expect(page.locator('[data-testid="dock-panel-right"]')).toBeVisible();
  });

  test('bottom dock fullscreen toggle', async ({ page }) => {
    await openTestProject(page);
    await clickTab(page, 'shell');

    // Bottom dock should be visible
    await expect(page.locator('[data-testid="dock-panel-bottom"]')).toBeVisible();

    // Click fullscreen button on bottom dock
    const fullscreenButton = page.locator('[data-testid="dock-panel-bottom"] button[title="全屏"]').first();
    await fullscreenButton.click();

    // After fullscreen, the dock panel should occupy the whole area
    await expect(page.locator('[data-testid="dock-panel-bottom"]')).not.toBeVisible();

    // Exit fullscreen
    const exitFullscreenButton = page.locator('button[aria-label="退出全屏"]').first();
    await exitFullscreenButton.click();

    // Bottom dock should be back
    await expect(page.locator('[data-testid="dock-panel-bottom"]')).toBeVisible();
  });

  test('terminal move between bottom and right split', async ({ page }) => {
    await openTestProject(page);
    await clickTab(page, 'files');
    await clickTab(page, 'shell');

    // Bottom dock should be visible by default
    await expect(page.locator('[data-testid="dock-panel-bottom"]')).toBeVisible();

    // Right dock should also be visible
    await expect(page.locator('[data-testid="dock-panel-right"]')).toBeVisible();

    // Click "move terminal to right" button on bottom dock
    const moveToRightButton = page.locator('[data-testid="dock-panel-bottom"] button[title="移动终端"]').first();
    await moveToRightButton.click();

    // Bottom dock should disappear
    await expect(page.locator('[data-testid="dock-panel-bottom"]')).not.toBeVisible();

    // Right dock should still be visible (now with split)
    await expect(page.locator('[data-testid="dock-panel-right"]')).toBeVisible();
    await expect(page.locator('[data-testid="dock-panel-right"]').getByRole('button', { name: '新建终端' })).toBeVisible();
    await expect(page.locator('[data-testid="dock-panel-right"]').getByRole('button', { name: '删除终端' })).toBeVisible();

    // Click "move terminal to bottom" button on right dock
    const moveToBottomButton = page.locator('[data-testid="dock-panel-right"] button[title="移动终端"]').first();
    await moveToBottomButton.click();

    // Bottom dock should reappear
    await expect(page.locator('[data-testid="dock-panel-bottom"]')).toBeVisible();

    // Right dock should still be visible
    await expect(page.locator('[data-testid="dock-panel-right"]')).toBeVisible();
  });
});
