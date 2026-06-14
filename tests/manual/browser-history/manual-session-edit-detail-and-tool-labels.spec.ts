// @ts-nocheck -- Proposal contract test runs before implementation and uses browser-level fixtures.
/**
 * PURPOSE: Lock the manual-session business path where users inspect Edit tool
 * diffs and read file/command cards without internal tool group names.
 */
import { test, expect } from '@playwright/test';

import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
  writeWorkspaceTextFile,
} from './helpers/spec-test-helpers.ts';

const EDIT_PATH = 'frontend/proposal-65-edit-target.ts';
const READ_PATH = 'frontend/proposal-65-read-target.ts';
const OLD_TEXT = 'export const proposal65 = "before";';
const NEW_TEXT = 'export const proposal65 = "after";';
const READ_TEXT = 'proposal 65 read output remains inspectable';
const EXEC_COMMAND = 'pnpm exec ozw-proposal-65 --inspect-tool-labels';
const EXEC_OUTPUT = 'proposal 65 exec output remains hidden until expanded';
const SESSION_IDS = {
  pi: 'c6501',
  codex: 'c6502',
};

test.describe('proposal 65 manual session Edit detail and tool labels', () => {
  for (const provider of ['pi', 'codex']) {
    test(`${provider} Edit detail opens without runtime errors and tool labels stay hidden`, async ({ page }) => {
      /**
       * Exercise the shared Pi/Codex transcript renderer through the browser route
       * users open when inspecting a restored manual session.
       */
      const runtimeErrors = [];
      page.on('pageerror', (error) => runtimeErrors.push(error.message));
      page.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error' && /TypeError|ReferenceError|Cannot read|Cannot convert|React/i.test(text)) {
          runtimeErrors.push(text);
        }
      });

      await writeWorkspaceTextFile(EDIT_PATH, OLD_TEXT);
      await writeWorkspaceTextFile(READ_PATH, READ_TEXT);
      await installSessionMessagesMock(page, SESSION_IDS[provider], provider);
      await openFixtureProject(page, { reset: false });
      await openManualSessionRoute(page, SESSION_IDS[provider], provider);

      const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
      await expect(transcript.getByText(EDIT_PATH.split('/').pop(), { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(transcript.getByText(READ_PATH, { exact: true })).toBeVisible();
      await expect(transcript.getByText(EXEC_COMMAND, { exact: true })).toBeVisible();

      await expectNoToolGroupNames(transcript);

      const editCard = transcript.getByTestId('codex-tool-card').filter({ hasText: EDIT_PATH.split('/').pop() }).first();
      await editCard.locator('summary').first().click();
      await expect(editCard.getByText(OLD_TEXT, { exact: true })).toBeVisible();
      await expect(editCard.getByText(NEW_TEXT, { exact: true })).toBeVisible();

      const openButton = editCard.getByRole('button', { name: /^open$/i }).first();
      await openButton.click();
      await expect(page.getByText(EDIT_PATH.split('/').pop(), { exact: true }).first()).toBeVisible();
      expect(runtimeErrors, 'inspecting Edit details must not throw browser runtime errors').toEqual([]);
    });
  }
});

async function openManualSessionRoute(page, sessionId, provider) {
  /**
   * Open a provider-hinted manual session route after the fixture project exists.
   */
  const query = new URLSearchParams({
    provider,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionSummary: `proposal 65 ${provider} Edit detail fixture`,
  });
  await page.goto(`/session/${sessionId}?${query.toString()}`, { waitUntil: 'networkidle' });
}

async function installSessionMessagesMock(page, sessionId, provider) {
  /**
   * Fulfill the manual session read model with realistic persisted tool calls
   * for Edit, Read, and exec_command.
   */
  const messages = buildPersistedMessages(provider);
  await page.route(`**/api/projects/**/sessions/${sessionId}/messages**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages,
        total: messages.length,
        hasMore: false,
        source: `proposal-65-${provider}-fixture`,
      }),
    });
  });
}

function buildPersistedMessages(provider) {
  /**
   * Build the transcript shape returned by provider session message endpoints.
   */
  const timestamp = '2026-06-03T09:20:00.000Z';
  return [
    assistantToolUse(`${provider}-65-edit-message`, `${provider}-65-edit`, provider, 'Edit', {
      file_path: EDIT_PATH,
      old_string: OLD_TEXT,
      new_string: NEW_TEXT,
    }, timestamp),
    toolResult(`${provider}-65-edit-result`, `${provider}-65-edit`, provider, 'edited successfully', false, timestamp),
    assistantToolUse(`${provider}-65-read-message`, `${provider}-65-read`, provider, 'Read', {
      file_path: READ_PATH,
    }, timestamp),
    toolResult(`${provider}-65-read-result`, `${provider}-65-read`, provider, READ_TEXT, false, timestamp),
    assistantToolUse(`${provider}-65-exec-message`, `${provider}-65-exec`, provider, 'exec_command', {
      cmd: EXEC_COMMAND,
    }, timestamp),
    toolResult(`${provider}-65-exec-result`, `${provider}-65-exec`, provider, EXEC_OUTPUT, false, timestamp),
  ];
}

function assistantToolUse(messageKey, toolCallId, provider, toolName, input, timestamp) {
  /**
   * Create an assistant tool-use content part as persisted provider history.
   */
  return {
    type: 'message',
    timestamp,
    provider,
    messageKey,
    message: {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: toolCallId,
        name: toolName,
        input,
      }],
    },
  };
}

function toolResult(messageKey, toolCallId, provider, content, isError, timestamp) {
  /**
   * Create a persisted user-side tool result envelope attached by tool id.
   */
  return {
    type: 'message',
    timestamp,
    provider,
    messageKey,
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolCallId,
        content,
        is_error: isError,
      }],
    },
  };
}

async function expectNoToolGroupNames(transcript) {
  /**
   * Assert visible card chrome hides implementation-only command names while
   * concrete built-in file operation intent remains visible.
   */
  const visibleToolText = await transcript.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="codex-tool-card"]')];
    return cards.map((card) => {
      const summaries = [...card.querySelectorAll('summary')].map((summary) => summary.textContent || '');
      return {
        text: card.textContent || '',
        summaries,
      };
    });
  });

  const combinedText = visibleToolText.map((entry) => entry.text).join('\n');
  const combinedSummaries = visibleToolText.flatMap((entry) => entry.summaries).join('\n');

  expect(combinedText).toContain(READ_PATH);
  expect(combinedText).toContain(EXEC_COMMAND);
  expect(combinedText).not.toMatch(/\bexec_command\b|functions\.exec_command/);
  expect(combinedText).toContain('Read');
  expect(combinedSummaries).not.toMatch(/\bRead\b[\s\S]*File content/);
  expect(combinedSummaries).not.toMatch(/\bEdit\s*\//);
}
