// @ts-nocheck -- Proposal acceptance spec runs against the current browser app.
/**
 * PURPOSE: Verify Pi manual sessions across daily send, follow-up, steer, live
 * refresh convergence, and browser reload recovery.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  openFixtureProject,
} from './helpers/spec-test-helpers.ts';

const DAILY_REQUEST = 'Pi日常发送需求-58-请总结当前项目';
const DAILY_RESPONSE = `fake pi response: ${DAILY_REQUEST}`;
const FOLLOWUP_REQUEST = 'Pi补充需求-58-请补充风险';
const FOLLOWUP_RESPONSE = `fake pi response: ${FOLLOWUP_REQUEST}`;
const STEER_START_REQUEST = 'Pi steer需求-58-开始一个需要调整的任务';
const STEER_START_RESPONSE = `fake pi response: ${STEER_START_REQUEST}`;
const STEER_REQUEST = 'Pi steer需求-58-运行中请改成只输出结论';
const STEER_RESPONSE = `fake pi response: ${STEER_REQUEST}`;
const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/pi-session-58');

test.describe('Pi manual session daily send, follow-up, steer, and reload recovery', () => {
  test.skip(
    process.env.OZW_PLAYWRIGHT_TRACE_RUN === '1',
    'Playwright trace-on runner teardown is tracked outside this Pi business acceptance contract.',
  );

  test('pi daily follow-up steer and reload remain unique', async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);
    await openFixtureProject(page);
    await expect(page.getByTestId('project-workspace-overview')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'New Session' }).click();
    await expect(page.getByTestId('project-new-session-provider-picker')).toBeVisible({ timeout: 10_000 });
    const piSessionButton = page.getByTestId('project-new-session-provider-pi');
    await expect(piSessionButton).toBeVisible({ timeout: 20_000 });
    await piSessionButton.click({ noWaitAfter: true });

    const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
    const composerInput = page.locator('textarea').first();

    await expect(composerInput).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('pi-model-unavailable')).toHaveCount(0, { timeout: 20_000 });

    await submitComposerMessage(page, DAILY_REQUEST);
    await expectTranscriptOnce(transcript, DAILY_REQUEST);
    await expectTranscriptOnce(transcript, DAILY_RESPONSE);

    await submitComposerMessage(page, FOLLOWUP_REQUEST);
    await expectTranscriptOnce(transcript, FOLLOWUP_REQUEST);
    await expectTranscriptOnce(transcript, FOLLOWUP_RESPONSE);
    await expectTranscriptOnce(transcript, DAILY_REQUEST);
    await expectTranscriptOnce(transcript, DAILY_RESPONSE);

    await submitComposerMessage(page, STEER_START_REQUEST);
    await expect(page.getByTestId('pi-running-queue-state')).toBeVisible({ timeout: 5_000 });
    await waitForComposerCooldown(page);
    await submitComposerMessage(page, STEER_REQUEST);
    await expect(page.getByTestId('pi-running-queue-state')).toContainText('Steering 1', { timeout: 10_000 });

    await expectTranscriptOnce(transcript, STEER_START_REQUEST);
    await expectTranscriptOnce(transcript, STEER_START_RESPONSE);
    await expectTranscriptOnce(transcript, STEER_REQUEST);
    await expectTranscriptOnce(transcript, STEER_RESPONSE);

    await page.reload({ waitUntil: 'networkidle' });
    const reloadedTranscript = page.locator('[data-testid="chat-scroll-container"]').last();
    await expect(reloadedTranscript).toBeVisible({ timeout: 20_000 });

    for (const text of [
      DAILY_REQUEST,
      DAILY_RESPONSE,
      FOLLOWUP_REQUEST,
      FOLLOWUP_RESPONSE,
      STEER_START_REQUEST,
      STEER_START_RESPONSE,
      STEER_REQUEST,
      STEER_RESPONSE,
    ]) {
      await expectTranscriptOnce(reloadedTranscript, text);
    }

    await writeReloadEvidence(page, reloadedTranscript);
  });
});

async function submitComposerMessage(page, text) {
  /**
   * Send text exactly as a user would from the visible chat composer.
   */
  const composerInput = page.locator('textarea').first();
  await expect(composerInput).toBeEnabled({ timeout: 20_000 });
  await composerInput.fill(text);
  await composerInput.press('Enter');
  await expect(composerInput).toHaveValue('', { timeout: 5_000 });
}

async function expectTranscriptOnce(transcript, text) {
  /**
   * Assert a completed user or assistant transcript row is visible once after
   * live and persisted message sources converge.
   */
  await expect(transcript.getByText(text, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(transcript.getByText(text, { exact: true })).toHaveCount(1, { timeout: 20_000 });
}

async function waitForComposerCooldown(page) {
  /**
   * Let the submit dedup cooldown pass while the fake Pi turn is still running.
   */
  await page.waitForTimeout(1700);
}

async function writeReloadEvidence(page, transcript) {
  /**
   * Write the screenshot and transcript snapshot required by the acceptance
   * contract after the browser reload has converged to persisted Pi history.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'after-reload.png'), fullPage: true });
  const expectedTexts = [
    DAILY_REQUEST,
    DAILY_RESPONSE,
    FOLLOWUP_REQUEST,
    FOLLOWUP_RESPONSE,
    STEER_START_REQUEST,
    STEER_START_RESPONSE,
    STEER_REQUEST,
    STEER_RESPONSE,
  ];
  const messages = [];
  for (const text of expectedTexts) {
    messages.push({
      text,
      visibleOccurrences: await transcript.getByText(text, { exact: true }).count(),
    });
  }
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'transcript-after-complete.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), messages }, null, 2)}\n`,
    'utf8',
  );
}
