// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify manually created route sessions do not inherit the previous
 * chat transcript or dispatch user input to the previous session.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  openFixtureManualSessionFromOverview,
  openFixtureProject,
} from '../spec/helpers/spec-test-helpers.ts';

const DEBUG_SCREENSHOT_DIR = path.join(
  process.cwd(),
  'docs/debug/20260616-2326-manual-session-route/screenshots',
);

/**
 * Install a transparent WebSocket send spy while preserving real network sends.
 */
async function installWebSocketSendCapture(page) {
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    window.__manualRouteWsMessages = [];

    function PatchedWebSocket(...args) {
      const socket = new OriginalWebSocket(...args);
      const originalSend = socket.send.bind(socket);
      socket.send = function patchedSend(data) {
        try {
          window.__manualRouteWsMessages.push(JSON.parse(data));
        } catch {
          window.__manualRouteWsMessages.push(data);
        }
        return originalSend(data);
      };
      return socket;
    }

    PatchedWebSocket.prototype = OriginalWebSocket.prototype;
    for (const key of ['OPEN', 'CONNECTING', 'CLOSING', 'CLOSED']) {
      PatchedWebSocket[key] = OriginalWebSocket[key];
    }
    window.WebSocket = PatchedWebSocket;
  });
}

/**
 * Read captured outbound browser WebSocket messages.
 */
async function readCapturedMessages(page) {
  return page.evaluate(() => window.__manualRouteWsMessages || []);
}

test.beforeEach(async ({ page }) => {
  await installWebSocketSendCapture(page);
  await page.addInitScript(() => {
    window.prompt = (_message, defaultValue = '') => String(defaultValue || '');
  });
});

test('manual new session clears previous transcript and sends to the new route id', async ({ page }) => {
  await openFixtureProject(page);

  await openFixtureManualSessionFromOverview(page);
  await expect(page).toHaveURL(/\/workspace\/.*\/c\d+(?:\?.*)?$/);
  const previousRouteSessionId = new URL(page.url()).pathname.match(/\/(c\d+)$/)?.[1] || '';

  const oldSessionText = 'fixture-project manual-only session';
  const chat = page.getByTestId('chat-scroll-container').last();
  await expect(chat.getByText(oldSessionText).first()).toBeVisible();

  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();
  const manualSessionGroup = page.locator('[data-testid="project-overview-manual-sessions"]').first();
  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();
  await page.getByTestId('project-new-session-provider-pi').click();

  await expect(page).toHaveURL(/\/workspace\/.*\/c\d+(?:\?.*)?$/, { timeout: 10_000 });
  const routeSessionId = new URL(page.url()).pathname.match(/\/(c\d+)$/)?.[1] || '';
  expect(routeSessionId).toMatch(/^c\d+$/);
  expect(routeSessionId).not.toBe(previousRouteSessionId);

  await expect(chat.getByText(oldSessionText)).toHaveCount(0);
  await fs.mkdir(DEBUG_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(DEBUG_SCREENSHOT_DIR, 'new-manual-session-empty.png'),
    fullPage: true,
  });

  const messageText = `route isolation ${Date.now()}`;
  const textarea = page.locator('textarea[placeholder]').first();
  await expect(textarea).toBeVisible();
  await textarea.fill(messageText);
  await textarea.press('Control+Enter');

  await page.waitForFunction(
    (expectedText) => (window.__manualRouteWsMessages || []).some(
      (message) => message?.type === 'pi-command' && message.command === expectedText,
    ),
    messageText,
    { timeout: 8_000 },
  );

  const capturedMessages = await readCapturedMessages(page);
  const piCommand = capturedMessages.find((message) => (
    message?.type === 'pi-command' && message.command === messageText
  ));
  expect(piCommand).toBeTruthy();
  expect(piCommand.sessionId).toBeNull();
  expect(piCommand.ozwSessionId).toBe(routeSessionId);
  expect(piCommand.options?.ozwSessionId).toBe(routeSessionId);
  expect(piCommand.options?.resume).toBe(false);

  await page.screenshot({
    path: path.join(DEBUG_SCREENSHOT_DIR, 'new-manual-session-dispatch.png'),
    fullPage: true,
  });
});
