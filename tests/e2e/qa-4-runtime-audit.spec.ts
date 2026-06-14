import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, Page, test } from '@playwright/test';

import {
  openFixtureProject,
} from '../spec/helpers/spec-test-helpers.ts';

const BASE_EVIDENCE = path.resolve(process.cwd(), 'test-results/pi-session-60');

type Viewport = 'desktop' | 'mobile';

async function runRuntimeAudit(page: Page, viewport: Viewport) {
  const evidenceFile = path.join(BASE_EVIDENCE, `qa4-${viewport}-evidence.json`);
  const screenshotPath = path.join(BASE_EVIDENCE, `qa4-${viewport}-controls.png`);

  const consoleMessages: string[] = [];
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  const failedResponses: string[] = [];

  page.on('console', (message) => {
    const line = `${message.type()}: ${message.text()}`;
    consoleMessages.push(line);
    if (message.type() === 'error') {
      consoleErrors.push(line);
    }
  });

  page.on('pageerror', (error) => {
    const line = `pageerror: ${error.message}`;
    consoleErrors.push(line);
  });

  page.on('requestfailed', (request) => {
    requestFailures.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText || 'failed'}`);
  });

  page.on('response', (response) => {
    if (!response.ok()) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.setViewportSize(viewport === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });

  await page.goto('/');

  const loadingBadge = page.getByText('Loading...');
  const loadingStateObserved = (await loadingBadge.count()) > 0;

  await openFixtureProject(page);
  const loadingCleared = await loadingBadge.count() === 0;

  const emptyStateCandidates = [
    page.getByText('Continue your conversation'),
    page.getByText('Ask questions about your code, request changes, or get help with development tasks'),
    page.getByText('Continue your conversation', { exact: false }),
  ];
  let emptyStateText = null as string | null;
  for (const locator of emptyStateCandidates) {
    const count = await locator.count();
    if (count > 0) {
      const text = await locator.first().textContent();
      emptyStateText = text || '';
      break;
    }
  }

  await page.getByRole('button', { name: /New Session|新建/ }).click();
  await expect(page.getByTestId('project-new-session-provider-picker')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('project-new-session-provider-pi').click({ noWaitAfter: true });

  const composerInput = page.locator('textarea').first();
  await expect(composerInput).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pi-model-unavailable')).toHaveCount(0, { timeout: 20_000 });

  const modelSelect = page.getByTestId('session-model-select');
  const depthSelect = page.getByTestId('session-depth-select');
  await expect(page.getByTestId('session-model-controls-trigger')).toHaveCount(0, { timeout: 10_000 });
  await expect(modelSelect).toBeVisible({ timeout: 20_000 });
  await expect(depthSelect).toBeVisible({ timeout: 20_000 });

  await depthSelect.selectOption('off');
  await expect(depthSelect).toHaveValue('off');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('session-depth-select')).toHaveValue('off', { timeout: 20_000 });

  const hasFailureRecoveryProbe = await page.evaluate(() => {
    return typeof (window as unknown as { __ozwTestCloseWebSocket?: () => void }).__ozwTestCloseWebSocket === 'function';
  });

  let disconnectedObserved = false;
  let errorTextObserved = false;
  if (hasFailureRecoveryProbe) {
    await page.evaluate(() => {
      const fn = (window as unknown as { __ozwTestCloseWebSocket?: () => void }).__ozwTestCloseWebSocket;
      fn?.();
    });
    await page.waitForTimeout(500);
    disconnectedObserved = (await page.getByText('Disconnected').count()) > 0;

    await composerInput.fill('qa4 runtime audit disconnected test');
    await composerInput.press('Control+Enter');
    errorTextObserved = await page.getByText('当前与服务端的实时连接已断开，消息不会被发送。请等待重连后重试。').count() > 0;
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });

  const state = await page.evaluate(() => ({
    modelSelect: (document.querySelector<HTMLSelectElement>('[data-testid="session-model-select"]'))?.value || '',
    depthSelect: (document.querySelector<HTMLSelectElement>('[data-testid="session-depth-select"]'))?.value || '',
    piModel: window.localStorage.getItem('pi-model'),
    piThinkingLevel: window.localStorage.getItem('pi-thinking-level'),
  }));

  await fs.mkdir(BASE_EVIDENCE, { recursive: true });
  await fs.writeFile(
    evidenceFile,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        viewport,
        loadingStateObserved,
        loadingCleared,
        emptyStateText,
        hasFailureRecoveryProbe,
        disconnectedObserved,
        errorTextObserved,
        consoleMessages,
        consoleErrors,
        requestFailures,
        failedResponses,
        state,
      },
      null,
      2,
    ),
    'utf8',
  );

  expect(loadingCleared).toBeTruthy();
  await page.waitForTimeout(200);
}

test.describe('QA-4 runtime audit for Pi session controls', () => {
  test('desktop runtime audit', async ({ page }) => {
    await runRuntimeAudit(page, 'desktop');
  });

  test('mobile runtime audit', async ({ page }) => {
    await runRuntimeAudit(page, 'mobile');
  });
});
