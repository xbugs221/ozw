// @ts-nocheck -- Test typing: parameter annotations pending.
/**
 * 文件目的：验证终端作为主工作区视图打开，移动端辅助按键仍可输入。
 * 业务意义：桌面终端不再固定到底部 dock，记录/详情与终端通过主视图切换。
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
 * 打开稳定项目并等待工作区工具栏可用。
 */
async function openShellProject(page) {
  await page.goto('/workspace/fixture-project', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: /^Shell$|^终端$/ })).toBeVisible({ timeout: 10_000 });
}

/**
 * 等待终端 WebSocket 连接建立。
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

test('desktop shell opens as main workspace terminal without lower dock', async ({ page }: { page: any }) => {
  await openShellProject(page);
  await page.getByRole('button', { name: /^Shell$|^终端$/ }).click();

  await expect(page.locator('.xterm')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="dock-panel-lower"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="tab-shell"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main, body')).not.toContainText(/Disconnect|断开连接|Restart|重启/);
});

test('desktop shell main view keeps one websocket while staying in workspace', async ({ page }: { page: any }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openShellProject(page);
  await page.getByRole('button', { name: /^Shell$|^终端$/ }).click();

  await expect(page.locator('.xterm')).toBeVisible({ timeout: 10_000 });
  await waitForOpenShellSocket(page);
  const shellSocketCountBefore = await page.evaluate(() => {
    const sockets = window.__trackedSockets || [];
    return sockets.filter((socket) => typeof socket.url === 'string' && socket.url.includes('/shell')).length;
  });

  await page.waitForTimeout(300);
  await expect.poll(async () => page.evaluate(() => {
    const sockets = window.__trackedSockets || [];
    return sockets.filter((socket) => typeof socket.url === 'string' && socket.url.includes('/shell')).length;
  })).toBe(shellSocketCountBefore);

  const terminalBox = await page.locator('.xterm').boundingBox();
  expect(terminalBox?.width).toBeGreaterThan(700);
  expect(terminalBox?.height).toBeGreaterThan(300);
});

test('session route opens terminal first and Render switches to the record view', async ({ page }: { page: any }) => {
  /** 当前产品以终端为会话主视图，Render 只展示持久化记录。 */
  await page.goto('/workspace/fixture-project/c3', { waitUntil: 'networkidle' });

  await expect(page.getByTestId('tab-shell')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: /Terminal input|消息输入|Message input/i })).toBeVisible();
  await page.getByRole('button', { name: /^Render$|^渲染$/ }).click();
  await expect(page.getByTestId('chat-tui-panel')).toBeHidden();
  await expect(page.getByTestId('tab-shell')).toHaveAttribute('aria-pressed', 'false');
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
  await ctrlButton.click();
  await expect(ctrlButton).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('shell-mobile-key-arrowRight').click();
  await expect(ctrlButton).toHaveAttribute('aria-pressed', 'true');
  await ctrlButton.click();
  await expect(ctrlButton).toHaveAttribute('aria-pressed', 'false');

  await expect.poll(async () => page.evaluate(() => {
    const sent = window.__sentShellInputData || [];
    return {
      hasEscape: sent.includes('\x1b'),
      hasTab: sent.includes('\t'),
      hasArrowUp: sent.includes('\x1b[A'),
      hasCtrlArrowRight: sent.includes('\x1b[1;5C'),
    };
  })).toEqual({
    hasEscape: true,
    hasTab: true,
    hasArrowUp: true,
    hasCtrlArrowRight: true,
  });
});

test('mobile viewport lets the software keyboard resize content above the helper keybar', async ({ page }: { page: any }) => {
  /** Android 软键盘必须缩放页面内容，不能覆盖布局视口底部。 */
  await page.setViewportSize({ width: 390, height: 844 });
  await openShellProject(page);
  await page.getByRole('button', { name: /^Shell$|^终端$/ }).click();

  const viewportContent = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewportContent).toContain('interactive-widget=resizes-content');
  const keybar = page.getByTestId('shell-mobile-keybar');
  await expect(keybar).toBeVisible({ timeout: 10_000 });
  await page.locator('.xterm-helper-textarea').focus();
  await page.setViewportSize({ width: 390, height: 520 });
  await expect.poll(async () => keybar.evaluate((element) => ({
    bottom: element.getBoundingClientRect().bottom,
    viewportHeight: window.innerHeight,
  }))).toMatchObject({ bottom: 520, viewportHeight: 520 });

  await page.screenshot({
    path: 'docs/debug/20260717-0829-codex-session-mobile-keyboard/screenshots/mobile-keybar-above-keyboard.png',
    fullPage: true,
  });
});

test('mobile touch scroll is forwarded to TMux while mouse tracking is active', async ({ page }: { page: any }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openShellProject(page);
  await page.getByRole('button', { name: /^Shell$|^终端$/ }).click();

  await waitForOpenShellSocket(page);
  const terminal = page.locator('.xterm');
  await expect(terminal).toBeVisible({ timeout: 10_000 });
  await terminal.click();
  await page.keyboard.type("tmux set-option mouse on; clear; for i in $(seq 1 160); do printf 'mobile-touch-line-%03d\\n' \"$i\"; done");
  await page.keyboard.press('Enter');
  await expect(terminal).toHaveClass(/enable-mouse-events/, { timeout: 10_000 });

  await page.evaluate(() => {
    window.__sentShellInputData = [];
  });

  await terminal.evaluate((element) => {
    /** Dispatch one real DOM touch event at the supplied terminal coordinate. */
    const dispatchTouch = (type: string, clientY: number) => {
      const bounds = element.getBoundingClientRect();
      const touch = new Touch({
        identifier: 1,
        target: element,
        clientX: bounds.left + bounds.width / 2,
        clientY,
        pageX: bounds.left + bounds.width / 2,
        pageY: clientY,
      });
      element.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch],
      }));
    };

    const bounds = element.getBoundingClientRect();
    dispatchTouch('touchstart', bounds.top + bounds.height * 0.35);
    dispatchTouch('touchmove', bounds.top + bounds.height * 0.55);
    dispatchTouch('touchmove', bounds.top + bounds.height * 0.75);
    dispatchTouch('touchend', bounds.top + bounds.height * 0.75);
  });

  await expect.poll(async () => page.evaluate(() => (
    (window.__sentShellInputData || []).some((data) => data.includes('\x1b[<64;'))
  ))).toBe(true);

  await page.screenshot({
    path: 'docs/debug/20260711-1447-mobile-terminal-touch-scroll/screenshots/mobile-terminal-touch-scroll.png',
    fullPage: true,
  });
});
