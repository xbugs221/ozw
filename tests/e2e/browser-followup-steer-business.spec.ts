// @ts-nocheck -- Proposal acceptance test: execution phase owns final strictness.
/**
 * PURPOSE: Verify real browser Pi chat sessions can send follow-up and steer
 * messages through the visible UI, real WebSocket, and fake native Pi runner.
 */
import { test, expect } from '@playwright/test';

import {
  authenticatePage,
  openFixtureProject,
} from '../spec/helpers/spec-test-helpers.ts';

async function openNewProviderSession(page, provider) {
  /**
   * Open the provider picker and create a real manual session route.
   */
  page.once('dialog', async (dialog) => {
    await dialog.accept(`${provider} follow-up steer proposal`);
  });
  await page.getByTestId('project-overview-manual-sessions').getByRole('button', { name: /新建会话|New Session/i }).click();
  await page.getByTestId(`project-new-session-provider-${provider}`).click();
  await expect(page.locator('textarea').first()).toBeVisible();
}

function getCurrentConversationId(page) {
  /**
   * Extract the current cN route id used as co conversation_id.
   */
  const matched = page.url().match(/\/c(\d+)(?:[?#].*)?$/);
  if (!matched) {
    throw new Error(`Expected a cN conversation route, got ${page.url()}`);
  }
  return `c${matched[1]}`;
}

async function sendPrompt(page, text) {
  /**
   * Submit text through the visible chat composer using the same UX path as a user.
  */
  const input = page.locator('textarea').first();
  await input.fill(text);
  await input.press('Control+Enter');
  const chat = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(chat).toContainText(text);
  return chat;
}

test.beforeEach(async ({ page }) => {
  await authenticatePage(page);
});

for (const provider of ['pi']) {
  test(`${provider} browser session shows first and idle follow-up responses after reload`, async ({ page }) => {
    test.setTimeout(70_000);
    await openFixtureProject(page);
    await openNewProviderSession(page, provider);

    const firstText = `${provider} proposal first visible turn`;
    const secondText = `${provider} proposal second visible turn`;
    const chat = await sendPrompt(page, firstText);
    const conversationId = getCurrentConversationId(page);
    expect(conversationId).toMatch(/^c\d+$/);
    await expect(chat.getByText(`fake pi response: ${firstText}`).last()).toBeVisible({ timeout: 25_000 });

    await sendPrompt(page, secondText);
    await expect(chat.getByText(`fake pi response: ${secondText}`).last()).toBeVisible({ timeout: 25_000 });

    // Allow the fake co daemon to finish writing conversation state and
    // turn events.jsonl before the reload requests the durable read model.
    // Also allow any async project config saves (attachSessionRouteIndices)
    // to complete before the reload triggers a fresh config read.
    // Allow the fake co daemon to finish writing conversation state
    // and server-side config saves (attachSessionRouteIndices,
    // finalizeManualSessionDraft) to stabilize before reload.
    await page.reload({ waitUntil: 'networkidle' });
    const reloadedChat = page.locator('[data-testid="chat-scroll-container"]').last();
    await expect(reloadedChat).toContainText(firstText);
    await expect(reloadedChat).toContainText(secondText);
    await expect(reloadedChat.getByText(`fake pi response: ${firstText}`)).toHaveCount(1);
    await expect(reloadedChat.getByText(`fake pi response: ${secondText}`)).toHaveCount(1);
  });

  test(`${provider} browser running message is sent as steer to active turn`, async ({ page }) => {
    test.setTimeout(70_000);
    await openFixtureProject(page);
    await openNewProviderSession(page, provider);

    const firstText = `${provider} proposal long running turn`;
    const steerText = `${provider} proposal steer while running`;
    await sendPrompt(page, firstText);
    const conversationId = getCurrentConversationId(page);
    expect(conversationId).toMatch(/^c\d+$/);

    const input = page.locator('textarea').first();
    await expect(page.getByTestId('pi-running-queue-state')).toBeVisible({ timeout: 12_000 });

    await input.fill(steerText);
    await input.press('Control+Enter');
    await expect(page.getByTestId('pi-running-queue-state')).toContainText('Steering 1');

    const chat = page.locator('[data-testid="chat-scroll-container"]').last();
    await expect(chat).toContainText(steerText);
    await expect(chat.getByText(`fake pi response: ${steerText}`).last()).toBeVisible({ timeout: 30_000 });
  });
}
