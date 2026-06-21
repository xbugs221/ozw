// @ts-nocheck -- Browser evidence test keeps assertions close to observable UI state.
/**
 * PURPOSE: Verify a real Pi manual session keeps WebSocket-pushed thinking,
 * tool, and long assistant live rows rendered while three long turns run.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  authenticatePage,
  openFixtureProject,
} from '../spec/helpers/spec-test-helpers.ts';

const DEBUG_DIR = path.join(process.cwd(), 'docs', 'debug', '20260619-1146-pi-live-ws-render');
const SCREENSHOT_DIR = path.join(DEBUG_DIR, 'screenshots');

/**
 * Install a passive WebSocket spy before the app opens the chat socket.
 */
async function installWebSocketSpy(page) {
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    window.__piLiveOutboundWs = [];
    window.__piLiveInboundWs = [];

    function PatchedWebSocket(...args) {
      const ws = new OriginalWebSocket(...args);
      const originalSend = ws.send.bind(ws);
      ws.addEventListener('message', (event) => {
        try {
          window.__piLiveInboundWs.push(JSON.parse(event.data));
        } catch {
          window.__piLiveInboundWs.push(event.data);
        }
      });
      ws.send = function patchedSend(data) {
        try {
          window.__piLiveOutboundWs.push(JSON.parse(data));
        } catch {
          window.__piLiveOutboundWs.push(data);
        }
        return originalSend(data);
      };
      return ws;
    }

    PatchedWebSocket.prototype = OriginalWebSocket.prototype;
    for (const key of ['OPEN', 'CONNECTING', 'CLOSING', 'CLOSED']) {
      PatchedWebSocket[key] = OriginalWebSocket[key];
    }
    window.WebSocket = PatchedWebSocket;
  });
}

/**
 * Create a fresh Pi session via the visible project overview controls.
 */
async function openNewPiSession(page) {
  page.once('dialog', async (dialog) => {
    await dialog.accept('pi live ws three long messages');
  });

  await page.getByTestId('project-overview-manual-sessions')
    .getByRole('button', { name: /新建会话|New Session/i })
    .click();
  await page.getByTestId('project-new-session-provider-pi').click();
  await expect(page).toHaveURL(/\/workspace\/.*\/c\d+(?:\?.*)?$/, { timeout: 10_000 });
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10_000 });
}

/**
 * Return the visible chat transcript container for assertions.
 */
function transcript(page) {
  return page.locator('[data-testid="chat-scroll-container"]').last();
}

/**
 * Submit one long prompt through the real composer.
 */
async function sendLongPrompt(page, prompt) {
  const input = page.locator('textarea').first();
  await input.fill(prompt);
  await input.press('Control+Enter');
  await expect(transcript(page).getByText(prompt, { exact: true })).toBeVisible({ timeout: 10_000 });
}

/**
 * Read captured WebSocket messages from the browser page.
 */
async function capturedWs(page) {
  return page.evaluate(() => ({
    outbound: window.__piLiveOutboundWs || [],
    inbound: window.__piLiveInboundWs || [],
  }));
}

/**
 * Wait until the backend has pushed every live event kind for one prompt.
 */
async function expectWsLiveKinds(page, prompt) {
  await expect.poll(async () => {
    const { inbound } = await capturedWs(page);
    const matching = inbound.filter((message) => {
      const data = message?.data || {};
      return message?.type === 'pi-response'
        && JSON.stringify(data).includes(prompt);
    });
    return new Set(matching.map((message) => message?.data?.itemType)).size;
  }, { timeout: 25_000 }).toBeGreaterThanOrEqual(4);
}

/**
 * Assert that the live rows rendered from WebSocket remain visible.
 */
async function expectLiveRowsVisible(page, marker) {
  const chat = transcript(page);
  await expect(chat.getByText(`fake pi thinking: ${marker}`).last()).toBeVisible({ timeout: 25_000 });
  await expect(chat.getByTestId('codex-tool-card').filter({
    hasText: `printf "fake pi tool for ${marker}"`,
  }).last()).toBeVisible({ timeout: 25_000 });
  await expect(chat.getByText(`fake pi response: ${marker}`).last()).toBeVisible({ timeout: 25_000 });
  await expect(chat.getByText(`fake pi long live conclusion for ${marker}`).last()).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(1200);
  await expect(chat.getByText(`fake pi thinking: ${marker}`).last()).toBeVisible();
  await expect(chat.getByText(`fake pi long live conclusion for ${marker}`).last()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await authenticatePage(page);
});

test('Pi live WebSocket rows stay rendered across three long messages', async ({ page }) => {
  /**
   * Business flow: create a new Pi session, send three long prompts in order,
   * and verify each real WS live push is rendered before and after reload.
   */
  test.setTimeout(120_000);
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await installWebSocketSpy(page);
  await openFixtureProject(page);
  await openNewPiSession(page);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-pi-live-new-session.png'), fullPage: true });

  const prompts = [1, 2, 3].map((turn) => {
    const marker = `pi live ws turn ${turn} ${Date.now()}`;
    return {
      marker,
      prompt: [
        marker,
        'Think through the live websocket rendering path, inspect the current project state with a tool call,',
        'and then answer with multiple concrete observations. This must not be a one-sentence reply.',
      ].join(' '),
    };
  });

  for (const [index, { marker, prompt }] of prompts.entries()) {
    await sendLongPrompt(page, prompt);
    await expect.poll(async () => {
      const { outbound } = await capturedWs(page);
      return outbound.filter((message) => message?.type === 'pi-command' && message?.command === prompt).length;
    }, { timeout: 10_000 }).toBe(1);
    await expectWsLiveKinds(page, marker);
    await expectLiveRowsVisible(page, marker);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `0${index + 2}-pi-live-turn-${index + 1}.png`),
      fullPage: true,
    });
  }

  await fs.writeFile(path.join(DEBUG_DIR, 'pi-live-ws-three-turns.json'), JSON.stringify({
    url: page.url(),
    prompts,
    ws: await capturedWs(page),
  }, null, 2), 'utf8');

  await page.reload({ waitUntil: 'networkidle' });
  const reloadedChat = transcript(page);
  await expect(reloadedChat).toBeVisible({ timeout: 10_000 });
  for (const { marker } of prompts) {
    await expect(reloadedChat.getByText(`fake pi thinking: ${marker}`).last()).toBeVisible({ timeout: 20_000 });
    await expect(reloadedChat.getByText(`fake pi long live conclusion for ${marker}`).last()).toBeVisible({ timeout: 20_000 });
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-pi-live-after-reload.png'), fullPage: true });
});
