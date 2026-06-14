// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify desktop workspace tabs control docks without hiding chat,
 * terminal instances can be created/deleted, and ordinary sessions stay stable.
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
   * Create the same local auth token used by the browser fixture tests.
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

async function openFixtureSession(page) {
  /**
   * Open a real fixture project session inside the desktop dock workspace.
   */
  await page.goto('/workspace/fixture-project', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="workspace-dock-layout"]')).toBeVisible({ timeout: 10_000 });

  const sessionButton = page.locator('button', { hasText: /fixture-project manual-only session/ }).first();
  if (await sessionButton.isVisible().catch(() => false)) {
    await sessionButton.click();
  }

  await expect(page.locator('[data-testid="workspace-dock-layout"]')).toBeVisible({ timeout: 10_000 });
}

async function expectChatVisible(page) {
  /**
   * Assert the central chat surface is still present after dock operations.
   */
  await expect(page.locator('[data-testid="workspace-dock-layout"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab-chat"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByPlaceholder('Type your message...')).toBeVisible();
}

test('desktop defaults to chat even with legacy dock activeTab state', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('activeTab', 'shell');
  });

  await openFixtureSession(page);

  await expect(page.locator('[data-testid="tab-chat"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="tab-files"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-testid="tab-shell"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator(`[data-testid="tab-${'git'}"]`)).toHaveCount(0);
});

test('desktop dock buttons keep chat visible while opening files and terminal', async ({ page }) => {
  await openFixtureSession(page);

  await page.locator('[data-testid="tab-files"]').click();
  await expect(page.locator('[data-testid="dock-panel-right"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab-files"]')).toHaveAttribute('aria-pressed', 'true');
  await expectChatVisible(page);

  await page.locator('[data-testid="tab-shell"]').click();
  await expect(page.locator('[data-testid="dock-panel-bottom"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab-shell"]')).toHaveAttribute('aria-pressed', 'true');
  await expectChatVisible(page);

  await page.locator('[data-testid="tab-shell"]').click();
  await expect(page.locator('[data-testid="dock-panel-bottom"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="tab-shell"]')).toHaveAttribute('aria-pressed', 'false');
  await expectChatVisible(page);

  await page.locator('[data-testid="tab-files"]').click();
  await expect(page.locator('[data-testid="dock-panel-right"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab-files"]')).toHaveAttribute('aria-pressed', 'true');
  await expectChatVisible(page);
});

test('desktop session keeps chat visible with stale dock activeTab and fullscreen dock state', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('activeTab', 'files');
    window.localStorage.setItem('ozw:workspace-layout:v1', JSON.stringify({
      rightDock: {
        activePanel: 'files',
        collapsed: false,
        width: 360,
        fullscreen: true,
        split: null,
      },
      bottomDock: {
        activePanel: 'terminal',
        collapsed: false,
        height: 260,
        fullscreen: false,
      },
    }));
  });

  await page.goto('/workspace/fixture-project', { waitUntil: 'networkidle' });
  await page.locator('[data-testid="tab-files"]').click();

  const sessionButton = page.locator('button', { hasText: /fixture-project manual-only session/ }).first();
  await expect(sessionButton).toBeVisible();
  await sessionButton.click();

  await expectChatVisible(page);
});

test('ordinary session does not reload or poll projects every second', async ({ page }) => {
  let projectRequests = 0;
  await page.route('**/api/projects', async (route) => {
    projectRequests += 1;
    await route.continue();
  });

  await openFixtureSession(page);
  const requestsAfterOpen = projectRequests;
  const navigationCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);

  await page.waitForTimeout(3200);

  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(navigationCount);
  expect(projectRequests - requestsAfterOpen).toBeLessThanOrEqual(1);
  await expectChatVisible(page);
});

test('terminal dock hides shell controls and supports create and delete', async ({ page }) => {
  await openFixtureSession(page);
  await page.locator('[data-testid="tab-shell"]').click();

  const bottomDock = page.locator('[data-testid="dock-panel-bottom"]');
  await expect(bottomDock).toBeVisible();
  await expect(bottomDock.getByText(/断开连接|断开链接|重启/)).toHaveCount(0);
  await expect(bottomDock.locator('.xterm')).toBeVisible();

  await bottomDock.getByRole('button', { name: '新建终端' }).click();
  await expect(bottomDock.locator('[data-testid="terminal-instance"]')).toHaveCount(2);
  await expectChatVisible(page);

  await bottomDock.getByRole('button', { name: '删除终端' }).click();
  await expect(bottomDock.locator('[data-testid="terminal-instance"]')).toHaveCount(1);

  await bottomDock.getByRole('button', { name: '删除终端' }).click();
  await expect(bottomDock.locator('[data-testid="terminal-empty-state"]')).toBeVisible();
  await expectChatVisible(page);
});

test('terminal controls remain available after moving terminal to right split', async ({ page }) => {
  await openFixtureSession(page);
  await page.locator('[data-testid="tab-files"]').click();
  await page.locator('[data-testid="tab-shell"]').click();

  const bottomDock = page.locator('[data-testid="dock-panel-bottom"]');
  await expect(bottomDock).toBeVisible();
  await bottomDock.getByRole('button', { name: '移动终端' }).click();

  const rightDock = page.locator('[data-testid="dock-panel-right"]');
  await expect(bottomDock).not.toBeVisible();
  await expect(rightDock).toBeVisible();
  await expect(rightDock.locator('[data-testid="terminal-instance"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="tab-shell"]')).toHaveAttribute('aria-pressed', 'true');

  await rightDock.getByRole('button', { name: '新建终端' }).click();
  await expect(rightDock.locator('[data-testid="terminal-instance"]')).toHaveCount(2);

  await rightDock.getByRole('button', { name: '删除终端' }).click();
  await expect(rightDock.locator('[data-testid="terminal-instance"]')).toHaveCount(1);
  await expectChatVisible(page);
});

test('file dock shows one file title and keeps file actions available', async ({ page }) => {
  await openFixtureSession(page);
  await page.locator('[data-testid="tab-files"]').click();

  const rightDock = page.locator('[data-testid="dock-panel-right"]');
  await expect(rightDock).toBeVisible();
  await expect(rightDock.getByText('文件', { exact: true })).toHaveCount(1);
  await expect(rightDock.getByPlaceholder(/Search|搜索/)).toBeVisible();
  await expect(rightDock.getByRole('button', { name: /^Add File$|新建文件/ })).toHaveCount(0);
  await expect(rightDock.getByRole('button', { name: /^Add Folder$|新建文件夹/ })).toHaveCount(0);
  await expect(rightDock.getByRole('button', { name: /^Upload$/ })).toBeVisible();
  await expect(rightDock.getByRole('button', { name: /^Upload Files$|上传文件/ })).toHaveCount(0);
  await expect(rightDock.getByRole('button', { name: /^Upload Folder$|上传文件夹/ })).toHaveCount(0);
  await expect(rightDock.getByRole('button', { name: /Reload|刷新/ })).toBeVisible();
  await expect(rightDock.getByRole('button', { name: /Collapse All|折叠/ })).toBeVisible();
});
