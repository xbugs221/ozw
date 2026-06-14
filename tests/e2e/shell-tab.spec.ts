// @ts-nocheck -- Test typing: parameter annotations pending.
/**
 * PURPOSE: Verify the main shell tab opens an embedded plain terminal without duplicate shell controls.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

process.env.DATABASE_PATH = path.join(process.env.HOME || '', '.ozw', 'auth.db');

const [{ generateToken }, { userDb }] = await Promise.all([
  import('../../backend/middleware/auth.ts'),
  import('../../backend/database/db.ts'),
]);

/**
 * Build a valid local auth token for the first active user.
 *
 * @returns {string}
 */
function createLocalAuthToken() {
  const user = userDb.getFirstUser();
  if (!user) {
    throw new Error('No active user found for Playwright authentication');
  }

  return generateToken(user);
}

const AUTH_TOKEN = createLocalAuthToken();

test.beforeEach(async ({ page }: { page: any }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
    window.localStorage.removeItem('ozw:workspace-layout:v1');
    window.localStorage.removeItem('activeTab');
    window.__sentShellInputData = [];

    const NativeWebSocket = window.WebSocket;
    class TrackedWebSocket extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        window.__trackedSockets = window.__trackedSockets || [];
        window.__trackedSockets.push(this);
      }

      send(data) {
        try {
          const message = typeof data === 'string' ? JSON.parse(data) : null;
          if (typeof this.url === 'string' && this.url.includes('/shell') && message?.type === 'input') {
            window.__sentShellInputData.push(message.data);
          }
        } catch {
          // Ignore non-JSON websocket payloads.
        }

        return super.send(data);
      }
    }

    Object.setPrototypeOf(TrackedWebSocket, NativeWebSocket);
    window.WebSocket = TrackedWebSocket;
  }, AUTH_TOKEN);
});

/**
 * Open the target project so the shell tab can be exercised against a stable workspace.
 *
 * @param {import('@playwright/test').Page} page
 */
async function openShellProject(page) {
  await page.goto('/workspace/fixture-project', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: /^Shell$|^终端$/ })).toBeVisible({ timeout: 10_000 });
}

/**
 * Wait until the embedded shell has an open websocket for terminal input.
 *
 * @param {import('@playwright/test').Page} page
 */
async function waitForOpenShellSocket(page) {
  await page.waitForFunction(
    () => {
      const sockets = window.__trackedSockets || [];
      return sockets.some((socket) => typeof socket.url === 'string' && socket.url.includes('/shell') && socket.readyState === 1);
    },
    { timeout: 15_000 },
  );
}

test('shell tab uses embedded plain shell without disconnect or restart controls', async ({ page }: { page: any }) => {
  await openShellProject(page);

  const bottomDock = page.locator('[data-testid="dock-panel-bottom"]');
  if (!(await bottomDock.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /^Shell$|^终端$/ }).click();
  }

  await expect(bottomDock).toBeVisible({ timeout: 10_000 });
  await expect(bottomDock.locator('.xterm')).toBeVisible({ timeout: 10_000 });
  await expect(bottomDock).not.toContainText(/Resume session|恢复会话/);
  await expect(bottomDock).not.toContainText(/Disconnect|断开连接|Restart|重启/);

  await bottomDock.getByRole('button', { name: '新建终端' }).click();
  await expect(bottomDock.locator('[data-testid="terminal-instance"]')).toHaveCount(2);
});

test('desktop terminal fullscreen keeps the running shell mounted and fills the workspace', async ({ page }: { page: any }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openShellProject(page);

  const bottomDock = page.locator('[data-testid="dock-panel-bottom"]');
  if (!(await bottomDock.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /^Shell$|^终端$/ }).click();
  }

  await expect(bottomDock.locator('.xterm')).toBeVisible({ timeout: 10_000 });
  await waitForOpenShellSocket(page);
  const shellSocketCountBefore = await page.evaluate(() => {
    const sockets = window.__trackedSockets || [];
    return sockets.filter((socket) => typeof socket.url === 'string' && socket.url.includes('/shell')).length;
  });

  await bottomDock.getByRole('button', { name: '全屏' }).click();
  await expect(bottomDock.getByRole('button', { name: '退出全屏' })).toBeVisible();
  await expect(bottomDock.locator('.xterm')).toBeVisible();

  const fullscreenBox = await bottomDock.boundingBox();
  expect(fullscreenBox?.width).toBeGreaterThan(1000);
  expect(fullscreenBox?.height).toBeGreaterThan(650);
  await page.waitForTimeout(300);
  await expect.poll(async () => page.evaluate(() => {
    const sockets = window.__trackedSockets || [];
    return sockets.filter((socket) => typeof socket.url === 'string' && socket.url.includes('/shell')).length;
  })).toBe(shellSocketCountBefore);
});

test('deleting the last desktop terminal collapses the terminal dock', async ({ page }: { page: any }) => {
  await openShellProject(page);

  const bottomDock = page.locator('[data-testid="dock-panel-bottom"]');
  if (!(await bottomDock.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /^Shell$|^终端$/ }).click();
  }

  await expect(bottomDock.locator('.xterm')).toBeVisible({ timeout: 10_000 });
  await bottomDock.getByRole('button', { name: '删除终端' }).click();
  await expect(bottomDock).not.toBeVisible();
  await expect(page.locator('[data-testid="tab-shell"]')).toHaveAttribute('aria-pressed', 'false');
});

test('deleting the last terminal from the right split removes the terminal pane', async ({ page }: { page: any }) => {
  await openShellProject(page);
  await page.getByRole('button', { name: /^Files$|^文件$/ }).click();
  await page.getByRole('button', { name: /^Shell$|^终端$/ }).click();

  const bottomDock = page.locator('[data-testid="dock-panel-bottom"]');
  await expect(bottomDock.locator('.xterm')).toBeVisible({ timeout: 10_000 });
  await bottomDock.getByRole('button', { name: '移动终端' }).click();

  const rightDock = page.locator('[data-testid="dock-panel-right"]');
  await expect(rightDock.locator('[data-testid="terminal-instance"]')).toHaveCount(1);
  await rightDock.getByRole('button', { name: '删除终端' }).click();
  await expect(rightDock.locator('[data-testid="terminal-instance"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="tab-shell"]')).toHaveAttribute('aria-pressed', 'false');
});

test('mobile shell helper keys send escape tab arrows and held ctrl arrow input', async ({ page }: { page: any }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openShellProject(page);
  await page.getByRole('button', { name: /^Shell$|^终端$/ }).click();

  await waitForOpenShellSocket(page);
  const keybar = page.getByTestId('shell-mobile-keybar');
  await expect(keybar).toBeVisible({ timeout: 10_000 });
  await expect(keybar.getByRole('button')).toHaveCount(7);

  await page.getByTestId('shell-mobile-key-escape').click();
  await page.getByTestId('shell-mobile-key-tab').click();
  await page.getByTestId('shell-mobile-key-arrowUp').click();

  const ctrlButton = page.getByTestId('shell-mobile-key-ctrl');
  await ctrlButton.dispatchEvent('pointerdown', {
    pointerId: 71,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
  });
  await expect(ctrlButton).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('shell-mobile-key-arrowRight').click();
  await ctrlButton.dispatchEvent('pointerup', {
    pointerId: 71,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
  });

  await expect.poll(async () => page.evaluate(() => window.__sentShellInputData)).toEqual([
    '\x1b',
    '\t',
    '\x1b[A',
    '\x1b[1;5C',
  ]);
});
