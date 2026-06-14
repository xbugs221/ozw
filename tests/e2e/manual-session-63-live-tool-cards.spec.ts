// @ts-nocheck -- Acceptance regression is allowed to fail until proposal 63 is implemented.
/**
 * PURPOSE: Verify proposal 63 through the real browser manual-session chat
 * route so Codex and Pi live tool cards render immediately, keep command input
 * across output deltas, survive empty read-model refreshes, and avoid nested
 * command/result folding.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from '../spec/helpers/spec-test-helpers.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/manual-session-63-live-tool-cards');
const READ_PATH = 'src/components/chat/view/subcomponents/MessageComponent.tsx';
const READ_OUTPUT = 'proposal 63 read result should attach to the live tool card';
const COMMAND = 'pnpm exec ozw-63 --live-tool-card';
const COMMAND_OUTPUT = 'proposal 63 command stdout after delta';
const FAILED_COMMAND = 'pnpm exec ozw-63 --failure';
const FAILED_OUTPUT = 'proposal 63 failed stderr remains inspectable';
const ROUTE_SESSION_IDS = {
  codex: 'c6301',
  pi: 'c6302',
};

test.describe('manual session proposal 63 live tool cards', () => {
  for (const provider of ['codex', 'pi']) {
    test(`${provider} live tool cards keep commands visible and reload without nested Output groups`, async ({ page }) => {
      /**
       * Drive the real browser route with injected WebSocket messages and
       * mocked read-model responses that reproduce the persistence race.
       */
      test.setTimeout(90_000);
      const sessionId = ROUTE_SESSION_IDS[provider];
      const messageResponses = [];
      const persistedState = { ready: false };

      await installRealtimeSocketHarness(page);
      await installMessagesMock(page, sessionId, provider, persistedState, messageResponses);
      await openFixtureProject(page);
      await openManualSessionRoute(page, sessionId, provider);

      const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
      await emitLiveItem(page, provider, sessionId, {
        itemType: 'tool_call',
        itemId: `${provider}-63-read`,
        tool: 'Read',
        arguments: { file_path: READ_PATH },
        status: 'running',
      });
      await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: READ_PATH })).toBeVisible({ timeout: 10_000 });

      await emitLiveItem(page, provider, sessionId, {
        itemType: 'tool_result',
        itemId: `${provider}-63-read`,
        tool: 'Read',
        result: READ_OUTPUT,
        status: 'completed',
      });
      await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: READ_PATH })).toHaveCount(1);

      await emitLiveItem(page, provider, sessionId, {
        itemType: 'command_execution',
        itemId: `${provider}-63-command`,
        command: COMMAND,
        output: '',
        status: 'running',
      });
      await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: COMMAND })).toBeVisible({ timeout: 10_000 });

      await emitLiveItem(page, provider, sessionId, {
        itemType: 'command_execution',
        itemId: `${provider}-63-command`,
        output: COMMAND_OUTPUT,
        status: 'running',
      });
      const commandCard = transcript.getByTestId('codex-tool-card').filter({ hasText: COMMAND }).first();
      await expect(commandCard).toBeVisible();
      await expect(commandCard.getByText(COMMAND, { exact: true })).toBeVisible();
      await expect(commandCard.locator('summary', { hasText: /^Output$/ })).toHaveCount(0);
      await expect(commandCard.locator('path[d="M9 5l7 7-7 7"]')).toHaveCount(0);

      await emitLiveItem(page, provider, sessionId, {
        itemType: 'command_execution',
        itemId: `${provider}-63-failed-command`,
        command: FAILED_COMMAND,
        output: FAILED_OUTPUT,
        status: 'failed',
        exitCode: 1,
      });
      const failedCard = transcript.getByTestId('codex-tool-card').filter({ hasText: FAILED_COMMAND }).first();
      await expect(failedCard).toBeVisible();
      await expect(failedCard.getByText(FAILED_COMMAND, { exact: true })).toBeVisible();

      await emitProviderComplete(page, provider, sessionId);
      await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: COMMAND })).toBeVisible({ timeout: 10_000 });
      await expect(transcript.getByText(COMMAND_OUTPUT, { exact: true })).toBeHidden();

      const outputToggle = commandCard.getByRole('button', { name: /show output|hide output/i }).first();
      await outputToggle.click();
      await expect(commandCard.getByText(COMMAND_OUTPUT, { exact: true })).toBeVisible();
      await outputToggle.click();
      await expect(commandCard.getByText(COMMAND_OUTPUT, { exact: true })).toBeHidden();
      await outputToggle.click();
      await expect(commandCard.getByText(COMMAND_OUTPUT, { exact: true })).toBeVisible();
      await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: COMMAND })).toHaveCount(1);

      persistedState.ready = true;
      await page.reload({ waitUntil: 'networkidle' });
      const reloadedTranscript = page.locator('[data-testid="chat-scroll-container"]').last();
      const reloadedCommandCard = reloadedTranscript.getByTestId('codex-tool-card').filter({ hasText: COMMAND }).first();
      await expect(reloadedCommandCard).toBeVisible({ timeout: 20_000 });
      await expect(reloadedCommandCard.getByText(COMMAND, { exact: true })).toBeVisible();
      await expect(reloadedCommandCard.locator('summary', { hasText: /^Output$/ })).toHaveCount(0);
      await expect(reloadedTranscript.getByTestId('codex-tool-card').filter({ hasText: COMMAND })).toHaveCount(1);

      await writeEvidence(page, provider, sessionId, messageResponses);
    });
  }
});

async function installRealtimeSocketHarness(page) {
  /**
   * Capture the app's active chat WebSocket so the test can inject provider
   * events through the same onmessage path as server-pushed runtime events.
   */
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    window.__ozwChatSockets = [];

    function PatchedWebSocket(...args) {
      const ws = new OriginalWebSocket(...args);
      window.__ozwChatSockets.push(ws);
      window.__ozwActiveChatSocket = ws;
      ws.addEventListener('open', () => {
        window.__ozwActiveChatSocket = ws;
      });
      return ws;
    }

    PatchedWebSocket.prototype = OriginalWebSocket.prototype;
    for (const key of ['OPEN', 'CONNECTING', 'CLOSING', 'CLOSED']) {
      PatchedWebSocket[key] = OriginalWebSocket[key];
    }
    window.WebSocket = PatchedWebSocket;
  });
}

async function openManualSessionRoute(page, sessionId, provider) {
  /**
   * Open a provider-hinted manual route after the fixture project has loaded.
   */
  const query = new URLSearchParams({
    provider,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionSummary: `proposal 63 ${provider} live tool cards`,
  });
  await page.goto(`/session/${sessionId}?${query.toString()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ozwActiveChatSocket?.readyState === window.WebSocket.OPEN, null, { timeout: 20_000 });
}

async function installMessagesMock(page, sessionId, provider, persistedState, messageResponses) {
  /**
   * Return an empty read model until the test flips persistedState.ready, then
   * return a durable transcript to verify browser refresh recovery.
   */
  await page.route(`**/api/projects/**/sessions/${sessionId}/messages**`, async (route) => {
    const messages = persistedState.ready ? buildPersistedMessages(provider) : [];
    const responseBody = {
      messages,
      total: messages.length,
      hasMore: false,
      source: persistedState.ready ? 'proposal-63-persisted-fixture' : 'proposal-63-empty-race-fixture',
    };
    messageResponses.push({
      url: route.request().url(),
      total: responseBody.total,
      source: responseBody.source,
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responseBody),
    });
  });
}

async function emitLiveItem(page, provider, sessionId, item) {
  /**
   * Push one native runtime item into the app's active WebSocket listener.
   */
  await emitSocketMessage(page, {
    type: `${provider}-response`,
    sessionId,
    ozwSessionId: sessionId,
    data: {
      type: 'item',
      ...item,
    },
  });
}

async function emitProviderComplete(page, provider, sessionId) {
  /**
   * Emit the provider completion event that can trigger read-model reconciliation.
   */
  if (provider === 'codex') {
    await emitSocketMessage(page, {
      type: 'codex-complete',
      sessionId,
      actualSessionId: sessionId,
      exitCode: 0,
    });
    return;
  }

  await emitSocketMessage(page, {
    type: 'pi-response',
    sessionId,
    ozwSessionId: sessionId,
    data: {
      type: 'turn_complete',
    },
  });
}

async function emitSocketMessage(page, payload) {
  /**
   * Dispatch a JSON WebSocket message on the browser's live chat socket.
   */
  await page.evaluate((message) => {
    const socket = window.__ozwActiveChatSocket;
    if (!socket) {
      throw new Error('No active chat WebSocket captured');
    }
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }, payload);
}

function buildPersistedMessages(provider) {
  /**
   * Build a durable transcript with command, failed command, and read tool
   * records in the same shape returned by the session messages API.
   */
  const timestamp = '2026-06-02T15:30:00.000Z';
  return [
    toolUse(`${provider}-63-read-message`, `${provider}-63-read`, provider, 'Read', { file_path: READ_PATH }, timestamp),
    toolResult(`${provider}-63-read-result`, `${provider}-63-read`, provider, READ_OUTPUT, false, timestamp),
    toolUse(`${provider}-63-command-message`, `${provider}-63-command`, provider, 'Bash', { command: COMMAND }, timestamp),
    toolResult(`${provider}-63-command-result`, `${provider}-63-command`, provider, COMMAND_OUTPUT, false, timestamp),
    toolUse(`${provider}-63-failed-message`, `${provider}-63-failed-command`, provider, 'Bash', { command: FAILED_COMMAND }, timestamp),
    toolResult(`${provider}-63-failed-result`, `${provider}-63-failed-command`, provider, FAILED_OUTPUT, true, timestamp),
  ];
}

function toolUse(messageKey, toolCallId, provider, toolName, toolInput, timestamp) {
  /**
   * Create a persisted tool_use record for the frontend read-model converter.
   */
  return {
    type: 'tool_use',
    timestamp,
    provider,
    messageKey,
    toolName,
    toolInput,
    toolCallId,
  };
}

function toolResult(messageKey, toolCallId, provider, output, isError, timestamp) {
  /**
   * Create a persisted tool_result record attached to its tool call id.
   */
  return {
    type: 'tool_result',
    timestamp,
    provider,
    messageKey,
    toolName: 'Bash',
    toolCallId,
    output,
    isError,
  };
}

async function writeEvidence(page, provider, sessionId, messageResponses) {
  /**
   * Persist screenshot, network, and DOM state evidence for the QA matrix.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${provider}-live-command-after-refresh.png`),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, `${provider}-messages-network.json`),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), sessionId, provider, messageResponses }, null, 2)}\n`,
    'utf8',
  );
  const state = await page.locator('[data-testid="chat-scroll-container"]').last().evaluate((node) => {
    const cards = Array.from(node.querySelectorAll('[data-testid="codex-tool-card"]'));
    return cards.map((card) => ({
      text: card.textContent,
      outputSummaries: Array.from(card.querySelectorAll('summary')).map((summary) => summary.textContent),
      outputButtons: Array.from(card.querySelectorAll('button[aria-expanded]')).map((button) => ({
        label: button.getAttribute('aria-label'),
        expanded: button.getAttribute('aria-expanded'),
      })),
      chevronPaths: card.querySelectorAll('path[d="M9 5l7 7-7 7"]').length,
    }));
  });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, `${provider}-tool-card-state.json`),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), sessionId, provider, state }, null, 2)}\n`,
    'utf8',
  );
}
