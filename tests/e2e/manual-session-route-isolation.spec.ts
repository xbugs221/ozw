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
  PRIMARY_FIXTURE_PROJECT_PATH,
} from '../spec/helpers/spec-test-helpers.ts';
import {
  PLAYWRIGHT_FIXTURE_HOME,
} from './helpers/playwright-fixture.ts';
import {
  readProjectLocalConfig,
} from '../../backend/project-config-store.ts';
import {
  getNextManualRouteIndex,
} from '../../backend/domains/projects/project-config-read-model.ts';

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

/**
 * Write an unrelated Codex history whose id collides with the next cN draft.
 */
async function writeUnrelatedCodexHistory(sessionId, content) {
  const sessionDir = path.join(PLAYWRIGHT_FIXTURE_HOME, '.codex', 'sessions', '2026', '04', '20');
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-20T10:00:00.000Z',
        payload: {
          id: sessionId,
          cwd: path.join(PLAYWRIGHT_FIXTURE_HOME, 'workspace', 'unrelated-codex-project'),
          model: 'gpt-5-codex',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-20T10:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'unrelated cN collision user message',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-20T10:00:02.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: content }],
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

/**
 * Read the next user-visible cN route id from the same config the app uses.
 */
async function readNextManualRouteSessionId() {
  const config = await readProjectLocalConfig(PRIMARY_FIXTURE_PROJECT_PATH);
  return `c${getNextManualRouteIndex(config)}`;
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

test('codex draft session does not render unrelated history sharing the cN route id', async ({ page }) => {
  await openFixtureProject(page);

  const expectedRouteSessionId = await readNextManualRouteSessionId();
  const collisionText = `unrelated codex ${expectedRouteSessionId} history ${Date.now()}`;
  await writeUnrelatedCodexHistory(expectedRouteSessionId, collisionText);

  const manualSessionGroup = page.locator('[data-testid="project-overview-manual-sessions"]').first();
  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();
  await page.getByTestId('project-new-session-provider-codex').click();

  await expect(page).toHaveURL(new RegExp(`/${expectedRouteSessionId}(?:\\?.*)?$`), { timeout: 10_000 });
  const routeSessionId = new URL(page.url()).pathname.match(/\/(c\d+)$/)?.[1] || '';
  expect(routeSessionId).toBe(expectedRouteSessionId);
  const chat = page.getByTestId('chat-scroll-container').last();
  await expect(chat.getByText(collisionText)).toHaveCount(0);
  await expect(chat.locator('.chat-message')).toHaveCount(0);

  const messageText = `codex route isolation ping ${Date.now()}`;
  const textarea = page.locator('textarea[placeholder]').first();
  await expect(textarea).toBeVisible();
  await textarea.fill(messageText);
  await textarea.press('Control+Enter');

  await page.waitForFunction(
    (expectedText) => (window.__manualRouteWsMessages || []).some(
      (message) => message?.type === 'codex-command' && message.command === expectedText,
    ),
    messageText,
    { timeout: 8_000 },
  );

  const capturedMessages = await readCapturedMessages(page);
  const codexCommand = capturedMessages.find((message) => (
    message?.type === 'codex-command' && message.command === messageText
  ));
  expect(codexCommand).toBeTruthy();
  expect(codexCommand.sessionId).toBeNull();
  expect(codexCommand.ozwSessionId).toBe(routeSessionId);
  expect(codexCommand.options?.ozwSessionId).toBe(routeSessionId);
  expect(codexCommand.options?.resume).toBe(false);
  await expect(page).toHaveURL(new RegExp(`/${routeSessionId}(?:\\?.*)?$`));

  await fs.mkdir(DEBUG_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(DEBUG_SCREENSHOT_DIR, 'codex-draft-empty.png'),
    fullPage: true,
  });
});
