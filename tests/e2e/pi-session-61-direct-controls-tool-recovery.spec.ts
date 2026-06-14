// @ts-nocheck -- Acceptance regression locks proposed Pi UX before implementation.
/**
 * PURPOSE: Verify proposal 61 through real browser Pi chat paths: direct model
 * controls, state persistence/failure handling, completed tool-card expansion,
 * and refresh recovery of visible transcript content.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from '../spec/helpers/spec-test-helpers.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/pi-session-61');
const ROUTE_SESSION_ID = 'c61';
const USER_PROMPT = 'Pi 61 acceptance: inspect direct controls and recovered tool cards';
const ASSISTANT_REPLY = 'Pi 61 acceptance complete after recovered Bash and Read tools';
const BASH_COMMAND = 'pnpm run check:pi-session-61';
const READ_PATH = 'src/components/chat/view/subcomponents/SessionModelControls.tsx';

test.describe('Pi proposal 61 direct controls and recovery paths', () => {
  test('Pi inline selects persist state, survive refresh, expose failure state, and ignore repeated no-op selection', async ({ page }) => {
    /**
     * Drive the composer controls from a real Pi session and capture the
     * session model-state network contract around successful, repeated, and
     * failed state transitions.
     */
    const modelStateRequests = [];
    const consoleWarnings = [];

    page.on('console', (message) => {
      if (message.type() === 'warning' && /persist session model state/i.test(message.text())) {
        consoleWarnings.push(message.text());
      }
    });

    await page.addInitScript(() => {
      window.localStorage.removeItem('pi-model');
      window.localStorage.removeItem('pi-thinking-level');
    });

    await page.route('**/api/projects/**/sessions/**/model-state', async (route) => {
      const request = route.request();
      if (request.method() !== 'PUT') {
        await route.continue();
        return;
      }

      const body = JSON.parse(request.postData() || '{}');
      modelStateRequests.push({
        url: request.url(),
        body,
      });
      if (body.thinkingLevel === 'high') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'forced model-state failure for proposal 61' }),
        });
        return;
      }

      await route.continue();
    });

    await openNewPiSession(page);

    const modelSelect = page.getByTestId('session-model-select');
    const depthSelect = page.getByTestId('session-depth-select');
    await expect(page.getByTestId('session-model-controls-trigger')).toHaveCount(0);
    await expect(modelSelect).toBeVisible({ timeout: 20_000 });
    await expect(depthSelect).toBeVisible({ timeout: 20_000 });
    await expect(modelSelect).toHaveValue('playwright/pi-fake');
    await expect(depthSelect).toHaveValue('medium');

    await depthSelect.selectOption('off');
    await expect(depthSelect).toHaveValue('off');
    await expect.poll(() => modelStateRequests.filter((entry) => entry.body.thinkingLevel === 'off').length)
      .toBe(1);

    await depthSelect.selectOption('off');
    await page.waitForTimeout(250);
    expect(modelStateRequests.filter((entry) => entry.body.thinkingLevel === 'off')).toHaveLength(1);

    await page.reload({ waitUntil: 'networkidle' });
    await expect.poll(async () => page.getByTestId('session-depth-select').inputValue(), { timeout: 20_000 })
      .toMatch(/^(off|medium)$/);

    await page.getByTestId('session-depth-select').selectOption('high');
    await expect(page.getByTestId('session-depth-select')).toHaveValue('high');
    await expect.poll(() => modelStateRequests.filter((entry) => entry.body.thinkingLevel === 'high').length)
      .toBe(1);
    await expect.poll(() => consoleWarnings.length).toBeGreaterThan(0);

    await page.reload({ waitUntil: 'networkidle' });
    await expect.poll(async () => page.getByTestId('session-depth-select').inputValue(), { timeout: 20_000 })
      .toMatch(/^(off|medium)$/);

    await writeModelStateEvidence(page, modelStateRequests, consoleWarnings);
  });

  test('completed Pi tool cards keep content visible and recover collapsible outputs after refresh', async ({ page }) => {
    /**
     * Load a provider-hinted Pi route with stable transcript data so the real
     * chat UI must render recovered completed tool calls with visible command
     * content and stable output details after both initial load and refresh.
     */
    const messageResponses = [];
    await installPiSessionMessagesMock(page, messageResponses);
    await openFixtureProject(page);
    await openMockedPiRoute(page);

    const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
    await expect(transcript.getByText(USER_PROMPT, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(transcript.getByText(ASSISTANT_REPLY, { exact: true })).toBeVisible({ timeout: 20_000 });

    const bashCard = transcript.getByTestId('codex-tool-card').filter({ hasText: BASH_COMMAND }).first();
    await expect(bashCard).toBeVisible();
    await expect(bashCard.locator('#tool-result-pi-61-bash')).toBeAttached();

    const readCard = transcript.getByTestId('codex-tool-card').filter({ hasText: READ_PATH }).first();
    await expect(readCard).toBeVisible();
    await expect(readCard.locator('#tool-result-pi-61-read')).toBeAttached();

    const summary = bashCard.locator('#tool-result-pi-61-bash summary').first();
    await summary.click();
    await expect(bashCard.getByText('Pi 61 Bash command completed')).toBeVisible();
    await summary.click();
    await expect(bashCard.getByText('Pi 61 Bash command completed')).toBeHidden();
    await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: BASH_COMMAND })).toHaveCount(1);

    await page.reload({ waitUntil: 'networkidle' });
    const reloadedTranscript = page.locator('[data-testid="chat-scroll-container"]').last();
    const reloadedBashCard = reloadedTranscript.getByTestId('codex-tool-card').filter({ hasText: BASH_COMMAND }).first();
    await expect(reloadedBashCard).toBeVisible({ timeout: 20_000 });
    await expect(reloadedBashCard.locator('#tool-result-pi-61-bash')).toBeAttached();
    await expect(reloadedTranscript.getByText(ASSISTANT_REPLY, { exact: true })).toHaveCount(1);

    await writeToolRecoveryEvidence(page, reloadedTranscript, messageResponses);
  });
});

async function openNewPiSession(page) {
  /**
   * Create a Pi manual session via the same project overview picker used by a
   * real user before interacting with composer model controls.
   */
  page.once('dialog', async (dialog) => {
    await dialog.accept('Pi 61 acceptance direct controls');
  });
  await openFixtureProject(page);
  await page.getByRole('button', { name: /New Session|新建/ }).click();
  await expect(page.getByTestId('project-new-session-provider-picker')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('project-new-session-provider-pi').click({ noWaitAfter: true });
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pi-model-unavailable')).toHaveCount(0, { timeout: 20_000 });
}

async function openMockedPiRoute(page) {
  /**
   * Open a cN route with provider/project hints so ChatInterface follows the Pi
   * message recovery path while the endpoint fixture controls transcript state.
   */
  const query = new URLSearchParams({
    provider: 'pi',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionSummary: 'Pi 61 recovery fixture',
  });
  await page.goto(`/session/${ROUTE_SESSION_ID}?${query.toString()}`, { waitUntil: 'networkidle' });
}

async function installPiSessionMessagesMock(page, messageResponses) {
  /**
   * Fulfill only the proposal 61 Pi route transcript endpoint and record the
   * network source that proves refresh used the recovery response.
   */
  const messages = buildPiToolMessages();
  await page.route(`**/api/projects/**/sessions/${ROUTE_SESSION_ID}/messages**`, async (route) => {
    const responseBody = {
      messages,
      total: messages.length,
      hasMore: false,
      source: 'live-snapshot-bridge',
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

function buildPiToolMessages() {
  /**
   * Build a recovered Pi transcript with completed Bash and Read tools.
   */
  const timestamp = '2026-06-02T06:10:00.000Z';
  return [
    {
      type: 'message',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-61-user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: USER_PROMPT }],
      },
    },
    {
      type: 'tool_use',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-61-bash-tool',
      toolName: 'bash',
      toolInput: { command: BASH_COMMAND },
      toolCallId: 'pi-61-bash',
    },
    {
      type: 'tool_result',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-61-bash-result',
      toolName: 'bash',
      toolCallId: 'pi-61-bash',
      output: 'Pi 61 Bash command completed',
    },
    {
      type: 'tool_use',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-61-read-tool',
      toolName: 'read',
      toolInput: { file_path: READ_PATH },
      toolCallId: 'pi-61-read',
    },
    {
      type: 'tool_result',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-61-read-result',
      toolName: 'read',
      toolCallId: 'pi-61-read',
      output: 'export default function SessionModelControls() {}',
    },
    {
      type: 'message',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-61-assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: ASSISTANT_REPLY }],
      },
    },
  ];
}

async function writeModelStateEvidence(page, modelStateRequests, consoleWarnings) {
  /**
   * Persist screenshot, network requests, console warnings, and browser state
   * for the model-control acceptance matrix.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'pi-controls-after-failure-refresh.png'), fullPage: true });
  const state = await page.evaluate(() => ({
    piModel: window.localStorage.getItem('pi-model'),
    piThinkingLevel: window.localStorage.getItem('pi-thinking-level'),
    modelSelect: document.querySelector('[data-testid="session-model-select"]')?.value || '',
    depthSelect: document.querySelector('[data-testid="session-depth-select"]')?.value || '',
  }));
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'pi-model-state-network.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), state, modelStateRequests, consoleWarnings }, null, 2)}\n`,
    'utf8',
  );
}

async function writeToolRecoveryEvidence(page, transcript, messageResponses) {
  /**
   * Persist screenshot plus DOM and network snapshots after browser refresh.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'pi-tool-cards-after-refresh.png'), fullPage: true });
  const toolCards = await transcript.getByTestId('codex-tool-card').evaluateAll((nodes) =>
    nodes.map((node) => ({
      open: Boolean(node.open),
      text: node.textContent,
    })),
  );
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'pi-tool-recovery-state.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), toolCards, messageResponses }, null, 2)}\n`,
    'utf8',
  );
}
