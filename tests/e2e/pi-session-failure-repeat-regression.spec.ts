// @ts-nocheck -- Acceptance regression exercises browser/runtime contracts before implementation.
/**
 * PURPOSE: Verify Pi manual-session failure and repeat-submit behavior through
 * the real browser, WebSocket, fake native Pi runtime, project API, and
 * persisted transcript read model.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  openFixtureProject,
} from '../spec/helpers/spec-test-helpers.ts';

const DISCONNECTED_SUBMIT_MESSAGE =
  '当前与服务端的实时连接已断开，消息不会被发送。请等待重连后重试。';
const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/pi-session-58');

test.setTimeout(90_000);

async function openNewPiSession(page) {
  /**
   * Create a Pi manual session from the same project overview path a user uses.
   */
  page.once('dialog', async (dialog) => {
    await dialog.accept('Pi failure repeat acceptance');
  });
  await openFixtureProject(page);
  await page.getByRole('button', { name: 'New Session' }).click();
  await expect(page.getByTestId('project-new-session-provider-picker')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('project-new-session-provider-pi').click({ noWaitAfter: true });
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pi-model-unavailable')).toHaveCount(0, { timeout: 20_000 });
}

async function submitComposerMessage(page, text) {
  /**
   * Send text through the visible chat composer by pressing Ctrl+Enter.
   */
  const composerInput = page.locator('textarea').first();
  await expect(composerInput).toBeEnabled({ timeout: 20_000 });
  await composerInput.fill(text);
  await composerInput.press('Control+Enter');
}

async function expectTranscriptOnce(transcript, text) {
  /**
   * Assert a user or assistant transcript row appears once after UI/read-model convergence.
   */
  await expect(transcript.getByText(text, { exact: true })).toBeVisible({ timeout: 25_000 });
  await expect(transcript.getByText(text, { exact: true })).toHaveCount(1, { timeout: 25_000 });
}

async function installPiCommandCapture(page) {
  /**
   * Capture outbound Pi commands while keeping the real browser WebSocket path.
   */
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    try {
      window.__capturedPiCommands = JSON.parse(window.localStorage.getItem('__capturedPiCommands') || '[]');
    } catch {
      window.__capturedPiCommands = [];
    }

    function PatchedWebSocket(...args) {
      const ws = new OriginalWebSocket(...args);
      const originalSend = ws.send.bind(ws);
      ws.send = function sendWithPiCapture(data) {
        try {
          const message = JSON.parse(data);
          if (message?.type === 'pi-command') {
            window.__capturedPiCommands.push(message);
            window.localStorage.setItem('__capturedPiCommands', JSON.stringify(window.__capturedPiCommands));
          }
        } catch {
          // Non-JSON frames are not chat commands.
        }
        return originalSend(data);
      };
      return ws;
    }

    PatchedWebSocket.prototype = OriginalWebSocket.prototype;
    for (const key of ['OPEN', 'CONNECTING', 'CLOSING', 'CLOSED']) {
      PatchedWebSocket[key] = OriginalWebSocket[key];
    }
    window.WebSocket = PatchedWebSocket;
  });
}

test.describe('Pi manual session failure and repeat-submit regression', () => {
  test.slow();

  test('断线发送失败不污染 transcript，重连后同一输入可成功发送并刷新恢复', { timeout: 90_000 }, async ({ page }) => {
    await installPiCommandCapture(page);
    await openNewPiSession(page);
    await page.waitForFunction(() => typeof window.__ozwTestCloseWebSocket === 'function');

    const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
    const messageText = 'Pi失败态-58-断线后重试同一条需求';
    const responseText = `fake pi response: ${messageText}`;

    await page.evaluate(() => window.__ozwTestCloseWebSocket());
    await expect(page.getByText('Disconnected')).toBeVisible({ timeout: 5_000 });

    const composerInput = page.locator('textarea').first();
    await composerInput.fill(messageText);
    await composerInput.press('Control+Enter');
    await expect(transcript.getByText(DISCONNECTED_SUBMIT_MESSAGE, { exact: true })).toHaveCount(1);
    await expect(transcript.getByText(messageText, { exact: true })).toHaveCount(0);

    await expect(page.getByText('Disconnected')).toHaveCount(0, { timeout: 5_000 });
    await composerInput.press('Control+Enter');
    await expectTranscriptOnce(transcript, messageText);
    await expectTranscriptOnce(transcript, responseText);

    await page.reload({ waitUntil: 'networkidle' });
    const reloadedTranscript = page.locator('[data-testid="chat-scroll-container"]').last();
    await expectTranscriptOnce(reloadedTranscript, messageText);
    await expectTranscriptOnce(reloadedTranscript, responseText);
    await expect(reloadedTranscript.getByText(DISCONNECTED_SUBMIT_MESSAGE, { exact: true })).toHaveCount(0);

    await writeDisconnectedRetryEvidence(page, messageText);
  });

  test('重复提交同一 Pi 输入只发送一次并且刷新后不重复显示', { timeout: 90_000 }, async ({ page }) => {
    await installPiCommandCapture(page);
    await openNewPiSession(page);

    const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
    const messageText = 'Pi重复操作-58-快速重复提交只保留一次';
    const responseText = `fake pi response: ${messageText}`;
    const composerInput = page.locator('textarea').first();
    const composerForm = composerInput.locator('xpath=ancestor::form[1]');

    await composerInput.fill(messageText);
    await composerForm.evaluate((form) => {
      form.requestSubmit();
      form.requestSubmit();
    });

    await expectTranscriptOnce(transcript, messageText);
    await expectTranscriptOnce(transcript, responseText);

    const piCommandCount = await page.evaluate((text) => {
      return (window.__capturedPiCommands || []).filter((message) => message.command === text).length;
    }, messageText);
    expect(piCommandCount).toBe(1);

    await page.reload({ waitUntil: 'networkidle' });
    const reloadedTranscript = page.locator('[data-testid="chat-scroll-container"]').last();
    await expectTranscriptOnce(reloadedTranscript, messageText);
    await expectTranscriptOnce(reloadedTranscript, responseText);
  });
});

async function writeDisconnectedRetryEvidence(page, retriedText) {
  /**
   * Persist the network-level proof that disconnected submit sent no Pi command
   * and the reconnected retry sent exactly one command.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const commands = await page.evaluate(() => window.__capturedPiCommands || []);
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'disconnected-retry-network.json'),
    `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      retriedText,
      piCommandCount: commands.filter((message) => message.command === retriedText).length,
      commands,
    }, null, 2)}\n`,
    'utf8',
  );
}
