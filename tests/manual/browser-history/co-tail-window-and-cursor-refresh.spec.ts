// @ts-nocheck -- Test isolation: strict types deferred.
/**
 * PURPOSE: Browser acceptance for co session message persistence and ordering.
 * proposal: 47-恢复消息尾部快开和实时增量刷新
 *
 * Verifies that:
 * 1. A co-backed session with multiple turns persists messages across reload.
 * 2. Messages are rendered in the chat container.
 * 3. The most recent message content appears after reload (tail-window semantics).
 */
import { test, expect } from '@playwright/test';

import {
  authenticatePage,
  openFixtureProject,
} from './helpers/spec-test-helpers.ts';

async function openNewProviderSession(page: any, provider: string) {
  page.once('dialog', async (dialog: any) => {
    await dialog.accept(`${provider} co tail-window acceptance`);
  });
  await page.getByTestId('project-overview-manual-sessions')
    .getByRole('button', { name: /新建会话|New Session/i }).click();
  await page.getByTestId(`project-new-session-provider-${provider}`).click();
  await expect(page.locator('textarea').first()).toBeVisible();
}

async function sendPrompt(page: any, marker: string) {
  const chatContainer = page.locator('[data-testid="chat-scroll-container"]').last();
  const composerInput = page.locator('textarea').first();
  const composerForm = composerInput.locator('xpath=ancestor::form[1]');
  await composerInput.fill(marker);
  await expect(composerForm.locator('button[type="submit"]')).toBeEnabled();
  await composerForm.evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(chatContainer).toContainText(marker);
  // Wait for fake co response
  await expect(chatContainer.getByText(`fake co response: ${marker}`).last())
    .toBeVisible({ timeout: 20_000 });
}

test.beforeEach(async ({ page }) => {
  await authenticatePage(page);
});

test('co session persists multiple turns and shows them after reload', async ({ page }) => {
  test.setTimeout(60_000);

  await openFixtureProject(page);
  await openNewProviderSession(page, 'codex');

  // Turn 1
  const marker1 = 'co-turn-1-tail-window';
  await sendPrompt(page, marker1);

  // Turn 2 — the latest turn, must be visible after reload.
  const marker2 = 'co-turn-2-latest-visible';
  await sendPrompt(page, marker2);

  // Reload and verify both turns are visible, with the latest at the bottom.
  const url = page.url();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page).toHaveURL(url);

  const chatContainer = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(chatContainer).toBeVisible({ timeout: 15_000 });

  // Both markers must be present.
  await expect(chatContainer).toContainText(marker1, { timeout: 10_000 });
  await expect(chatContainer).toContainText(marker2, { timeout: 10_000 });

  // Verify the latest marker appears AFTER the first marker in the DOM
  // (chronological order with latest at the bottom).
  const allText = await chatContainer.textContent();
  const pos1 = allText.indexOf(marker1);
  const pos2 = allText.indexOf(marker2);
  expect(pos2).toBeGreaterThan(pos1);
});
