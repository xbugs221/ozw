// @ts-nocheck -- Proposal 92 acceptance: capture browser evidence for provider live rendering.
/**
 * PURPOSE: Generate browser screenshots for provider live streaming rendering.
 * Events are injected through the fake WebSocket so the production reducer
 * and visibleMessages filter are exercised end-to-end.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ensurePlaywrightFixture } from '../e2e/helpers/playwright-fixture.ts';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
} from './helpers/spec-test-helpers.ts';
import { openCodexFixtureRoute, waitForCodexFixtureSession } from './helpers/fixture-session-discovery.ts';
import { installProviderRuntimeHarness } from './helpers/provider-runtime-harness.ts';
import {
  appendCodexSessionEntries,
  codexAssistantMessageEntry,
  codexFunctionCallEntry,
  codexFunctionOutputEntry,
  codexUserMessageEntry,
  writeCodexSessionFixture,
} from './helpers/codex-jsonl-fixture.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/proposal-92-provider-non-streaming-render');

test.describe.configure({ mode: 'serial' });
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function installCodexSocketHarness(page) {
  await installProviderRuntimeHarness(page, {
    sentKey: '__p92SentMessages',
    eventsKey: '__p92RuntimeMessages',
    socketKey: '__p92Socket',
    emitKey: '__p92EmitSocketMessage',
  });
  await page.addInitScript(() => {
    window.__ozwActiveChatSocket = null;
    window.localStorage.setItem('selected-provider', 'codex');
    window.localStorage.setItem('userLanguage', 'zh-CN');
  });
}

async function emitCodexSocketMessage(page, routeSessionId, message) {
  await page.evaluate((payload) => {
    window.__p92EmitSocketMessage?.(payload);
  }, {
    provider: 'codex',
    sessionId: routeSessionId,
    ozwSessionId: routeSessionId,
    ozw_session_id: routeSessionId,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    ...message,
  });
}

async function openManualCodexRoute(page, request, sessionId) {
  const route = await waitForCodexFixtureSession(request, sessionId, { intervalMs: 500 });
  const routePrefix = String(route.project.routePath || `/projects/${encodeURIComponent(String(route.project.name))}`);
  await page.goto(`${routePrefix}/${route.routeSessionId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
  await expect(page.locator('textarea').first()).toBeVisible();
  return { routeSessionId: route.routeSessionId, providerSessionId: route.providerSessionId };
}

async function submitUserMessage(page, text) {
  const textarea = page.locator('textarea').first();
  await textarea.fill(text);
  await textarea.press('Control+Enter');
  if (await page.locator('.chat-message.user').filter({ hasText: text }).count() === 0) {
    await textarea.press('Meta+Enter');
  }
  await expect(page.locator('.chat-message.user').filter({ hasText: text })).toHaveCount(1);
}

async function saveScreenshot(page, name) {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: false });
}

async function saveConsoleLogs(page) {
  const logs = [];
  page.on('console', (msg) => {
    logs.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    logs.push({ type: 'pageerror', text: err.message });
  });
  // Return a flush function
  return async () => {
    await fs.mkdir(EVIDENCE_DIR, { recursive: true });
    await fs.writeFile(
      path.join(EVIDENCE_DIR, 'console.json'),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), logs }, null, 2)}\n`,
      'utf8',
    );
  };
}

test('Codex batched live render evidence', async ({ page, request }) => {
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
  await authenticatePage(page);
  await installCodexSocketHarness(page);

  const sessionId = 'proposal-92-codex-non-streaming';
  await writeCodexSessionFixture({
    sessionId,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionDay: ['2026', '06', '09'],
    homeDir: process.env.PLAYWRIGHT_FIXTURE_HOME || process.env.HOME || '/tmp',
    timestamp: '2026-06-09T01:00:00.000Z',
    entries: [
      codexUserMessageEntry('2026-06-09T01:00:00.100Z', 'proposal 92 persisted context prompt'),
      codexAssistantMessageEntry('2026-06-09T01:00:00.200Z', 'proposal 92 persisted context response'),
    ],
  });
  let { routeSessionId, providerSessionId } = await openManualCodexRoute(page, request, sessionId);

  const flushConsole = await saveConsoleLogs(page);
  const transcript = page.locator('[data-testid="chat-scroll-container"]').last();

  // 1. User bubble baseline
  const prompt = 'proposal 92 Codex non-streaming acceptance prompt';
  await submitUserMessage(page, prompt);
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'message-accepted',
    clientRequestId: 'p92-client-id',
  });
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'session-status',
    isProcessing: true,
    turnId: 'turn-p92',
    turn_id: 'turn-p92',
  });

  // Pending assistant delta → live text should be visible before completion
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'p92-assistant',
      status: 'in_progress',
      delta: { text: 'proposal 92 partial delta' },
      message: { role: 'assistant' },
    },
  });
  await page.waitForTimeout(300);
  await saveScreenshot(page, 'user-bubble-stable');
  await expect(transcript).toContainText(prompt);
  await expect(transcript).toContainText('proposal 92 partial delta');

  // Completed assistant text
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'p92-assistant',
      status: 'completed',
      message: { role: 'assistant', content: 'proposal 92 completed assistant text.' },
    },
  });
  await page.waitForTimeout(300);
  await expect(transcript).toContainText('proposal 92 completed assistant text.');
  await expect(transcript).not.toContainText('proposal 92 partial delta');

  const params = new URLSearchParams({
    provider: 'codex',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
  });
  await page.goto(`/session/${sessionId}?${params.toString()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
  routeSessionId = sessionId;
  providerSessionId = sessionId;

  // Tool card replay uses the same persisted provider session after JSONL catch-up.
  await appendCodexSessionEntries(sessionId, [
    codexFunctionCallEntry('2026-06-09T01:00:01.000Z', 'p92-tool-call', 'functions.exec_command', {
      cmd: 'printf proposal-92-tool-output',
      yield_time_ms: 5000,
    }),
  ], { sessionDay: ['2026', '06', '09'], homeDir: process.env.PLAYWRIGHT_FIXTURE_HOME || process.env.HOME || '/tmp' });

  // Tool output (completed) → one visible tool card
  await appendCodexSessionEntries(sessionId, [
    codexFunctionOutputEntry('2026-06-09T01:00:02.000Z', 'p92-tool-call', 'proposal-92-tool-output\n'),
  ], { sessionDay: ['2026', '06', '09'], homeDir: process.env.PLAYWRIGHT_FIXTURE_HOME || process.env.HOME || '/tmp' });
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'codex-complete',
    status: 'completed',
    actualSessionId: providerSessionId,
  });
  await page.reload({ waitUntil: 'networkidle' });
  await saveScreenshot(page, 'completed-tool-card');
  await expect(page.getByTestId('codex-tool-card').filter({ hasText: 'printf proposal-92-tool-output' })).toHaveCount(1);

  // Empty output tool call + output
  await appendCodexSessionEntries(sessionId, [
    codexFunctionCallEntry('2026-06-09T01:00:03.000Z', 'p92-empty-tool', 'functions.exec_command', { cmd: 'true' }),
    codexFunctionOutputEntry('2026-06-09T01:00:04.000Z', 'p92-empty-tool', ''),
  ], { sessionDay: ['2026', '06', '09'], homeDir: process.env.PLAYWRIGHT_FIXTURE_HOME || process.env.HOME || '/tmp' });
  await page.reload({ waitUntil: 'networkidle' });
  await saveScreenshot(page, 'empty-output-card');
  const emptyToolCard = page.getByTestId('codex-tool-card').filter({ hasText: 'true' }).first();
  await expect(emptyToolCard).toBeVisible();
  // Empty output should not render a summary/details block
  const outputSummary = emptyToolCard.locator('summary').filter({ hasText: /^Output$/i });
  await expect(outputSummary).toHaveCount(0);

  // Thinking delta (pending) → visible thinking block, not plain assistant text
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'reasoning',
      itemId: 'p92-reasoning',
      status: 'in_progress',
      delta: { text: 'proposal 92 partial reasoning' },
    },
  });
  await page.waitForTimeout(300);
  await expect(transcript).toContainText('proposal 92 partial reasoning');

  // Completed reasoning → visible thinking block
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'reasoning',
      itemId: 'p92-reasoning',
      status: 'completed',
      message: { role: 'assistant', content: 'proposal 92 completed reasoning block.' },
    },
  });
  await page.waitForTimeout(300);
  await saveScreenshot(page, 'thinking-block-stable');
  await expect(transcript).toContainText('proposal 92 completed reasoning block.');
  await expect(transcript).not.toContainText('proposal 92 partial reasoning');

  await flushConsole();
});
