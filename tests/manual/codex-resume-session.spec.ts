// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Manual diagnostic for verifying a developer-provided Codex session
 * can accept a new web UI message and render a visible assistant reply.
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
const SESSION_ID = process.env.CCUI_E2E_SESSION_ID || '';

if (!SESSION_ID) {
  test.skip(true, 'CCUI_E2E_SESSION_ID is required');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ token, sessionId }) => {
    window.localStorage.setItem('auth-token', token);
    window.localStorage.setItem('selected-provider', 'codex');
    window.localStorage.setItem('permissionMode-global', 'bypassPermissions');
    if (sessionId) {
      window.localStorage.setItem(`permissionMode-${sessionId}`, 'bypassPermissions');
    }
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
  }, { token: AUTH_TOKEN, sessionId: SESSION_ID });
});

/**
 * Wait until at least one `/ws` websocket is open.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function waitForOpenChatSocket(page) {
  await page.waitForFunction(
    () => {
      const sockets = window.__trackedSockets || [];
      return sockets.some((socket) => typeof socket.url === 'string' && socket.url.includes('/ws') && socket.readyState === 1);
    },
    { timeout: 20_000 },
  );
}

/**
 * Send a chat message through the visible composer.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} message
 * @returns {Promise<void>}
 */
async function sendComposerMessage(page, message) {
  const textarea = page.locator('textarea').first();
  const submitButton = page.locator('form button[type="submit"]').last();
  await expect(textarea).toBeVisible({ timeout: 20_000 });
  await textarea.evaluate((element) => {
    element.focus();
  });
  await page.keyboard.insertText(message);
  await expect(submitButton).toBeEnabled({ timeout: 10_000 });
  await submitButton.evaluate((element) => {
    element.click();
  });
}

test('existing Codex session receives a new web message and renders a visible reply', async ({ page }) => {
  test.setTimeout(120_000);

  const marker = `CCUI-E2E-RESUME-${Date.now()}`;

  await page.goto(`/session/${SESSION_ID}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10_000);
  await waitForOpenChatSocket(page);

  await sendComposerMessage(
    page,
    `Reply with the exact text ${marker} and nothing else.`,
  );

  await expect(page.locator('.chat-message.user').filter({ hasText: marker }).first()).toBeVisible({
    timeout: 15_000,
  });

  await expect(page.getByText(marker, { exact: true }).last()).toBeVisible({
    timeout: 60_000,
  });
});
