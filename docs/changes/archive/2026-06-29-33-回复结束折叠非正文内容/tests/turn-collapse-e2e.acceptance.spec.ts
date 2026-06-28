// @ts-nocheck -- This proposal-level Playwright contract follows existing manual session harness style.
/**
 * PURPOSE: Verify turn-level non-body collapse through the real browser chat
 * route while driving production WebSocket event handlers with fixture events.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from '../../../../tests/spec/helpers/spec-test-helpers.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/turn-non-body-collapse');
const SESSION_ID = 'c3301';
const PROVIDER = 'codex';
const THINKING_TEXT = 'proposal 33 live reasoning should be visible before the final answer';
const BATCH_COMMAND_ONE = 'pnpm exec tsc --noEmit';
const BATCH_COMMAND_TWO = 'pnpm exec vitest run';
const BATCH_OUTPUT = 'proposal 33 batch command output should stay hidden until command output expands';
const FINAL_BODY = 'proposal 33 final assistant body stays visible while thinking and tool calls collapse';

test('@live turn non-body content collapses when final body starts and stays collapsed after refresh', async ({ page }) => {
  test.setTimeout(90_000);
  const persistedState = { ready: false };

  await installRealtimeSocketHarness(page);
  await installMessagesRoute(page, persistedState);
  await openFixtureProject(page);
  await openManualSessionRoute(page);

  const transcript = page.locator('[data-testid="chat-scroll-container"]').last();

  await emitLiveItem(page, {
    itemType: 'reasoning',
    itemId: 'proposal-33-thinking',
    message: { role: 'assistant', content: THINKING_TEXT },
  });
  await emitLiveItem(page, {
    itemType: 'command_execution',
    itemId: 'proposal-33-batch',
    command: `${BATCH_COMMAND_ONE}\n${BATCH_COMMAND_TWO}`,
    output: BATCH_OUTPUT,
    status: 'completed',
    exitCode: 0,
  });

  await expect(transcript.getByText(THINKING_TEXT, { exact: true })).toBeVisible();
  await expect(transcript.getByText(BATCH_COMMAND_ONE)).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'live.png'), fullPage: true });

  await emitLiveItem(page, {
    itemType: 'agent_message',
    itemId: 'proposal-33-final',
    status: 'completed',
    message: { role: 'assistant', content: FINAL_BODY },
  });

  await expect(transcript.getByText(FINAL_BODY, { exact: true })).toBeVisible();
  const nonBodyGroup = transcript.getByTestId('turn-non-body-group').first();
  await expect(nonBodyGroup).toBeVisible();
  await expect(transcript.getByText(THINKING_TEXT, { exact: true })).toBeHidden();
  await expect(transcript.getByText(BATCH_OUTPUT, { exact: true })).toBeHidden();

  persistedState.ready = true;
  await page.reload({ waitUntil: 'networkidle' });
  const reloadedTranscript = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(reloadedTranscript.getByText(FINAL_BODY, { exact: true })).toBeVisible();
  await expect(reloadedTranscript.getByTestId('turn-non-body-group').first()).toBeVisible();
  await expect(reloadedTranscript.getByText(THINKING_TEXT, { exact: true })).toBeHidden();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'collapsed-after-body.png'), fullPage: true });

  await writeStateEvidence(page);
});

test('@detail users can expand outer group, tool group, and command output', async ({ page }) => {
  test.setTimeout(90_000);
  const persistedState = { ready: true };

  await installMessagesRoute(page, persistedState);
  await openFixtureProject(page);
  await openManualSessionRoute(page);

  const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(transcript.getByText(FINAL_BODY, { exact: true })).toBeVisible();

  await transcript.getByTestId('turn-non-body-toggle').first().click();
  await expect(transcript.getByTestId('turn-thinking-group')).toBeVisible();
  const toolGroup = transcript.getByTestId('turn-tool-group').first();
  await expect(toolGroup).toBeVisible();

  await toolGroup.click();
  await expect(transcript.getByTestId('turn-tool-command').filter({ hasText: BATCH_COMMAND_ONE })).toBeVisible();
  await expect(transcript.getByTestId('turn-tool-command').filter({ hasText: BATCH_COMMAND_TWO })).toBeVisible();

  const outputToggle = transcript.locator('summary, button').filter({ hasText: /output|show|输出/i }).first();
  await outputToggle.click();
  await expect(transcript.getByText(BATCH_OUTPUT, { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'expanded-detail.png'), fullPage: true });

  await writeStateEvidence(page);
});

async function installRealtimeSocketHarness(page) {
  /** Capture the real app WebSocket so fixture events use production listeners. */
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

async function openManualSessionRoute(page) {
  /** Open a provider-hinted manual session route after fixture project selection. */
  const query = new URLSearchParams({
    provider: PROVIDER,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionSummary: 'proposal 33 turn non-body collapse',
  });
  await page.goto(`/session/${SESSION_ID}?${query.toString()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ozwActiveChatSocket?.readyState === window.WebSocket.OPEN, null, { timeout: 20_000 }).catch(() => null);
}

async function installMessagesRoute(page, persistedState) {
  /** Use real chat UI with a deterministic persisted transcript after refresh. */
  await page.route(`**/api/projects/**/sessions/${SESSION_ID}/messages**`, async (route) => {
    const messages = persistedState.ready ? buildPersistedMessages() : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages,
        total: messages.length,
        hasMore: false,
        source: 'proposal-33-turn-collapse-fixture',
      }),
    });
  });
}

async function emitLiveItem(page, item) {
  /** Push one native runtime item through the same browser listener as live sessions. */
  await page.evaluate((payload) => {
    const socket = window.__ozwActiveChatSocket;
    if (!socket) {
      throw new Error('No active chat WebSocket captured');
    }
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }, {
    type: `${PROVIDER}-response`,
    sessionId: SESSION_ID,
    ozwSessionId: SESSION_ID,
    data: {
      type: 'item',
      ...item,
    },
  });
}

function buildPersistedMessages() {
  /** Build the persisted transcript users see after reload. */
  const timestamp = '2026-06-28T12:30:00.000Z';
  return [
    {
      type: 'thinking',
      timestamp,
      provider: PROVIDER,
      messageKey: 'proposal-33-thinking',
      message: { role: 'assistant', content: THINKING_TEXT },
    },
    {
      type: 'tool_use',
      timestamp,
      provider: PROVIDER,
      messageKey: 'proposal-33-batch-tool',
      toolName: 'Bash',
      toolCallId: 'proposal-33-batch',
      toolInput: { command: `${BATCH_COMMAND_ONE}\n${BATCH_COMMAND_TWO}` },
    },
    {
      type: 'tool_result',
      timestamp,
      provider: PROVIDER,
      messageKey: 'proposal-33-batch-result',
      toolName: 'Bash',
      toolCallId: 'proposal-33-batch',
      output: BATCH_OUTPUT,
      isError: false,
    },
    {
      type: 'assistant',
      timestamp,
      provider: PROVIDER,
      messageKey: 'proposal-33-final',
      message: { role: 'assistant', content: FINAL_BODY },
    },
  ];
}

async function writeStateEvidence(page) {
  /** Persist a compact DOM state snapshot for manual QA review. */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const state = await page.locator('[data-testid="chat-scroll-container"]').last().evaluate((node) => ({
    nonBodyGroups: node.querySelectorAll('[data-testid="turn-non-body-group"]').length,
    thinkingGroups: node.querySelectorAll('[data-testid="turn-thinking-group"]').length,
    toolGroups: node.querySelectorAll('[data-testid="turn-tool-group"]').length,
    toolCommands: node.querySelectorAll('[data-testid="turn-tool-command"]').length,
    visibleText: node.textContent,
  }));
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'state.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), state }, null, 2)}\n`,
    'utf8',
  );
}
