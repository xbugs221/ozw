// @ts-nocheck -- Test typing: parameter annotations pending.
/**
 * PURPOSE: Verify real cN follow-up sends do not duplicate earlier turns in the browser.
 */
import { test, expect } from '@playwright/test';

import {
  openFixtureProject,
} from './helpers/spec-test-helpers.ts';

async function openNewCodexSession(page) {
  /** Start a real manual cN route through the project overview controls. */
  page.once('dialog', async (dialog) => {
    await dialog.accept('codex duplicate history acceptance');
  });
  await page.getByTestId('project-overview-manual-sessions').getByRole('button', { name: /新建会话|New Session/i }).click();
  await page.getByTestId('project-new-session-provider-codex').click();
  await expect(page.locator('textarea').first()).toBeVisible();
}

async function sendPrompt(page, marker) {
  /** Submit through the visible composer so the real WebSocket and co request path run. */
  const chatContainer = page.locator('[data-testid="chat-scroll-container"]').last();
  const composerInput = page.getByRole('textbox', { name: /Type your message/i });
  const composerForm = composerInput.locator('xpath=ancestor::form[1]');
  await composerInput.fill(marker);
  await expect(composerForm.locator('button[type="submit"]')).toBeEnabled();
  await composerForm.evaluate((form) => form.requestSubmit());
  await expect(chatContainer).toContainText(marker);
  await expect(chatContainer.getByText(`fake co response: ${marker}`).last()).toBeVisible({ timeout: 20_000 });
  return chatContainer;
}

test.beforeEach(async ({ page }) => {
  await openFixtureProject(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('selected-provider', 'codex');
  });
});

test('same-page cN follow-up keeps prior and current turns single-copy', async ({ page }) => {
  /** Scenario: Two real follow-up sends in one cN session render each user/assistant row once. */
  await openNewCodexSession(page);
  const firstMarker = 'co duplicate history first followup';
  const secondMarker = 'co duplicate history second followup';

  const chatContainer = await sendPrompt(page, firstMarker);
  await expect(page).toHaveURL(/\/c\d+(?:[?#].*)?$/);
  await expect(page.getByRole('textbox', { name: /Type your message/i })).toBeVisible({ timeout: 20_000 });
  await sendPrompt(page, secondMarker);

  await expect(chatContainer.getByText(firstMarker, { exact: true })).toHaveCount(1);
  await expect(chatContainer.getByText(`fake co response: ${firstMarker}`, { exact: true })).toHaveCount(1);
  await expect(chatContainer.getByText(secondMarker, { exact: true })).toHaveCount(1);
  await expect(chatContainer.getByText(`fake co response: ${secondMarker}`, { exact: true })).toHaveCount(1);
});
