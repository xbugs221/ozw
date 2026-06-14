// @ts-nocheck -- Acceptance regression locks proposed Pi transcript rendering before implementation.
/**
 * PURPOSE: Verify proposal 62 through the real browser Pi chat path: thinking
 * messages load directly without title chrome, completed tool commands stay visible, and
 * tool output stays collapsed until the user explicitly expands it.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from '../spec/helpers/spec-test-helpers.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/pi-session-62');
const ROUTE_SESSION_ID = 'c62';
const USER_PROMPT = 'Pi 62 acceptance: inspect thinking and tool output collapse';
const THINKING_TEXT = 'Pi 62 thinking should be immediately visible after history load';
const SECOND_THINKING_TEXT = 'Pi 62 second thinking block must also reload expanded';
const ASSISTANT_REPLY = 'Pi 62 acceptance complete after collapsed tool outputs';
const BASH_COMMAND = 'pnpm exec ozw-pi-62 --check';
const BASH_OUTPUT = 'Pi 62 Bash stdout line that must start hidden';
const READ_PATH = 'src/components/chat/view/subcomponents/MessageComponent.tsx';
const READ_OUTPUT = 'Pi 62 read output line that must start hidden';
const GREP_PATTERN = 'tool-result-pi-62-grep';
const GREP_OUTPUT = 'src/components/chat/view/subcomponents/MessageComponent.tsx';
const FAILED_COMMAND = 'pnpm exec ozw-pi-62 --fail';
const FAILED_OUTPUT = 'Pi 62 failed stderr line that must start hidden';
const RUNNING_COMMAND = 'sleep 62';

test.describe('Pi proposal 62 thinking and tool output folding', () => {
  test('Pi history loads thinking blocks directly and preserves them after refresh', async ({ page }) => {
    /**
     * Load a provider-hinted Pi route from the browser and assert the native
     * visible thinking text before and after refresh without reintroducing a
     * collapsible Thinking summary.
     */
    const messageResponses = [];
    await installPiSessionMessagesMock(page, messageResponses);
    await openFixtureProject(page);
    await openMockedPiRoute(page);

    await expect(page.getByText(THINKING_TEXT, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(SECOND_THINKING_TEXT, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('summary', { hasText: /Thinking|思考中/i })).toHaveCount(0);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText(THINKING_TEXT, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(SECOND_THINKING_TEXT, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('summary', { hasText: /Thinking|思考中/i })).toHaveCount(0);
    await expect(page.getByText(THINKING_TEXT, { exact: true })).toBeVisible();

    await writeThinkingEvidence(page, messageResponses);
  });

  test('Pi tool cards keep commands visible while success, failed, and anchor outputs stay collapsed until expanded', async ({ page }) => {
    /**
     * Drive the real transcript rendering path with completed, running, failed,
     * and jump-to-result tools, then verify pre/post interaction DOM state.
     */
    const messageResponses = [];
    await installPiSessionMessagesMock(page, messageResponses);
    await openFixtureProject(page);
    await openMockedPiRoute(page);

    const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
    await expect(transcript.getByText(USER_PROMPT, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(transcript.getByText(ASSISTANT_REPLY, { exact: true })).toBeVisible({ timeout: 20_000 });

    await expect(transcript.getByText(BASH_COMMAND, { exact: true })).toBeVisible();
    await expect(transcript.getByText(READ_PATH, { exact: true })).toBeVisible();
    await expect(transcript.getByText(FAILED_COMMAND, { exact: true })).toBeVisible();
    await expect(transcript.getByText(RUNNING_COMMAND, { exact: true })).toBeVisible();
    await expect(transcript.getByText(/Running\.\.\./)).toBeVisible();

    await expectToolOutputState(page, 'pi-62-bash', BASH_OUTPUT, false);
    await expectToolOutputState(page, 'pi-62-read', READ_OUTPUT, false);
    await expectToolOutputState(page, 'pi-62-failed', FAILED_OUTPUT, false);

    await expandToolOutput(page, 'pi-62-bash');
    await expectToolOutputState(page, 'pi-62-bash', BASH_OUTPUT, true);
    await expandToolOutput(page, 'pi-62-bash');
    await expectToolOutputState(page, 'pi-62-bash', BASH_OUTPUT, false);
    await expandToolOutput(page, 'pi-62-bash');
    await expectToolOutputState(page, 'pi-62-bash', BASH_OUTPUT, true);

    await transcript.locator('a[href="#tool-result-pi-62-grep"]').first().click();
    await expectToolOutputState(page, 'pi-62-grep', GREP_OUTPUT, true);

    await page.reload({ waitUntil: 'networkidle' });
    await expectToolOutputState(page, 'pi-62-bash', BASH_OUTPUT, false);
    await expectToolOutputState(page, 'pi-62-read', READ_OUTPUT, false);
    await expectToolOutputState(page, 'pi-62-failed', FAILED_OUTPUT, false);
    await expect(transcript.getByText(BASH_COMMAND, { exact: true })).toBeVisible({ timeout: 20_000 });

    await writeToolEvidence(page, messageResponses);
  });
});

async function openMockedPiRoute(page) {
  /**
   * Open a provider-hinted cN route so the app follows the same Pi history
   * rendering path a user reaches from a restored manual session.
   */
  const query = new URLSearchParams({
    provider: 'pi',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionSummary: 'Pi 62 thinking and tool collapse fixture',
  });
  await page.goto(`/session/${ROUTE_SESSION_ID}?${query.toString()}`, { waitUntil: 'networkidle' });
}

async function installPiSessionMessagesMock(page, messageResponses) {
  /**
   * Fulfill only the target Pi transcript endpoint and record the network
   * contract used by both initial load and browser refresh.
   */
  const messages = buildPiTranscriptMessages();
  await page.route(`**/api/projects/**/sessions/${ROUTE_SESSION_ID}/messages**`, async (route) => {
    const responseBody = {
      messages,
      total: messages.length,
      hasMore: false,
      source: 'pi-62-history-fixture',
    };
    messageResponses.push({
      url: route.request().url(),
      source: responseBody.source,
      total: responseBody.total,
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responseBody),
    });
  });
}

function buildPiTranscriptMessages() {
  /**
   * Build a persisted Pi transcript with thinking, completed tool results,
   * running state, anchor jump output, and a failed tool-result state.
   */
  const timestamp = '2026-06-02T08:20:00.000Z';
  return [
    userMessage('pi-62-user', USER_PROMPT, timestamp),
    thinkingMessage('pi-62-thinking-1', THINKING_TEXT, timestamp),
    thinkingMessage('pi-62-thinking-2', SECOND_THINKING_TEXT, timestamp),
    assistantToolUse('pi-62-bash-message', 'pi-62-bash', 'Bash', { command: BASH_COMMAND }, timestamp),
    userToolResult('pi-62-bash-result', 'pi-62-bash', BASH_OUTPUT, false, timestamp),
    assistantToolUse('pi-62-read-message', 'pi-62-read', 'Read', { file_path: READ_PATH }, timestamp),
    userToolResult('pi-62-read-result', 'pi-62-read', READ_OUTPUT, false, timestamp),
    assistantToolUse('pi-62-grep-message', 'pi-62-grep', 'Grep', { pattern: GREP_PATTERN, path: 'src' }, timestamp),
    userToolResult('pi-62-grep-result', 'pi-62-grep', GREP_OUTPUT, false, timestamp, {
      filenames: [GREP_OUTPUT],
      numFiles: 1,
    }),
    assistantToolUse('pi-62-failed-message', 'pi-62-failed', 'Bash', { command: FAILED_COMMAND }, timestamp),
    userToolResult('pi-62-failed-result', 'pi-62-failed', FAILED_OUTPUT, true, timestamp),
    {
      type: 'tool_use',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-62-running-message',
      toolName: 'Bash',
      toolInput: { command: RUNNING_COMMAND },
      toolCallId: 'pi-62-running',
      status: 'running',
    },
    assistantMessage('pi-62-assistant', ASSISTANT_REPLY, timestamp),
  ];
}

function userMessage(messageKey, text, timestamp) {
  /**
   * Create a persisted user message in the same shape returned by the session
   * messages endpoint.
   */
  return {
    type: 'message',
    timestamp,
    provider: 'pi',
    messageKey,
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  };
}

function assistantMessage(messageKey, text, timestamp) {
  /**
   * Create a normal assistant text message after tool calls complete.
   */
  return {
    type: 'message',
    timestamp,
    provider: 'pi',
    messageKey,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  };
}

function thinkingMessage(messageKey, text, timestamp) {
  /**
   * Create a Pi thinking message that should become an independent thinking card.
   */
  return {
    type: 'thinking',
    timestamp,
    provider: 'pi',
    messageKey,
    message: {
      role: 'assistant',
      content: text,
    },
  };
}

function assistantToolUse(messageKey, toolId, toolName, input, timestamp) {
  /**
   * Create an assistant content-part tool use so tool result metadata, including
   * error and toolUseResult fields, attaches through the normal transformer.
   */
  return {
    type: 'message',
    timestamp,
    provider: 'pi',
    messageKey,
    message: {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: toolId,
        name: toolName,
        input,
      }],
    },
  };
}

function userToolResult(messageKey, toolUseId, content, isError, timestamp, toolUseResult = null) {
  /**
   * Create the persisted user-side tool result envelope used by provider history.
   */
  return {
    type: 'message',
    timestamp,
    provider: 'pi',
    messageKey,
    toolUseResult,
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolUseId,
        content,
        is_error: isError,
      }],
    },
  };
}

async function expectToolOutputState(page, toolId, expectedText, expectedOpen) {
  /**
   * Verify both the closest output details state and the user-visible output text.
   */
  const state = await expect.poll(
    () => readToolOutputState(page, toolId, expectedText),
    { timeout: 10_000 },
  ).toEqual({
    exists: true,
    open: expectedOpen,
    outputVisible: expectedOpen,
  });
  if (!state) {
    return;
  }
  expect(state.exists, `tool-result-${toolId} must exist`).toBe(true);
  expect(state.open, `tool-result-${toolId} output open state`).toBe(expectedOpen);
  expect(state.outputVisible, `${expectedText} visible state`).toBe(expectedOpen);
}

async function expandToolOutput(page, toolId) {
  /**
   * Click the summary belonging to the details that owns tool-result-${toolId}.
   */
  await page.locator(`#tool-result-${toolId}`).evaluate((anchor) => {
    const details = anchor.closest('details');
    const summary = details?.querySelector('summary');
    if (!summary) {
      throw new Error(`No summary found for ${anchor.id}`);
    }
    (summary as HTMLElement).click();
  });
}

async function readToolOutputState(page, toolId, expectedText) {
  /**
   * Snapshot the output details for one tool, including visibility after layout.
   */
  return page.evaluate(({ toolId: evaluatedToolId, expectedText: evaluatedText }) => {
    const anchor = document.getElementById(`tool-result-${evaluatedToolId}`);
    const details = anchor?.closest('details') || null;
    const visibleTextNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.includes(evaluatedText)) {
        continue;
      }
      const element = node.parentElement;
      if (!element) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const visible = rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none';
      visibleTextNodes.push(visible);
    }
    return {
      exists: Boolean(anchor && details),
      open: Boolean(details?.open),
      outputVisible: visibleTextNodes.some(Boolean),
    };
  }, { toolId, expectedText });
}

async function writeThinkingEvidence(page, messageResponses) {
  /**
   * Persist screenshot, network records, and thinking details state after refresh.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await writeNetworkEvidence(messageResponses);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'thinking-after-refresh.png'), fullPage: true });
  const state = await page.evaluate((texts) => ({
    thinkingBlocks: texts.map((text) => {
      const details = [...document.querySelectorAll('details')]
        .find((node) => node.textContent?.includes(text));
      return {
        text,
        exists: Boolean(details),
        open: Boolean(details?.open),
      };
    }),
  }), [THINKING_TEXT, SECOND_THINKING_TEXT]);
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'thinking-state-after-refresh.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), state, messageResponses }, null, 2)}\n`,
    'utf8',
  );
}

async function writeToolEvidence(page, messageResponses) {
  /**
   * Persist screenshot, network records, and output details states after refresh.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await writeNetworkEvidence(messageResponses);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'tool-outputs-after-refresh.png'), fullPage: true });
  const states = [];
  for (const [toolId, expectedText] of [
    ['pi-62-bash', BASH_OUTPUT],
    ['pi-62-read', READ_OUTPUT],
    ['pi-62-grep', GREP_OUTPUT],
    ['pi-62-failed', FAILED_OUTPUT],
  ]) {
    states.push({ toolId, ...(await readToolOutputState(page, toolId, expectedText)) });
  }
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'tool-output-state-after-refresh.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), states, messageResponses }, null, 2)}\n`,
    'utf8',
  );
}

async function writeNetworkEvidence(messageResponses) {
  /**
   * Persist the mocked session messages responses used by initial load and reload.
   */
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'pi-history-message-network.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), messageResponses }, null, 2)}\n`,
    'utf8',
  );
}
