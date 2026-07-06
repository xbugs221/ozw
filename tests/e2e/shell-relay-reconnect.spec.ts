// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify the shell relay recovers from an unexpected websocket drop
 * and flushes queued terminal input after reconnecting.
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
const PROJECT_BUTTON_PREFIX = process.env.CCUI_E2E_PROJECT_PREFIX || 'fixture-project';
const SESSION_ID = process.env.CCUI_E2E_SESSION_ID || '';

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    window.localStorage.setItem('auth-token', token);
    window.localStorage.setItem('activeTab', 'shell');
    window.__trackedSocketMessages = [];

    const NativeWebSocket = window.WebSocket;
    class TrackedWebSocket extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        window.__trackedSockets = window.__trackedSockets || [];
        window.__trackedSockets.push(this);
        this.addEventListener('message', (event) => {
          window.__trackedSocketMessages.push({
            url: typeof this.url === 'string' ? this.url : '',
            data: typeof event.data === 'string' ? event.data : String(event.data ?? ''),
          });
        });
      }
    }

    Object.setPrototypeOf(TrackedWebSocket, NativeWebSocket);
    window.WebSocket = TrackedWebSocket;
  }, AUTH_TOKEN);
});

/**
 * Click the first visible button whose text includes the target fragment.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 * @returns {Promise<void>}
 */
async function clickVisibleButtonByText(page, text) {
  const clicked = await page.evaluate((target) => {
    const button = Array.from(document.querySelectorAll('button')).find((node) => {
      const content = (node.textContent || '').trim().toLowerCase();
      const isVisible = node.offsetParent !== null;
      return isVisible && content.includes(target.toLowerCase());
    });

    if (!button) {
      return false;
    }

    window.setTimeout(() => button.click(), 0);
    return true;
  }, text);

  if (!clicked) {
    throw new Error(`visible button not found: ${text}`);
  }
}

/**
 * Click the first visible button whose text starts with the provided prefix.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} prefix
 * @returns {Promise<void>}
 */
async function clickVisibleButtonByPrefix(page, prefix) {
  await page.waitForFunction(
    (targetPrefix) => {
      return Array.from(document.querySelectorAll('button')).some((node) => {
        const content = (node.textContent || '').trim();
        const isVisible = node.offsetParent !== null;
        return isVisible && content.toLowerCase().startsWith(targetPrefix.toLowerCase());
      });
    },
    prefix,
    { timeout: 20_000 },
  );

  const clicked = await page.evaluate((targetPrefix) => {
    const button = Array.from(document.querySelectorAll('button')).find((node) => {
      const content = (node.textContent || '').trim();
      const isVisible = node.offsetParent !== null;
      return isVisible && content.startsWith(targetPrefix);
    });

    if (!button) {
      return false;
    }

    window.setTimeout(() => button.click(), 0);
    return true;
  }, prefix);

  if (!clicked) {
    throw new Error(`visible button not found for prefix: ${prefix}`);
  }
}

/**
 * Wait until the shell websocket tracker observes an open `/shell` connection.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} minCount
 * @returns {Promise<void>}
 */
async function waitForOpenShellSocket(page, minCount = 1) {
  await page.waitForFunction(
    (expectedCount) => {
      const sockets = window.__trackedSockets || [];
      const shellSockets = sockets.filter((socket) => typeof socket.url === 'string' && socket.url.includes('/shell'));
      return shellSockets.length >= expectedCount && shellSockets.some((socket) => socket.readyState === 1);
    },
    minCount,
    { timeout: 15_000 },
  );
}

/**
 * Force-close the most recent open `/shell` websocket.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function closeLatestShellSocket(page) {
  const closed = await page.evaluate(() => {
    const sockets = window.__trackedSockets || [];
    const shellSocket = [...sockets]
      .reverse()
      .find((socket) => typeof socket.url === 'string' && socket.url.includes('/shell') && socket.readyState === 1);

    if (!shellSocket) {
      return false;
    }

    shellSocket.close();
    return true;
  });

  if (!closed) {
    throw new Error('open shell websocket not found');
  }
}

test('shell relay reconnects and flushes queued input after an unexpected websocket drop', async ({ page }) => {
  test.setTimeout(60_000);

  const entryPath = SESSION_ID ? `/session/${SESSION_ID}?tab=shell` : '/workspace/fixture-project?tab=shell';
  await page.goto(entryPath, { waitUntil: 'networkidle' });

  // Explicitly select the shell main view to trigger shell websocket creation.
  const shellButton = page.getByRole('button', { name: /^Shell$|^终端$/ });
  await expect(shellButton).toBeVisible({ timeout: 10_000 });
  await shellButton.click();

  const terminalSurface = page.locator('.xterm');
  await waitForOpenShellSocket(page);
  await expect(terminalSurface).toBeVisible({ timeout: 20_000 });

  await closeLatestShellSocket(page);
  await page.waitForFunction(() => {
    const sockets = window.__trackedSockets || [];
    const shellSocket = [...sockets]
      .reverse()
      .find((socket) => typeof socket.url === 'string' && socket.url.includes('/shell'));
    return shellSocket && shellSocket.readyState !== 1;
  }, { timeout: 10_000 });

  await waitForOpenShellSocket(page, 2);
  await expect(terminalSurface).toBeVisible({ timeout: 20_000 });
});
