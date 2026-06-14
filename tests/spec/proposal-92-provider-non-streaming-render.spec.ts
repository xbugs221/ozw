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
  getFixtureProject,
  openFixtureProject,
} from './helpers/spec-test-helpers.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/proposal-92-provider-non-streaming-render');

test.describe.configure({ mode: 'serial' });
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function installCodexSocketHarness(page) {
  await page.addInitScript(() => {
    window.__ozwActiveChatSocket = null;
    window.__p92SentMessages = [];
    window.__p92RuntimeMessages = [];
    window.localStorage.setItem('selected-provider', 'codex');
    window.localStorage.setItem('userLanguage', 'zh-CN');

    class FakeWebSocket extends EventTarget {
      constructor(url) {
        super();
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        window.__p92Socket = this;
        setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          const event = new Event('open');
          this.onopen?.(event);
          this.dispatchEvent(event);
          window.__ozwActiveChatSocket = this;
        }, 0);
      }
      send(payload) {
        window.__p92SentMessages.push(JSON.parse(payload));
      }
      close() {
        this.readyState = FakeWebSocket.CLOSED;
        const event = new Event('close');
        this.onclose?.(event);
        this.dispatchEvent(event);
      }
    }
    FakeWebSocket.CONNECTING = 0;
    FakeWebSocket.OPEN = 1;
    FakeWebSocket.CLOSING = 2;
    FakeWebSocket.CLOSED = 3;
    window.WebSocket = FakeWebSocket;
    window.__p92EmitSocketMessage = (message) => {
      window.__p92RuntimeMessages.push(message);
      const event = new MessageEvent('message', { data: JSON.stringify(message) });
      window.__p92Socket?.onmessage?.(event);
      window.__p92Socket?.dispatchEvent?.(event);
    };
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

async function getFixtureProjectWithCodexSession(request, sessionId) {
  let latestProject = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    latestProject = await getFixtureProject(request);
    const codexSessions = Array.isArray(latestProject.codexSessions) ? latestProject.codexSessions : [];
    const session = codexSessions.find((candidate) => candidate.id === sessionId);
    if (session) {
      return { project: latestProject, session };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Codex fixture session ${sessionId} not found`);
}

async function openManualCodexRoute(page, request, sessionId) {
  await openFixtureProject(page, { reset: false });
  const { project, session } = await getFixtureProjectWithCodexSession(request, sessionId);
  if (!Number.isInteger(Number(session.routeIndex))) {
    throw new Error(`Codex fixture session ${sessionId} has no routeIndex`);
  }
  const routeSessionId = `c${Number(session.routeIndex)}`;
  const projectRoutePrefix = project.routePath || `/projects/${encodeURIComponent(project.name)}`;
  await page.goto(`${projectRoutePrefix}/${routeSessionId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
  await expect(page.locator('textarea').first()).toBeVisible();
  return { routeSessionId };
}

async function submitUserMessage(page, text) {
  const textarea = page.locator('textarea').first();
  await textarea.fill(text);
  await textarea.press('Control+Enter');
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

function codexSessionPath(sessionId) {
  return path.join(
    process.env.PLAYWRIGHT_FIXTURE_HOME || process.env.HOME || '/tmp',
    '.codex', 'sessions', '2026', '06', '09',
    `${sessionId}.jsonl`,
  );
}

async function writeCodexSession(sessionId, entries) {
  const sessionPath = codexSessionPath(sessionId);
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.writeFile(sessionPath, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
}

function sessionMeta(sessionId) {
  return {
    type: 'session_meta',
    timestamp: '2026-06-09T01:00:00.000Z',
    payload: { id: sessionId, cwd: PRIMARY_FIXTURE_PROJECT_PATH, model: 'gpt-5-codex' },
  };
}

test('Codex batched live render evidence', async ({ page, request }) => {
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
  await authenticatePage(page);
  await installCodexSocketHarness(page);

  const sessionId = 'proposal-92-codex-non-streaming';
  await writeCodexSession(sessionId, [sessionMeta(sessionId)]);
  const { routeSessionId } = await openManualCodexRoute(page, request, sessionId);

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

  // Tool call (pending) → stable input card should be visible before output
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'function_call',
      itemId: 'p92-tool-call',
      status: 'in_progress',
      item: {
        type: 'function_call',
        call_id: 'p92-tool-call',
        name: 'functions.exec_command',
        arguments: JSON.stringify({ cmd: 'printf proposal-92-tool-output', yield_time_ms: 5000 }),
      },
    },
  });
  await page.waitForTimeout(300);
  await expect(page.getByTestId('codex-tool-card').filter({ hasText: 'printf proposal-92-tool-output' })).toHaveCount(1);

  // Tool output (completed) → one visible tool card
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'function_call_output',
      itemId: 'p92-tool-call',
      status: 'completed',
      item: {
        type: 'function_call_output',
        call_id: 'p92-tool-call',
        output: 'proposal-92-tool-output\n',
      },
    },
  });
  await page.waitForTimeout(300);
  await saveScreenshot(page, 'completed-tool-card');
  await expect(page.getByTestId('codex-tool-card').filter({ hasText: 'printf proposal-92-tool-output' })).toHaveCount(1);

  // Empty output tool call + output
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'function_call',
      itemId: 'p92-empty-tool',
      status: 'in_progress',
      item: {
        type: 'function_call',
        call_id: 'p92-empty-tool',
        name: 'functions.exec_command',
        arguments: JSON.stringify({ cmd: 'true' }),
      },
    },
  });
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'function_call_output',
      itemId: 'p92-empty-tool',
      status: 'completed',
      item: {
        type: 'function_call_output',
        call_id: 'p92-empty-tool',
        output: '',
      },
    },
  });
  await page.waitForTimeout(300);
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
