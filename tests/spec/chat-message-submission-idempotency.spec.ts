// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Acceptance tests for duplicate chat submission prevention, especially
 * for attachment-bearing messages whose upload window can otherwise trigger reentry.
 * Derived from openspec/changes/4-fix-duplicate-image-message-submission/specs/chat-message-submission-idempotency/spec.md.
 */
import { test, expect } from '@playwright/test';

import {
  authenticatePage,
  openFixtureProject,
  resetWorkspaceProject,
} from './helpers/spec-test-helpers.ts';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbwAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Attach one in-memory PNG through the hidden chat file input.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @returns {Promise<void>}
 */
async function attachPng(page, name = 'fixture.png') {
  await page.locator('input[type="file"]').first().setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: ONE_PIXEL_PNG,
  });
}

/**
 * Find the primary composer controls in the current chat view.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {{ textarea: import('@playwright/test').Locator, sendButton: import('@playwright/test').Locator }}
 */
function composer(page) {
  return {
    textarea: page.locator('textarea').first(),
    sendButton: page.locator('form button[type="submit"]').first(),
  };
}

/**
 * Open a concrete fixture chat so the composer is visible.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function openFixtureChat(page) {
  await openFixtureProject(page);
  await page.getByRole('button', { name: /fixture-project manu/i }).first().click();
  await expect(page.locator('textarea').first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('submitting an attachment message twice during a slow upload still creates one user message', async ({ page }) => {
  /** Scenario: 带附件的消息在慢上传期间被连续点击发送 */
  const marker = 'attachment-upload-single-submit-marker';
  let uploadCalls = 0;
  let resolveUploadStarted;
  const uploadStarted = new Promise((resolve) => {
    resolveUploadStarted = resolve;
  });

  await page.route('**/api/projects/**/upload-attachments', async (route) => {
    uploadCalls += 1;
    resolveUploadStarted();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        attachments: [
          {
            name: 'slow-upload.png',
            relativePath: 'slow-upload.png',
            absolutePath: '/tmp/ozw-uploads/slow-upload.png',
            size: ONE_PIXEL_PNG.length,
            mimeType: 'image/png',
          },
        ],
      }),
    });
  });

  await openFixtureChat(page);
  const { textarea, sendButton } = composer(page);
  await textarea.fill(marker);
  await attachPng(page, 'slow-upload.png');

  await sendButton.click();
  await uploadStarted;
  await sendButton.click({ force: true });

  await expect(page.locator('.chat-message.user').filter({ hasText: marker })).toHaveCount(1);
  expect(uploadCalls).toBe(1);
});

test('one touch-originated send with an attachment is not replayed by the follow-up mouse event', async ({ page }) => {
  /** Scenario: 同一条带附件草稿同时触发触摸和鼠标发送事件 */
  const marker = 'attachment-touch-mouse-dedup-marker';
  let uploadCalls = 0;

  await page.route('**/api/projects/**/upload-attachments', async (route) => {
    uploadCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        attachments: [
          {
            name: 'touch-submit.png',
            relativePath: 'touch-submit.png',
            absolutePath: '/tmp/ozw-uploads/touch-submit.png',
            size: ONE_PIXEL_PNG.length,
            mimeType: 'image/png',
          },
        ],
      }),
    });
  });

  await openFixtureChat(page);
  const { textarea, sendButton } = composer(page);
  await textarea.fill(marker);
  await attachPng(page, 'touch-submit.png');

  await sendButton.click();
  await sendButton.click({ force: true });

  await expect(page.locator('.chat-message.user').filter({ hasText: marker })).toHaveCount(1);
  expect(uploadCalls).toBe(1);
});

test('a failed attachment upload keeps the draft and attachment until the user explicitly retries', async ({ page }) => {
  /** Scenario: 附件上传失败 */
  const marker = 'attachment-upload-failure-preserves-draft-marker';
  let uploadCalls = 0;

  await page.route('**/api/projects/**/upload-attachments', async (route) => {
    uploadCalls += 1;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'fixture upload failed' }),
    });
  });

  await openFixtureChat(page);
  const { textarea, sendButton } = composer(page);
  await textarea.fill(marker);
  await attachPng(page, 'broken-upload.png');

  await sendButton.click();

  await expect(page.locator('.chat-message.error').filter({ hasText: 'Failed to upload attachments' })).toHaveCount(1);
  await expect(textarea).toHaveValue(marker);
  await expect(page.getByText('broken-upload.png').first()).toBeVisible();
  await expect(page.locator('.chat-message.user').filter({ hasText: marker })).toHaveCount(0);
  expect(uploadCalls).toBe(1);
});
