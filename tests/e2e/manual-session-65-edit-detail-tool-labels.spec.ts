// @ts-nocheck -- Acceptance regression is allowed to fail until proposal 65 is implemented.
/**
 * PURPOSE: Verify proposal 65 through the real browser manual-session route so
 * Codex and Pi persisted Edit/Read/command tool cards expose useful content,
 * hide internal tool group names, survive refresh, and report no runtime crash.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
  writeWorkspaceTextFile,
} from '../spec/helpers/spec-test-helpers.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/manual-session-65-edit-detail-tool-labels');
const EDIT_PATH = 'src/proposal-65-edit-target.ts';
const READ_PATH = 'src/proposal-65-read-target.ts';
const OLD_TEXT = 'export const proposal65 = "before";';
const NEW_TEXT = 'export const proposal65 = "after";';
const READ_TEXT = 'proposal 65 read output remains inspectable';
const EXEC_COMMAND = 'pnpm exec ozw-proposal-65 --inspect-tool-labels';
const EXEC_OUTPUT = 'proposal 65 exec output remains hidden until expanded';
const FAILED_COMMAND = 'pnpm exec ozw-proposal-65 --failed-tool';
const FAILED_OUTPUT = 'proposal 65 failed stderr remains inspectable';
const SESSION_IDS = {
  pi: 'c6503',
  codex: 'c6504',
};

test.describe('manual session proposal 65 Edit details and tool labels', () => {
  for (const provider of ['pi', 'codex']) {
    test(`${provider} Edit detail opens, tool group names stay hidden, and refresh preserves state`, async ({ page }) => {
      /**
       * Drive a restored manual session exactly through the browser route users
       * open while inspecting persisted tool cards and editor-open affordances.
       */
      const sessionId = SESSION_IDS[provider];
      const messageResponses = [];
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
      await installSessionMessagesMock(page, sessionId, provider, messageResponses);
      await openFixtureProject(page, { reset: false });
      await openManualSessionRoute(page, sessionId, provider);

      const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
      await assertInitialToolContent(transcript);
      await assertNoToolGroupNames(transcript);

      const editCard = transcript.getByTestId('codex-tool-card').filter({ hasText: EDIT_PATH.split('/').pop() }).first();
      await editCard.locator('summary').first().click();
      await expect(editCard.getByText(OLD_TEXT, { exact: true })).toBeVisible();
      await expect(editCard.getByText(NEW_TEXT, { exact: true })).toBeVisible();

      await editCard.getByRole('button', { name: /^open$/i }).first().click();
      await expect(page.getByText(EDIT_PATH.split('/').pop(), { exact: true }).first()).toBeVisible();

      const commandCard = transcript.getByTestId('codex-tool-card').filter({ hasText: EXEC_COMMAND }).first();
      await expect(commandCard.getByText(EXEC_OUTPUT, { exact: true })).toBeHidden();
      await toggleOutputAndAssert(commandCard, EXEC_OUTPUT);

      const failedCard = transcript.getByTestId('codex-tool-card').filter({ hasText: FAILED_COMMAND }).first();
      await expect(failedCard).toBeVisible();
      await expect(failedCard.getByText(FAILED_OUTPUT, { exact: true })).toBeHidden();
      await toggleOutputAndAssert(failedCard, FAILED_OUTPUT);

      await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: EXEC_COMMAND })).toHaveCount(1);
      await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: FAILED_COMMAND })).toHaveCount(1);

      await page.reload({ waitUntil: 'networkidle' });
      const reloadedTranscript = page.locator('[data-testid="chat-scroll-container"]').last();
      await assertInitialToolContent(reloadedTranscript);
      await assertNoToolGroupNames(reloadedTranscript);
      await expect(reloadedTranscript.getByTestId('codex-tool-card').filter({ hasText: EXEC_COMMAND })).toHaveCount(1);
      await expect(reloadedTranscript.getByTestId('codex-tool-card').filter({ hasText: FAILED_COMMAND })).toHaveCount(1);

      expect(runtimeErrors, 'proposal 65 Edit inspection must not throw browser runtime errors').toEqual([]);
      await writeEvidence(page, provider, sessionId, messageResponses, runtimeErrors);
    });
  }
});

async function openManualSessionRoute(page, sessionId, provider) {
  /**
   * Open a provider-hinted restored manual-session route after fixture project
   * selection so the chat view uses the persisted message read model.
   */
  const query = new URLSearchParams({
    provider,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionSummary: `proposal 65 ${provider} Edit detail root regression`,
  });
  await page.goto(`/session/${sessionId}?${query.toString()}`, { waitUntil: 'networkidle' });
}

async function installSessionMessagesMock(page, sessionId, provider, messageResponses) {
  /**
   * Fulfill the restored-session messages endpoint with realistic Edit, Read,
   * successful command, and failed command tool records.
   */
  const messages = buildPersistedMessages(provider);
  await page.route(`**/api/projects/**/sessions/${sessionId}/messages**`, async (route) => {
    const responseBody = {
      messages,
      total: messages.length,
      hasMore: false,
      source: `proposal-65-${provider}-root-fixture`,
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

async function assertInitialToolContent(transcript) {
  /**
   * Assert the useful business content a user needs remains visible before any
   * card-specific interaction.
   */
  await expect(transcript.getByText(EDIT_PATH, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(transcript.getByText(READ_PATH, { exact: true })).toBeVisible();
  await expect(transcript.getByText(EXEC_COMMAND, { exact: true })).toBeVisible();
  await expect(transcript.getByText(FAILED_COMMAND, { exact: true })).toBeVisible();
}

async function assertNoToolGroupNames(transcript) {
  /**
   * Inspect rendered tool card text and summaries to ensure implementation
   * names are not exposed as visible labels while concrete content remains.
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
  expect(combinedText).toContain(FAILED_COMMAND);
  expect(combinedText).not.toMatch(/\bexec_command\b|functions\.exec_command/);
  expect(combinedSummaries).not.toMatch(/\bRead\s+tool\b/);
  expect(combinedSummaries).not.toMatch(/\bEdit\s+file\b/);
  expect(combinedSummaries).not.toMatch(/\bexec_command\b|functions\.exec_command/);
}

async function toggleOutputAndAssert(card, output) {
  /**
   * Verify repeated output expansion keeps content inspectable without adding
   * duplicate cards or losing the collapsed default state.
   */
  const outputToggle = card.getByRole('button', { name: /show output|hide output/i }).first();
  await outputToggle.click();
  await expect(card.getByText(output, { exact: true })).toBeVisible();
  await outputToggle.click();
  await expect(card.getByText(output, { exact: true })).toBeHidden();
  await outputToggle.click();
  await expect(card.getByText(output, { exact: true })).toBeVisible();
}

function buildPersistedMessages(provider) {
  /**
   * Build persisted provider history in the shape returned by session message
   * endpoints after users reopen an existing manual session.
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
    assistantToolUse(`${provider}-65-failed-message`, `${provider}-65-failed`, provider, 'functions.exec_command', {
      cmd: FAILED_COMMAND,
    }, timestamp),
    toolResult(`${provider}-65-failed-result`, `${provider}-65-failed`, provider, FAILED_OUTPUT, true, timestamp),
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

async function writeEvidence(page, provider, sessionId, messageResponses, runtimeErrors) {
  /**
   * Persist deterministic QA artifacts for screenshots, mocked network calls,
   * browser runtime errors, and rendered tool-card state after refresh.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${provider}-edit-detail-after-refresh.png`),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, `${provider}-messages-network.json`),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), sessionId, provider, messageResponses }, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(EVIDENCE_DIR, `${provider}-runtime-errors.json`),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), sessionId, provider, runtimeErrors }, null, 2)}\n`,
    'utf8',
  );

  const state = await page.locator('[data-testid="chat-scroll-container"]').last().evaluate((node) => {
    const cards = Array.from(node.querySelectorAll('[data-testid="codex-tool-card"]'));
    return cards.map((card) => ({
      text: card.textContent,
      summaries: Array.from(card.querySelectorAll('summary')).map((summary) => summary.textContent),
      outputButtons: Array.from(card.querySelectorAll('button[aria-expanded]')).map((button) => ({
        label: button.getAttribute('aria-label'),
        expanded: button.getAttribute('aria-expanded'),
      })),
    }));
  });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, `${provider}-tool-card-state.json`),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), sessionId, provider, state }, null, 2)}\n`,
    'utf8',
  );
}
