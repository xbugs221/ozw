// @ts-nocheck -- Acceptance regression is allowed to fail until proposal 64 is implemented.
/**
 * PURPOSE: Verify proposal 64 through the real browser manual-session chat path
 * so streaming thinking/tool cards keep event order, omit redundant outer
 * titles, survive persisted refresh, and keep repeated tool deltas on one card.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from '../spec/helpers/spec-test-helpers.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/manual-session-64-live-thinking-tool-order');
const FIRST_THINKING = 'proposal 64 first live reasoning before command';
const SECOND_THINKING = 'proposal 64 second live reasoning after command';
const COMMAND = 'pnpm exec ozw-64 --stream-order';
const COMMAND_OUTPUT = 'proposal 64 command output delta remains on the same card';
const FAILED_COMMAND = 'pnpm exec ozw-64 --failed-tool';
const FAILED_OUTPUT = 'proposal 64 failed stderr remains visible through ToolRenderer';
const ROUTE_SESSION_IDS = {
  codex: 'c6401',
  pi: 'c6402',
};

test.describe('manual session proposal 64 live thinking and tool ordering', () => {
  for (const provider of ['codex', 'pi']) {
    test(`${provider} streams thinking around command cards without title chrome and keeps refresh order`, async ({ page }) => {
      /**
       * Drive the real chat route with injected provider WebSocket events, then
       * reload against a persisted transcript that has the same business order.
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
        itemType: 'reasoning',
        message: { role: 'assistant', content: FIRST_THINKING },
      });
      await emitLiveItem(page, provider, sessionId, {
        itemType: 'command_execution',
        itemId: `${provider}-64-command`,
        command: COMMAND,
        output: '',
        status: 'running',
      });
      await emitLiveItem(page, provider, sessionId, {
        itemType: 'command_execution',
        itemId: `${provider}-64-command`,
        output: COMMAND_OUTPUT,
        status: 'running',
      });
      await emitLiveItem(page, provider, sessionId, {
        itemType: 'command_execution',
        itemId: `${provider}-64-command`,
        output: COMMAND_OUTPUT,
        status: 'completed',
        exitCode: 0,
      });
      await emitLiveItem(page, provider, sessionId, {
        itemType: 'reasoning',
        message: { role: 'assistant', content: SECOND_THINKING },
      });
      await emitLiveItem(page, provider, sessionId, {
        itemType: 'command_execution',
        itemId: `${provider}-64-failed`,
        command: FAILED_COMMAND,
        output: FAILED_OUTPUT,
        status: 'failed',
        exitCode: 1,
      });

      await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: COMMAND })).toHaveCount(1, { timeout: 20_000 });
      await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: FAILED_COMMAND })).toBeVisible();
      await expectTranscriptOrder(transcript, [FIRST_THINKING, COMMAND, SECOND_THINKING, FAILED_COMMAND]);
      await expectNoOuterTitles(transcript, [COMMAND, FAILED_COMMAND]);

      const outputToggle = transcript.getByTestId('codex-tool-card').filter({ hasText: COMMAND })
        .getByRole('button', { name: /show output|hide output/i }).first();
      await outputToggle.click();
      await expect(transcript.getByText(COMMAND_OUTPUT, { exact: true })).toBeVisible();
      await outputToggle.click();
      await expect(transcript.getByText(COMMAND_OUTPUT, { exact: true })).toBeHidden();
      await outputToggle.click();
      await expect(transcript.getByText(COMMAND_OUTPUT, { exact: true })).toBeVisible();
      await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: COMMAND })).toHaveCount(1);

      persistedState.ready = true;
      await page.reload({ waitUntil: 'networkidle' });
      const reloadedTranscript = page.locator('[data-testid="chat-scroll-container"]').last();
      await expect(reloadedTranscript.getByText(FIRST_THINKING, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(reloadedTranscript.getByTestId('codex-tool-card').filter({ hasText: COMMAND })).toHaveCount(1);
      await expect(reloadedTranscript.getByText(SECOND_THINKING, { exact: true })).toBeVisible();
      await expect(reloadedTranscript.getByTestId('codex-tool-card').filter({ hasText: FAILED_COMMAND })).toBeVisible();
      await expectTranscriptOrder(reloadedTranscript, [FIRST_THINKING, COMMAND, SECOND_THINKING, FAILED_COMMAND]);
      await expectNoOuterTitles(reloadedTranscript, [COMMAND, FAILED_COMMAND]);

      await writeEvidence(page, provider, sessionId, messageResponses);
    });
  }
});

async function installRealtimeSocketHarness(page) {
  /**
   * Capture the app chat WebSocket so the test can inject native provider
   * runtime events through the same listener used by live manual sessions.
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
   * Open a provider-hinted manual session route after fixture project selection.
   */
  const query = new URLSearchParams({
    provider,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionSummary: `proposal 64 ${provider} live thinking tool order`,
  });
  await page.goto(`/session/${sessionId}?${query.toString()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ozwActiveChatSocket?.readyState === window.WebSocket.OPEN, null, { timeout: 20_000 });
}

async function installMessagesMock(page, sessionId, provider, persistedState, messageResponses) {
  /**
   * Return an empty read model during live streaming, then the durable transcript
   * used to prove browser refresh does not change the visible relative order.
   */
  await page.route(`**/api/projects/**/sessions/${sessionId}/messages**`, async (route) => {
    const messages = persistedState.ready ? buildPersistedMessages(provider) : [];
    const responseBody = {
      messages,
      total: messages.length,
      hasMore: false,
      source: persistedState.ready ? 'proposal-64-persisted-fixture' : 'proposal-64-empty-live-fixture',
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
   * Push one live native runtime item into the active chat socket.
   */
  await page.evaluate((payload) => {
    const socket = window.__ozwActiveChatSocket;
    if (!socket) {
      throw new Error('No active chat WebSocket captured');
    }
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }, {
    type: `${provider}-response`,
    sessionId,
    ozwSessionId: sessionId,
    data: {
      type: 'item',
      ...item,
    },
  });
}

async function expectTranscriptOrder(transcript, expectedTexts) {
  /**
   * Assert the DOM text order users read in the chat transcript.
   */
  const positions = await transcript.evaluate((node, texts) => {
    const fullText = node.textContent || '';
    return texts.map((text) => fullText.indexOf(text));
  }, expectedTexts);
  expect(positions.every((position) => position >= 0), 'all expected transcript texts must be present').toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
}

async function expectNoOuterTitles(transcript, commands) {
  /**
   * Verify proposal 64 title removal on real rendered tool cards and thinking
   * blocks, not only source-code shape.
   */
  await expect(transcript.locator('[data-testid="codex-tool-card-title"]:visible')).toHaveCount(0);
  for (const command of commands) {
    const card = transcript.getByTestId('codex-tool-card').filter({ hasText: command }).first();
    await expect(card).toBeVisible();
    await expect(card.locator(':scope > [data-testid="codex-tool-card-title"]')).toHaveCount(0);
  }
  await expect(transcript.locator('summary', { hasText: /思考中|Thinking/i })).toHaveCount(0);
}

function buildPersistedMessages(provider) {
  /**
   * Build a persisted transcript with thinking, successful command deltas merged
   * by tool id, and a failed command after the second thinking block.
   */
  const timestamp = '2026-06-03T01:30:00.000Z';
  return [
    thinkingMessage(`${provider}-64-thinking-1`, provider, FIRST_THINKING, timestamp),
    toolUse(`${provider}-64-command-message`, `${provider}-64-command`, provider, COMMAND, timestamp),
    toolResult(`${provider}-64-command-result`, `${provider}-64-command`, provider, COMMAND_OUTPUT, false, timestamp),
    thinkingMessage(`${provider}-64-thinking-2`, provider, SECOND_THINKING, timestamp),
    toolUse(`${provider}-64-failed-message`, `${provider}-64-failed`, provider, FAILED_COMMAND, timestamp),
    toolResult(`${provider}-64-failed-result`, `${provider}-64-failed`, provider, FAILED_OUTPUT, true, timestamp),
  ];
}

function thinkingMessage(messageKey, provider, text, timestamp) {
  /**
   * Create the persisted thinking record returned by the session messages API.
   */
  return {
    type: 'thinking',
    timestamp,
    provider,
    messageKey,
    message: {
      role: 'assistant',
      content: text,
    },
  };
}

function toolUse(messageKey, toolCallId, provider, command, timestamp) {
  /**
   * Create a persisted Bash tool-use record with the command text users inspect.
   */
  return {
    type: 'tool_use',
    timestamp,
    provider,
    messageKey,
    toolName: 'Bash',
    toolInput: { command },
    toolCallId,
  };
}

function toolResult(messageKey, toolCallId, provider, output, isError, timestamp) {
  /**
   * Create a persisted Bash tool-result record attached to its tool id.
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
   * Persist screenshot, mocked network, and DOM state evidence after refresh.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${provider}-after-refresh-order.png`),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, `${provider}-messages-network.json`),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), sessionId, provider, messageResponses }, null, 2)}\n`,
    'utf8',
  );
  const state = await page.locator('[data-testid="chat-scroll-container"]').last().evaluate((node) => {
    const messages = Array.from(node.querySelectorAll('.chat-message')).map((message) => ({
      key: message.getAttribute('data-message-key'),
      text: message.textContent,
      hasToolTitle: Boolean(message.querySelector('[data-testid="codex-tool-card-title"]')),
      thinkingSummaries: Array.from(message.querySelectorAll('summary')).map((summary) => summary.textContent),
    }));
    return {
      messageTexts: messages,
      toolCardCount: node.querySelectorAll('[data-testid="codex-tool-card"]').length,
      toolTitleCount: node.querySelectorAll('[data-testid="codex-tool-card-title"]').length,
    };
  });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, `${provider}-transcript-state.json`),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), sessionId, provider, state }, null, 2)}\n`,
    'utf8',
  );
}
