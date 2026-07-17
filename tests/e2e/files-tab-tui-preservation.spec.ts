/**
 * 文件目的：验证桌面文件辅助栏不会抢占会话 TUI 主视图。
 * 业务意义：用户查看项目文件时应保留当前终端上下文和连接。
 */
import { expect, test } from '@playwright/test';
import path from 'node:path';

process.env.DATABASE_PATH = path.join(process.env.HOME || '', '.ozw', 'auth.db');

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../backend/middleware/auth.ts'),
  import('../../backend/database/db.ts'),
]);

/** 为隔离的真实浏览器夹具创建本地认证令牌。 */
function createLocalAuthToken(): string {
  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('No active user found for Playwright authentication');
  }
  return generateToken(user);
}

const AUTH_TOKEN = createLocalAuthToken();

test.beforeEach(async ({ page }) => {
  /** 每次从无历史布局的已认证工作区开始，避免本地状态污染断言。 */
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
    window.localStorage.removeItem('ozw:workspace-layout:v1');
    window.localStorage.removeItem('activeTab');
  }, AUTH_TOKEN);
});

test('desktop files tab keeps the session TUI main view active', async ({ page }) => {
  /** 文件是辅助栏；打开它不能改写会话 TUI 的主视图状态。 */
  await page.goto('/workspace/fixture-project/c3', { waitUntil: 'networkidle' });

  await expect(page.getByTestId('tab-shell')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.xterm')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('tab-files').click();
  await page.screenshot({
    path: 'docs/debug/20260717-1720-files-tab-keeps-tui/screenshots/after-fix.png',
    fullPage: true,
  });

  await expect(page.getByTestId('dock-panel-right')).toBeVisible();
  await expect(page.getByTestId('tab-shell')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tab-chat')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.xterm')).toBeVisible();
});
