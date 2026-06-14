// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Browser acceptance coverage for co-backed chat event recovery.
 * The Playwright fixture runs a fake external co daemon, so the UI still uses
 * the real WebSocket, request-file, conversation-state, and events.jsonl path.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  authenticatePage,
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.ts';
import { getProjectLocalConfigPath } from '../../../backend/project-config-store.ts';

async function openNewProviderSession(page, provider) {
  page.once('dialog', async (dialog) => {
    await dialog.accept(`${provider} co reconnect acceptance`);
  });
  await page.getByTestId('project-overview-manual-sessions').getByRole('button', { name: /新建会话|New Session/i }).click();
  await page.getByTestId(`project-new-session-provider-${provider}`).click();
  await expect(page.locator('textarea').first()).toBeVisible();
}

async function sendPromptThenReconnect(page, marker) {
  await page.waitForFunction(() => typeof window.__ozwTestCloseWebSocket === 'function');
  const chatContainer = page.locator('[data-testid="chat-scroll-container"]').last();
  const responses = chatContainer.getByText(`fake co response: ${marker}`);
  const composerInput = page.locator('textarea').first();
  const composerForm = composerInput.locator('xpath=ancestor::form[1]');

  await composerInput.fill(marker);
  await expect(composerForm.locator('button[type="submit"]')).toBeEnabled();
  await composerForm.evaluate((form) => form.requestSubmit());
  await expect(chatContainer).toContainText(marker);
  await expect(responses.last()).toBeVisible({ timeout: 15_000 });
  await expect(responses).toHaveCount(1);

  await page.evaluate(() => window.__ozwTestCloseWebSocket());
  await page.waitForTimeout(1_000);
  await expect(responses).toHaveCount(1);
}

async function sendPrompt(page, marker) {
  /**
   * Submit one prompt through the visible chat composer and return the active
   * chat container so tests can assert streamed co events in the browser.
   */
  const chatContainer = page.locator('[data-testid="chat-scroll-container"]').last();
  const composerInput = page.locator('textarea').first();
  const composerForm = composerInput.locator('xpath=ancestor::form[1]');
  await composerInput.fill(marker);
  await expect(composerForm.locator('button[type="submit"]')).toBeEnabled();
  await composerForm.evaluate((form) => form.requestSubmit());
  await expect(chatContainer).toContainText(marker);
  return chatContainer;
}

function getCurrentRouteIndex(page) {
  /**
   * Extract the current cN route number so browser tests can wait for the
   * backend draft claim before hard-refreshing or opening another window.
   */
  const matched = page.url().match(/\/c(\d+)(?:[?#].*)?$/);
  if (!matched) {
    throw new Error(`Expected a project conversation route, got ${page.url()}`);
  }
  return matched[1];
}

async function readProjectConfig() {
  /**
   * Read the fixture project's ozw config without going through the app;
   * this narrows reload failures to backend state versus browser rendering.
   */
  const configPath = getProjectLocalConfigPath(PRIMARY_FIXTURE_PROJECT_PATH);
  return JSON.parse(await fs.readFile(configPath, 'utf8'));
}

async function readCoRequests() {
  /**
   * Read fake co request files so multi-window browser tests can verify that
   * UI actions crossed the real request-file contract boundary.
   */
  const pendingDir = path.join(process.cwd(), '.tmp', 'playwright-co-home', 'requests', 'pending');
  let fileNames = [];
  try {
    fileNames = await fs.readdir(pendingDir);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const requests = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith('.json'))
      .map(async (fileName) => JSON.parse(await fs.readFile(path.join(pendingDir, fileName), 'utf8'))),
  );
  return requests;
}

async function waitForCoRequest(marker, conversationId) {
  /**
   * Wait for one browser submit to materialize as exactly one co request.
   */
  await expect.poll(async () => {
    const requests = await readCoRequests();
    return requests.filter((request) => request.text === marker && request.conversation_id === conversationId).length;
  }, { timeout: 10_000 }).toBe(1);
}

async function expectNoCoRequest(marker) {
  /**
   * Assert that a failed send did not cross the external co request boundary.
   */
  await expect.poll(async () => {
    const requests = await readCoRequests();
    return requests.some((request) => request.text === marker);
  }, { timeout: 2_000 }).toBe(false);
}

async function expectNoManualSessionForText(text) {
  /**
   * Confirm provider gate failures do not leave a project-local draft route.
   */
  const config = await readProjectConfig();
  const chatRecords = [
    ...Object.values(config.chat || {}),
    ...Object.values(config.workflows || {}).flatMap((workflow) => Object.values(workflow?.chat || {})),
  ];
  expect(chatRecords.some((record) => record?.title === text || record?.summary === text)).toBe(false);
}

async function waitForCoRequestRecord(marker, conversationId) {
  /**
   * Return the single co request for a marker once it crosses the request-file
   * boundary.
   */
  let matched = null;
  await expect.poll(async () => {
    const requests = await readCoRequests();
    const matches = requests.filter((request) => request.text === marker && request.conversation_id === conversationId);
    matched = matches[0] || null;
    return matches.length;
  }, { timeout: 10_000 }).toBe(1);
  return matched;
}

async function waitForAbortRequest(conversationId, targetTurnId) {
  /**
   * Confirm a browser-triggered abort request targets the expected turn id.
   */
  await expect.poll(async () => {
    const requests = await readCoRequests();
    return requests.filter((request) => (
      request.op === 'abort'
      && request.conversation_id === conversationId
      && request.target_turn_id === targetTurnId
    )).length;
  }, { timeout: 10_000 }).toBe(1);
}

async function sendRawChatMessages(page, messages) {
  /**
   * Send controlled WebSocket payloads from a browser window when the test must
   * reuse a request_id or target a stale turn id exactly.
   */
  await page.evaluate(async (payloads) => {
    const token = window.localStorage.getItem('auth-token');
    if (!token) {
      throw new Error('Missing auth token');
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('WebSocket open failed')), { once: true });
    });
    payloads.forEach((payload) => socket.send(JSON.stringify(payload)));
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    socket.close();
  }, messages);
}

function buildCodexCommandPayload({
  marker,
  requestId,
  conversationId,
}) {
  /**
   * Build the browser WebSocket command shape used by the chat composer.
   */
  return {
    type: 'codex-command',
    clientRequestId: requestId,
    command: marker,
    sessionId: null,
    ozwSessionId: conversationId,
    ozw_session_id: conversationId,
    startRequestId: requestId,
    start_request_id: requestId,
    options: {
      cwd: PRIMARY_FIXTURE_PROJECT_PATH,
      projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
      projectName: 'fixture-project',
      sessionId: null,
      ozwSessionId: conversationId,
      ozw_session_id: conversationId,
      clientRequestId: requestId,
      startRequestId: requestId,
      start_request_id: requestId,
      permissionMode: 'bypassPermissions',
    },
  };
}

function buildAbortPayload({
  requestId,
  conversationId,
  targetTurnId,
}) {
  /**
   * Build an exact abort request for stale-target verification.
   */
  return {
    type: 'abort-session',
    clientRequestId: requestId,
    sessionId: conversationId,
    ozwSessionId: conversationId,
    ozw_session_id: conversationId,
    targetTurnId,
    target_turn_id: targetTurnId,
    provider: 'codex',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    options: {
      clientRequestId: requestId,
      targetTurnId,
    },
  };
}

async function waitForDraftStart(page) {
  /**
   * Wait until the first-message request has claimed the cN route. Reloading
   * before this point only tests a cancelled navigation, not co recovery.
   */
  const routeIndex = getCurrentRouteIndex(page);
  await expect.poll(async () => {
    const config = await readProjectConfig();
    return Boolean(config?.chat?.[routeIndex]?.startRequestId);
  }, { timeout: 10_000 }).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await authenticatePage(page);
});

test('Codex co events render after websocket reconnect', async ({ page }) => {
  test.setTimeout(45_000);
  await openFixtureProject(page);

  await openNewProviderSession(page, 'codex');
  await sendPromptThenReconnect(page, 'codex reconnect real co event');
});

test('running co conversation continues after page reload', async ({ page }) => {
  test.setTimeout(45_000);
  await openFixtureProject(page);
  await openNewProviderSession(page, 'codex');

  const marker = 'codex reload running co turn';
  await sendPrompt(page, marker);
  await waitForDraftStart(page);
  const conversationUrl = page.url();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page).toHaveURL(conversationUrl);

  const reloadedChat = page.locator('[data-testid="chat-scroll-container"]').last();
  const responses = reloadedChat.getByText(`fake co response: ${marker}`);
  await expect(responses.last()).toBeVisible({ timeout: 20_000 });
  await expect(responses).toHaveCount(1);
});

test('two browser windows share one co conversation without duplicate submit or wrong abort', async ({ page, context }) => {
  test.setTimeout(60_000);
  await openFixtureProject(page);
  await openNewProviderSession(page, 'codex');

  const firstMarker = 'codex multiwindow first turn';
  const secondMarker = 'codex multiwindow second window turn';
  const duplicateMarker = 'codex multiwindow duplicate request id turn';
  const firstChat = await sendPrompt(page, firstMarker);
  await waitForDraftStart(page);
  const conversationUrl = page.url();
  const conversationId = `c${getCurrentRouteIndex(page)}`;
  const firstRequest = await waitForCoRequestRecord(firstMarker, conversationId);
  const firstTurnId = `turn_${firstRequest.request_id}`;

  const secondPage = await context.newPage();
  await authenticatePage(secondPage);
  await secondPage.goto(conversationUrl, { waitUntil: 'networkidle' });
  await expect(secondPage.getByRole('textbox', { name: /Type your message/i })).toBeVisible();
  const secondChat = secondPage.locator('[data-testid="chat-scroll-container"]').last();

  const firstResponses = firstChat.getByText(`fake co response: ${firstMarker}`);
  const secondWindowFirstResponses = secondChat.getByText(`fake co response: ${firstMarker}`);
  await expect(firstResponses.last()).toBeVisible({ timeout: 20_000 });
  await expect(secondWindowFirstResponses.last()).toBeVisible({ timeout: 20_000 });

  await sendPrompt(secondPage, secondMarker);
  await waitForCoRequestRecord(secondMarker, conversationId);
  const staleAbortId = `stale-abort-${Date.now()}`;
  await sendRawChatMessages(page, [
    buildAbortPayload({
      requestId: staleAbortId,
      conversationId,
      targetTurnId: firstTurnId,
    }),
  ]);
  await waitForAbortRequest(conversationId, firstTurnId);
  const secondResponses = firstChat.getByText(`fake co response: ${secondMarker}`);
  const secondWindowSecondResponses = secondChat.getByText(`fake co response: ${secondMarker}`);
  await expect(secondResponses.last()).toBeVisible({ timeout: 25_000 });
  await expect(secondWindowSecondResponses.last()).toBeVisible({ timeout: 25_000 });

  const duplicateRequestId = `duplicate-${Date.now()}`;
  const duplicatePayload = buildCodexCommandPayload({
    marker: duplicateMarker,
    requestId: duplicateRequestId,
    conversationId,
  });
  await sendRawChatMessages(secondPage, [duplicatePayload, duplicatePayload]);
  await waitForCoRequest(duplicateMarker, conversationId);
  const duplicateResponses = firstChat.getByText(`fake co response: ${duplicateMarker}`);
  const duplicateWindowResponses = secondChat.getByText(`fake co response: ${duplicateMarker}`);
  await expect(duplicateResponses.last()).toBeVisible({ timeout: 25_000 });
  await expect(duplicateWindowResponses.last()).toBeVisible({ timeout: 25_000 });

  await expect(firstResponses).toHaveCount(1);
  await expect(secondWindowFirstResponses).toHaveCount(1);
  await expect(secondResponses).toHaveCount(1);
  await expect(secondWindowSecondResponses).toHaveCount(1);
  await expect(duplicateResponses).toHaveCount(1);
  await expect(duplicateWindowResponses).toHaveCount(1);
});
