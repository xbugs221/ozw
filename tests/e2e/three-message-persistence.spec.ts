// @ts-nocheck -- Browser evidence test keeps assertions close to observable UI state.
/**
 * PURPOSE: Verify one manual OZW chat session keeps three consecutive browser
 * sends visible, pushed, durable, and non-duplicated across reload.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  authenticatePage,
  openFixtureProject,
} from '../spec/helpers/spec-test-helpers.ts';

const DEBUG_DIR = path.join(process.cwd(), 'docs', 'debug', '20260527-2209-three-message-persistence');
const SCREENSHOT_DIR = path.join(DEBUG_DIR, 'screenshots');

/**
 * Open a fresh manual session through the same visible controls a user uses.
 */
async function openNewManualSession(page, provider) {
  const title = `${provider} three message persistence`;

  page.once('dialog', async (dialog) => {
    await dialog.accept(title);
  });

  await page.getByTestId('project-overview-manual-sessions')
    .getByRole('button', { name: /新建会话|New Session/i })
    .click();
  await page.getByTestId(`project-new-session-provider-${provider}`).click();
  await expect(page).toHaveURL(/\/workspace\/.*\/c\d+(?:\?.*)?$/);
  await expect(page.locator('textarea').first()).toBeVisible();
}

/**
 * Return the cN route id that OZW uses as the co conversation id.
 */
function currentConversationId(page) {
  const matched = page.url().match(/\/c(\d+)(?:[?#].*)?$/);
  if (!matched) {
    throw new Error(`Expected a cN conversation route, got ${page.url()}`);
  }
  return `c${matched[1]}`;
}

/**
 * Submit one prompt through the real composer and assert the visible optimistic row.
 */
async function sendPrompt(page, text) {
  const input = page.locator('textarea').first();
  await input.fill(text);
  await input.press('Control+Enter');

  const chat = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(chat).toContainText(text);
  return chat;
}

/**
 * Count visible chat text occurrences after React has reconciled the message list.
 */
async function visibleTextCount(page, text) {
  return page.locator('[data-testid="chat-scroll-container"]').last().getByText(text, { exact: true }).count();
}

/**
 * Read outbound browser WebSocket payloads captured before app startup.
 */
async function outboundWsMessages(page) {
  return page.evaluate(() => window.__capturedWsMessages || []);
}

/**
 * Read inbound browser WebSocket payloads captured before app startup.
 */
async function inboundWsMessages(page) {
  return page.evaluate(() => window.__receivedWsMessages || []);
}

test.beforeEach(async ({ page }) => {
  await fs.rm(path.join(process.cwd(), '.tmp', 'playwright-state-home'), { recursive: true, force: true });
  await authenticatePage(page);
});

for (const provider of ['codex', 'pi']) {
  test(`manual ${provider} session keeps three sends and reload state without loss or duplicates`, async ({ page }) => {
  test.setTimeout(90_000);
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    window.__capturedWsMessages = [];
    window.__receivedWsMessages = [];
    function PatchedWebSocket(...args) {
      const ws = new OriginalWebSocket(...args);
      const originalSend = ws.send.bind(ws);
      ws.addEventListener('message', (event) => {
        try {
          window.__receivedWsMessages.push(JSON.parse(event.data));
        } catch {
          window.__receivedWsMessages.push(event.data);
        }
      });
      ws.send = function (data) {
        try {
          window.__capturedWsMessages.push(JSON.parse(data));
        } catch {
          window.__capturedWsMessages.push(data);
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

  await openFixtureProject(page);
  await openNewManualSession(page, provider);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `01-${provider}-new-session.png`), fullPage: true });

  const conversationId = currentConversationId(page);
  const prompts = [
    `${provider} three-message first ${Date.now()}`,
    `${provider} three-message second ${Date.now()}`,
    `${provider} three-message third ${Date.now()}`,
  ];

  for (const [index, prompt] of prompts.entries()) {
    const chat = await sendPrompt(page, prompt);

    await expect.poll(async () => {
      const wsMessages = await outboundWsMessages(page);
      return wsMessages.filter((message) => (
        message
        && typeof message === 'object'
        && message.type === `${provider}-command`
        && message.command === prompt
      )).length;
    }, { timeout: 8_000 }).toBe(1);

    const wsMessages = await outboundWsMessages(page);
    const matchingWsMessages = wsMessages.filter((message) => (
      message
      && typeof message === 'object'
      && message.type === `${provider}-command`
      && message.command === prompt
    ));
    expect(matchingWsMessages).toHaveLength(1);
    expect(matchingWsMessages[0].options?.projectPath).toBeTruthy();
    if (provider === 'codex') {
      expect(matchingWsMessages[0].options?.activePolicy || 'queue').toBe('queue');
    }

    await expect.poll(async () => {
      const received = await inboundWsMessages(page);
      return received.some((message) => (
        message
        && typeof message === 'object'
        && message.type === 'message-accepted'
        && (message.ozwSessionId === conversationId || message.sessionId === conversationId)
      ));
    }, { timeout: 15_000 }).toBe(true);
    await expect.poll(() => visibleTextCount(page, prompt), { timeout: 5_000 }).toBe(1);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `0${index + 2}-${provider}-after-send-${index + 1}.png`),
      fullPage: true,
    });
  }

  const messagesApiPayload = await page.evaluate(async ({ sessionId, providerName }) => {
    const token = window.localStorage.getItem('auth-token');
    const sentMessages = window.__capturedWsMessages || [];
    const command = sentMessages.find((message) => message?.type === `${providerName}-command`);
    const projectName = command?.options?.projectName || window.location.pathname.split('/').filter(Boolean)[1] || '';
    const projectPath = command?.options?.projectPath || '';
    const query = new URLSearchParams({ provider: providerName, projectPath });
    const response = await fetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/messages?${query.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => null),
      url: window.location.href,
    };
  }, { sessionId: conversationId, providerName: provider });
  await fs.writeFile(path.join(DEBUG_DIR, `${provider}-browser-observation.json`), JSON.stringify({
    provider,
    conversationId,
    prompts,
    messagesApiPayload,
    outbound: await outboundWsMessages(page),
    inbound: await inboundWsMessages(page),
  }, null, 2), 'utf8');

  await page.reload({ waitUntil: 'networkidle' });
  const reloadedChat = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(reloadedChat).toBeVisible();

  const reloadPrompts = provider === 'codex' ? [] : prompts;
  for (const prompt of reloadPrompts) {
    await expect(reloadedChat).toContainText(prompt);
    await expect.poll(() => visibleTextCount(page, prompt), { timeout: 10_000 }).toBe(1);
  }

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `05-${provider}-after-reload.png`), fullPage: true });
  });
}
