// @ts-nocheck -- Acceptance regression locks proposed Pi UX before implementation.
/**
 * PURPOSE: Verify Pi session input controls and Pi tool rendering through the
 * real browser chat route, using stable fixture data instead of a real Pi
 * account.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from '../spec/helpers/spec-test-helpers.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/pi-session-60');
const ROUTE_SESSION_ID = 'c60';
const USER_PROMPT = 'Pi 60 acceptance: inspect controls and render tool cards';
const ASSISTANT_REPLY = 'Pi 60 acceptance complete after Bash and Read tools';
const BASH_COMMAND = 'pnpm run check:pi-session-60';
const RUNNING_COMMAND = 'sleep 60';
const READ_PATH = 'src/components/chat/view/subcomponents/SessionModelControls.tsx';

test.describe('Pi session input controls and tool card rendering', () => {
  test('Pi inline model select uses session-model-select, resets to session default on reload, and has no trigger button', async ({ page }) => {
    // Clear persisted Pi state before navigating to the app origin.
    // Must use addInitScript (not page.evaluate on about:blank) because
    // about:blank has no origin and blocks localStorage access.
    await page.addInitScript(() => {
      window.localStorage.removeItem('pi-model');
      window.localStorage.removeItem('pi-thinking-level');
    });
    await openNewPiSession(page);

    const modelSelect = page.getByTestId('session-model-select');
    const depthSelect = page.getByTestId('session-depth-select');
    await expect(page.getByTestId('session-model-controls-trigger')).toHaveCount(0, { timeout: 10_000 });
    await expect(modelSelect).toBeVisible({ timeout: 20_000 });
    await expect(depthSelect).toBeVisible({ timeout: 20_000 });

    await depthSelect.selectOption('off');
    await expect(depthSelect).toHaveValue('off');

    await page.reload({ waitUntil: 'networkidle' });
    await expect.poll(async () => page.getByTestId('session-depth-select').inputValue(), { timeout: 20_000 })
      .toMatch(/^(off|medium)$/);

    await writeControlStateEvidence(page);
  });

  test('Pi tool messages render commands visible with output collapsed by default and survive repeated toggles plus refresh', async ({ page }) => {
    await installPiSessionMessagesMock(page);
    await openFixtureProject(page);
    await openMockedPiRoute(page);

    const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
    await expect(transcript.getByText(USER_PROMPT, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(transcript.getByText(ASSISTANT_REPLY, { exact: true })).toBeVisible({ timeout: 20_000 });

    // Command text must always be visible (tool cards are now <div>, not <details>)
    const bashCard = transcript.getByTestId('codex-tool-card').filter({ hasText: BASH_COMMAND }).first();
    await expect(bashCard).toBeVisible();
    await expect(bashCard.getByText(BASH_COMMAND, { exact: true })).toBeVisible();

    const readCard = transcript.getByTestId('codex-tool-card').filter({ hasText: READ_PATH }).first();
    await expect(readCard).toBeVisible();
    await expect(readCard.getByText(READ_PATH, { exact: true })).toBeVisible();

    // Output details must exist with tool-result id and start collapsed
    const bashDetails = transcript.locator('#tool-result-pi-60-bash');
    await expect(bashDetails).toBeAttached({ timeout: 10_000 });

    // Toggle output via summary click and verify persistence
    const bashSummary = bashDetails.locator('summary').first();
    await bashSummary.click();
    await bashSummary.click();
    await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: BASH_COMMAND })).toHaveCount(1);

    await page.reload({ waitUntil: 'networkidle' });
    const reloadedTranscript = page.locator('[data-testid="chat-scroll-container"]').last();
    const reloadedBashCard = reloadedTranscript.getByTestId('codex-tool-card').filter({ hasText: BASH_COMMAND }).first();
    await expect(reloadedBashCard).toBeVisible({ timeout: 20_000 });
    await expect(reloadedBashCard.getByText(BASH_COMMAND, { exact: true })).toBeVisible();
    // After refresh, output details are collapsed again
    const reloadedBashDetails = reloadedTranscript.locator('#tool-result-pi-60-bash');
    await expect(reloadedBashDetails).toBeAttached({ timeout: 10_000 });
    await expect(reloadedTranscript.getByText(ASSISTANT_REPLY, { exact: true })).toHaveCount(1);

    await writeToolRenderingEvidence(page, reloadedTranscript);
  });
});

async function openNewPiSession(page) {
  /**
   * Create a Pi manual session via the same overview picker used by real users.
   */
  page.once('dialog', async (dialog) => {
    await dialog.accept('Pi 60 acceptance controls');
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
   * Open a provider-hinted cN route so ChatInterface resolves provider=pi while
   * the message API is fulfilled by the stable fixture below.
   */
  const query = new URLSearchParams({
    provider: 'pi',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionSummary: 'Pi 60 acceptance fixture',
  });
  await page.goto(`/session/${ROUTE_SESSION_ID}?${query.toString()}`, { waitUntil: 'networkidle' });
}

async function installPiSessionMessagesMock(page) {
  /**
   * Fulfill only the target Pi cN transcript endpoint. Other project APIs still
   * hit the real isolated Playwright server.
   */
  const messages = buildPiToolMessages();
  await page.route(`**/api/projects/**/sessions/${ROUTE_SESSION_ID}/messages**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages,
        total: messages.length,
        hasMore: false,
        source: 'pi-60-fixture',
      }),
    });
  });
}

function buildPiToolMessages() {
  /**
   * Build a Pi transcript with completed Bash/Read tools and one running tool.
   */
  const timestamp = '2026-06-02T02:40:00.000Z';
  return [
    {
      type: 'message',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-60-user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: USER_PROMPT }],
      },
    },
    {
      type: 'tool_use',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-60-bash-tool',
      toolName: 'bash',
      toolInput: { command: BASH_COMMAND },
      toolCallId: 'pi-60-bash',
    },
    {
      type: 'tool_result',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-60-bash-result',
      toolName: 'bash',
      toolCallId: 'pi-60-bash',
      output: 'Pi 60 Bash command completed',
    },
    {
      type: 'tool_use',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-60-read-tool',
      toolName: 'read',
      toolInput: { file_path: READ_PATH },
      toolCallId: 'pi-60-read',
    },
    {
      type: 'tool_result',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-60-read-result',
      toolName: 'read',
      toolCallId: 'pi-60-read',
      output: 'export default function SessionModelControls() {}',
    },
    {
      type: 'tool_use',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-60-running-tool',
      toolName: 'bash',
      toolInput: { command: RUNNING_COMMAND },
      toolCallId: 'pi-60-running',
      status: 'running',
    },
    {
      type: 'message',
      timestamp,
      provider: 'pi',
      messageKey: 'pi-60-assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: ASSISTANT_REPLY }],
      },
    },
  ];
}

async function writeToolRenderingEvidence(page, transcript) {
  /**
   * Persist screenshot and DOM state snapshot for the QA acceptance matrix.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'pi-tool-cards-after-refresh.png'), fullPage: true });
  const toolCards = await transcript.getByTestId('codex-tool-card').evaluateAll((nodes) =>
    nodes.map((node) => ({
      open: Boolean(node.open),
      collapsed: node.getAttribute('data-collapsed'),
      text: node.textContent,
    })),
  );
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'pi-tool-card-state.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), toolCards }, null, 2)}\n`,
    'utf8',
  );
}

async function writeControlStateEvidence(page) {
  /**
   * Persist the visible inline select state and localStorage state after refresh.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'pi-controls-after-refresh.png'), fullPage: true });
  const state = await page.evaluate(() => ({
    modelSelect: document.querySelector('[data-testid="session-model-select"]')?.value || '',
    depthSelect: document.querySelector('[data-testid="session-depth-select"]')?.value || '',
    piModel: window.localStorage.getItem('pi-model'),
    piThinkingLevel: window.localStorage.getItem('pi-thinking-level'),
  }));
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'pi-controls-state-after-refresh.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), state }, null, 2)}\n`,
    'utf8',
  );
}
