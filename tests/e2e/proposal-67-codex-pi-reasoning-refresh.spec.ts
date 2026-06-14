// @ts-nocheck -- Acceptance regression is allowed to fail until proposal 67 is implemented.
/**
 * PURPOSE: Verify proposal 67 through real browser manual-session paths:
 * Codex reasoning-effort selection must survive catalog load, send, failure,
 * retry, and refresh; Pi thinking blocks must collapse long content while
 * keeping tool cards and DeepSeek refresh recovery intact.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from '../spec/helpers/spec-test-helpers.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/proposal-67');
const CODEX_PROMPT = 'Proposal 67 Codex reasoning low must reach turn start';
const CODEX_RETRY_PROMPT = 'Proposal 67 Codex retry still uses low reasoning';
const PI_SESSION_ID = 'c6702';
const DEEPSEEK_SESSION_ID = 'c6703';
const THINKING_LINES = [
  'proposal 67 hidden thinking line 1',
  'proposal 67 hidden thinking line 2',
  'proposal 67 hidden thinking line 3',
  'proposal 67 visible thinking line 4',
  'proposal 67 visible thinking line 5',
  'proposal 67 visible thinking line 6',
];
const STREAMED_THINKING_LINE = 'proposal 67 streamed thinking line 7 after expand';
const PI_TOOL_COMMAND = 'pnpm exec ozw-proposal-67 --separate-tool';
const DEEPSEEK_HISTORY_THINKING = 'proposal 67 DeepSeek reasoning_content persisted before refresh';
const DEEPSEEK_TOOL_COMMAND = 'pnpm exec ozw-proposal-67 --deepseek-tool';
const DEEPSEEK_LIVE_TEXT = 'proposal 67 live transcript snapshot after refresh';
const DEEPSEEK_DELTA_TEXT = 'proposal 67 post-refresh websocket delta';

test.describe('proposal 67 Codex reasoning and Pi thinking recovery', () => {
  test('Codex new-session reasoning effort survives catalog defaults, send failure, retry, and refresh', async ({ page }) => {
    /**
     * Drive the same project overview and manual Codex route that a user uses,
     * while a deterministic WebSocket records outbound command options.
     */
    const modelResponses = [];
    await installCodexModelCatalogMock(page, modelResponses);
    await installCodexSocketHarness(page);
    await openFixtureProject(page);
    await openNewManualSession(page, 'codex');

    const depthSelect = page.getByTestId('session-depth-select');
    await expect(depthSelect).toBeVisible({ timeout: 20_000 });
    await expect(depthSelect).toHaveValue('medium', { timeout: 20_000 });

    await depthSelect.selectOption('low');
    await expect(depthSelect).toHaveValue('low');
    await expect.poll(() => readLocalStorage(page, 'codex-reasoning-effort')).toBe('low');

    await submitPrompt(page, CODEX_PROMPT);
    await expect.poll(() => capturedCodexCommands(page)).toHaveLength(1);
    await expect(depthSelect).toHaveValue('low');

    await submitPrompt(page, CODEX_RETRY_PROMPT);
    await expect.poll(() => capturedCodexCommands(page)).toHaveLength(2);
    const commands = await capturedCodexCommands(page);
    expect(commands.map((message) => message.options?.reasoningEffort)).toEqual(['low', 'low']);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('session-depth-select')).toHaveValue('low', { timeout: 20_000 });

    await writeCodexEvidence(page, commands, modelResponses);
  });

  test('Pi long thinking collapses to latest lines, keeps expansion while streaming, and separates tool cards', async ({ page }) => {
    /**
     * Load persisted Pi history, expand the thinking block, stream one more
     * thinking delta, then reload to verify default collapsed recovery.
     */
    const messageResponses = [];
    await installRealtimeSocketHarness(page);
    await installPiThinkingMessagesMock(page, PI_SESSION_ID, messageResponses);
    await openFixtureProject(page);
    await openManualSessionRoute(page, PI_SESSION_ID, 'pi');

    const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
    // Multi-line thinking content is rendered as a single Markdown block;
    // use substring matching because exact text node boundaries differ from input lines.
    await expect(transcript.getByText(THINKING_LINES[3])).toBeVisible({ timeout: 20_000 });
    await expect(transcript.getByText(THINKING_LINES[4])).toBeVisible();
    await expect(transcript.getByText(THINKING_LINES[5])).toBeVisible();
    await expectVisibleText(page, THINKING_LINES[0], false);
    await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: PI_TOOL_COMMAND })).toBeVisible();

    await expandThinkingBlock(page, THINKING_LINES[5]);
    await expectVisibleText(page, THINKING_LINES[0], true);

    await emitLiveItem(page, 'pi', PI_SESSION_ID, {
      itemType: 'thinking',
      message: { role: 'assistant', content: `\n${STREAMED_THINKING_LINE}` },
    });
    await expect(transcript.getByText(STREAMED_THINKING_LINE)).toBeVisible({ timeout: 20_000 });
    await expectVisibleText(page, THINKING_LINES[0], true);
    await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: PI_TOOL_COMMAND })).toHaveCount(1);

    await page.reload({ waitUntil: 'networkidle' });
    const reloadedTranscript = page.locator('[data-testid="chat-scroll-container"]').last();
    await expect(reloadedTranscript.getByText(THINKING_LINES[5])).toBeVisible({ timeout: 20_000 });
    await expectVisibleText(page, THINKING_LINES[0], false);
    await expect(reloadedTranscript.getByTestId('codex-tool-card').filter({ hasText: PI_TOOL_COMMAND })).toHaveCount(1);

    await writePiThinkingEvidence(page, messageResponses);
  });

  test('Pi DeepSeek refresh recovery renders JSONL thinking, tool calls, live snapshot, and later deltas without duplicates', async ({ page }) => {
    /**
     * Exercise the browser refresh path with a merged DeepSeek-style read model
     * and then append a WebSocket delta after the page has rehydrated.
     */
    const messageResponses = [];
    const liveState = { includeLiveSnapshot: false };
    await installRealtimeSocketHarness(page);
    await installDeepSeekMessagesMock(page, DEEPSEEK_SESSION_ID, liveState, messageResponses);
    await openFixtureProject(page);
    await openManualSessionRoute(page, DEEPSEEK_SESSION_ID, 'pi');

    const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
    // Substring matching: Markdown rendering may concatenate text nodes.
    await expect(transcript.getByText(DEEPSEEK_HISTORY_THINKING)).toBeVisible({ timeout: 20_000 });
    await expect(transcript.getByTestId('codex-tool-card').filter({ hasText: DEEPSEEK_TOOL_COMMAND })).toBeVisible();

    liveState.includeLiveSnapshot = true;
    await page.reload({ waitUntil: 'networkidle' });
    const reloadedTranscript = page.locator('[data-testid="chat-scroll-container"]').last();
    await expect(reloadedTranscript.getByText(DEEPSEEK_HISTORY_THINKING)).toHaveCount(1, { timeout: 20_000 });
    await expect(reloadedTranscript.getByTestId('codex-tool-card').filter({ hasText: DEEPSEEK_TOOL_COMMAND })).toHaveCount(1);
    await expect(reloadedTranscript.getByText(DEEPSEEK_LIVE_TEXT)).toHaveCount(1);

    await emitLiveItem(page, 'pi', DEEPSEEK_SESSION_ID, {
      itemType: 'agent_message',
      message: { role: 'assistant', content: DEEPSEEK_DELTA_TEXT },
    });
    await expect(reloadedTranscript.getByText(DEEPSEEK_DELTA_TEXT)).toHaveCount(1, { timeout: 20_000 });
    await expectTranscriptOrder(reloadedTranscript, [DEEPSEEK_HISTORY_THINKING, DEEPSEEK_TOOL_COMMAND, DEEPSEEK_LIVE_TEXT, DEEPSEEK_DELTA_TEXT]);

    await writeDeepSeekEvidence(page, messageResponses);
  });
});

async function installCodexModelCatalogMock(page, modelResponses) {
  /**
   * Return a catalog whose default is high while medium/low remain valid, so
   * the test catches effects that overwrite an explicit user selection.
   */
  await page.route('**/api/codex/models**', async (route) => {
    const body = {
      defaultModel: 'gpt-5.5',
      models: [{
        value: 'gpt-5.5',
        label: 'gpt-5.5',
        defaultReasoningEffort: 'high',
        reasoningOptions: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
      }],
    };
    modelResponses.push({ url: route.request().url(), defaultReasoningEffort: 'high' });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function installCodexSocketHarness(page) {
  /**
   * Replace browser WebSocket with a local harness that captures commands,
   * returns a first failure, and leaves retry behavior fully observable.
   */
  await page.addInitScript(() => {
    const sentKey = '__proposal67CodexSent';
    if (!window.localStorage.getItem('codex-reasoning-effort')) {
      window.localStorage.setItem('codex-reasoning-effort', 'medium');
    }
    window.localStorage.setItem('selected-provider', 'codex');

    function readSent() {
      try {
        return JSON.parse(window.localStorage.getItem(sentKey) || '[]');
      } catch {
        return [];
      }
    }

    class FakeWebSocket extends EventTarget {
      constructor() {
        super();
        window.__proposal67CodexSocket = this;
        setTimeout(() => {
          this.readyState = WebSocket.OPEN;
          this.onopen?.();
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      send(payload) {
        const message = JSON.parse(payload);
        const sent = readSent();
        sent.push(message);
        window.localStorage.setItem(sentKey, JSON.stringify(sent));
        if (message.type !== 'codex-command') {
          return;
        }

        const codexCommands = sent.filter((entry) => entry.type === 'codex-command');
        setTimeout(() => {
          const eventPayload = codexCommands.length === 1
            ? {
                type: 'codex-error',
                sessionId: message.sessionId || message.ozwSessionId || 'c67',
                error: 'proposal 67 forced Codex failure after reasoning capture',
              }
            : {
                type: 'codex-response',
                sessionId: message.sessionId || message.ozwSessionId || 'c67',
                data: { type: 'turn_failed' },
              };
          const event = new MessageEvent('message', { data: JSON.stringify(eventPayload) });
          this.onmessage?.(event);
          this.dispatchEvent(event);
        }, 0);
      }

      close() {
        this.readyState = WebSocket.CLOSED;
        this.onclose?.();
        this.dispatchEvent(new Event('close'));
      }
    }

    FakeWebSocket.CONNECTING = 0;
    FakeWebSocket.OPEN = 1;
    FakeWebSocket.CLOSING = 2;
    FakeWebSocket.CLOSED = 3;
    window.WebSocket = FakeWebSocket;
    window.__proposal67CodexCommands = () => readSent().filter((message) => message.type === 'codex-command');
  });
}

async function installRealtimeSocketHarness(page) {
  /**
   * Capture the real app WebSocket so tests can inject provider runtime events
   * through the same browser listener used by live sessions.
   */
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    window.__ozwChatSockets = [];

    function PatchedWebSocket(...args) {
      const ws = new OriginalWebSocket(...args);
      window.__ozwChatSockets.push(ws);
      window.__ozwActiveChatSocket = ws;
      ws.addEventListener('open', () => {
        window.__ozwActiveChatSocket = ws;
      });
      return ws;
    }

    PatchedWebSocket.prototype = OriginalWebSocket.prototype;
    for (const key of ['OPEN', 'CONNECTING', 'CLOSING', 'CLOSED']) {
      PatchedWebSocket[key] = OriginalWebSocket[key];
    }
    window.WebSocket = PatchedWebSocket;
  });
}

async function openNewManualSession(page, provider) {
  /**
   * Create a manual session through project overview controls, matching a
   * normal user starting a new provider-specific conversation.
   */
  await page.getByTestId('project-overview-manual-sessions')
    .getByRole('button', { name: /新建会话|New Session/i })
    .click();
  await expect(page.getByTestId('project-new-session-provider-picker')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId(`project-new-session-provider-${provider}`).click({ noWaitAfter: true });
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 20_000 });
}

async function openManualSessionRoute(page, sessionId, provider) {
  /**
   * Open a provider-hinted manual session route using the fixture project path.
   */
  const query = new URLSearchParams({
    provider,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionSummary: `proposal 67 ${provider} acceptance`,
  });
  await page.goto(`/session/${sessionId}?${query.toString()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ozwActiveChatSocket?.readyState === window.WebSocket.OPEN, null, { timeout: 20_000 });
}

async function submitPrompt(page, text) {
  /**
   * Send one composer message via the visible textarea.
   */
  const input = page.locator('textarea').first();
  await expect(input).toBeEnabled({ timeout: 20_000 });
  await input.fill(text);
  await input.press('Control+Enter');
}

async function readLocalStorage(page, key) {
  /**
   * Read one browser localStorage value for state-persistence assertions.
   */
  return page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
}

async function capturedCodexCommands(page) {
  /**
   * Return captured Codex command frames from the browser socket harness.
   */
  return page.evaluate(() => window.__proposal67CodexCommands?.() || []);
}

async function installPiThinkingMessagesMock(page, sessionId, messageResponses) {
  /**
   * Serve a Pi transcript with a long thinking block and an independent tool
   * card so browser rendering must satisfy both contracts together.
   */
  const messages = [
    userMessage('proposal-67-pi-user', 'proposal 67 Pi long thinking fixture'),
    thinkingMessage('proposal-67-pi-thinking', THINKING_LINES.join('\n')),
    assistantToolUse('proposal-67-pi-tool', 'proposal-67-pi-tool-call', 'Bash', { command: PI_TOOL_COMMAND }),
    userToolResult('proposal-67-pi-tool-result', 'proposal-67-pi-tool-call', 'proposal 67 tool output stays outside thinking', false),
  ];
  await page.route(`**/api/projects/**/sessions/${sessionId}/messages**`, async (route) => {
    const body = {
      messages,
      total: messages.length,
      hasMore: false,
      source: 'proposal-67-pi-thinking-history',
    };
    messageResponses.push({ url: route.request().url(), total: body.total, source: body.source });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function installDeepSeekMessagesMock(page, sessionId, liveState, messageResponses) {
  /**
   * Serve DeepSeek-style persisted thinking and, after refresh, a merged live
   * snapshot response that must render without duplicate history rows.
   */
  await page.route(`**/api/projects/**/sessions/${sessionId}/messages**`, async (route) => {
    const messages = [
      userMessage('proposal-67-deepseek-user', 'proposal 67 DeepSeek refresh fixture'),
      thinkingMessage('proposal-67-deepseek-thinking', DEEPSEEK_HISTORY_THINKING),
      assistantToolUse('proposal-67-deepseek-tool', 'proposal-67-deepseek-tool-call', 'Bash', { command: DEEPSEEK_TOOL_COMMAND }),
      userToolResult('proposal-67-deepseek-tool-result', 'proposal-67-deepseek-tool-call', 'proposal 67 DeepSeek tool result', false),
      ...(liveState.includeLiveSnapshot
        ? [assistantMessage('proposal-67-deepseek-live', DEEPSEEK_LIVE_TEXT)]
        : []),
    ];
    const body = {
      messages,
      total: messages.length,
      hasMore: false,
      source: liveState.includeLiveSnapshot ? 'proposal-67-jsonl-live-merged' : 'proposal-67-jsonl-history',
    };
    messageResponses.push({ url: route.request().url(), total: body.total, source: body.source });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

function userMessage(messageKey, text) {
  /**
   * Build a persisted user message shaped like the session messages endpoint.
   */
  return {
    type: 'message',
    timestamp: '2026-06-03T13:00:00.000Z',
    provider: 'pi',
    messageKey,
    message: { role: 'user', content: [{ type: 'text', text }] },
  };
}

function assistantMessage(messageKey, text) {
  /**
   * Build a persisted assistant text message for merged live-snapshot fixtures.
   */
  return {
    type: 'message',
    timestamp: '2026-06-03T13:00:01.000Z',
    provider: 'pi',
    messageKey,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

function thinkingMessage(messageKey, text) {
  /**
   * Build a Pi thinking message that should render as an independent block.
   */
  return {
    type: 'thinking',
    timestamp: '2026-06-03T13:00:02.000Z',
    provider: 'pi',
    messageKey,
    message: { role: 'assistant', content: text },
  };
}

function assistantToolUse(messageKey, toolId, toolName, input) {
  /**
   * Build a persisted assistant tool-use content part for ToolRenderer.
   */
  return {
    type: 'message',
    timestamp: '2026-06-03T13:00:03.000Z',
    provider: 'pi',
    messageKey,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: toolName, input }] },
  };
}

function userToolResult(messageKey, toolUseId, content, isError) {
  /**
   * Build a persisted user tool-result content part paired with a tool use.
   */
  return {
    type: 'message',
    timestamp: '2026-06-03T13:00:04.000Z',
    provider: 'pi',
    messageKey,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] },
  };
}

async function emitLiveItem(page, provider, sessionId, item) {
  /**
   * Push one native runtime item into the active browser WebSocket.
   */
  await page.evaluate((payload) => {
    const socket = window.__ozwActiveChatSocket;
    if (!socket) {
      throw new Error('No active chat WebSocket captured');
    }
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }, {
    type: `${provider}-response`,
    sessionId,
    ozwSessionId: sessionId,
    data: { type: 'item', ...item },
  });
}

async function expandThinkingBlock(page, visibleLine) {
  /**
   * Click the expand control associated with a collapsed thinking block.
   */
  await page.evaluate((line) => {
    const transcript = [...document.querySelectorAll('[data-testid="chat-scroll-container"]')].pop();
    if (!transcript) {
      throw new Error('No chat transcript found');
    }

    const owners = [...transcript.querySelectorAll('details, button, summary, [role="button"]')];
    const control = owners.find((element) => {
      const text = element.textContent || '';
      return /展开|更多|show|more|\.\.\.|⋯/i.test(text);
    });
    if (control) {
      (control as HTMLElement).click();
      return;
    }

    const textOwner = [...transcript.querySelectorAll('*')].find((element) => (element.textContent || '').includes(line));
    const details = textOwner?.closest('details');
    if (details) {
      details.open = true;
      details.dispatchEvent(new Event('toggle', { bubbles: true }));
      return;
    }

    throw new Error('No expand control found for proposal 67 thinking block');
  }, visibleLine);
}

async function expectVisibleText(page, text, expectedVisible) {
  /**
   * Assert whether a body text node is actually visible after layout.
   */
  await expect.poll(async () => page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.includes(needle)) {
        continue;
      }
      const element = node.parentElement;
      if (!element) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
        return true;
      }
    }
    return false;
  }, text)).toBe(expectedVisible);
}

async function expectTranscriptOrder(transcript, expectedTexts) {
  /**
   * Verify visible transcript content appears in the order users read it.
   */
  const positions = await transcript.evaluate((node, texts) => {
    const fullText = node.textContent || '';
    return texts.map((text) => fullText.indexOf(text));
  }, expectedTexts);
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect([...positions].sort((left, right) => left - right)).toEqual(positions);
}

async function writeCodexEvidence(page, commands, modelResponses) {
  /**
   * Persist screenshot, network-like frames, and local state after Codex refresh.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'codex-reasoning-after-refresh.png'), fullPage: true });
  const state = await page.evaluate(() => ({
    reasoningEffort: window.localStorage.getItem('codex-reasoning-effort'),
    model: window.localStorage.getItem('codex-model'),
    bodyText: document.body.textContent || '',
  }));
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'codex-reasoning-state-after-refresh.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), state, modelResponses }, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'codex-command-frames.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), commands }, null, 2)}\n`,
    'utf8',
  );
}

async function writePiThinkingEvidence(page, messageResponses) {
  /**
   * Persist screenshot, mocked network records, and thinking visibility state.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'pi-thinking-after-refresh.png'), fullPage: true });
  const visibility = {};
  for (const line of THINKING_LINES) {
    visibility[line] = await page.evaluate((needle) => document.body.textContent?.includes(needle) || false, line);
  }
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'pi-thinking-state-after-refresh.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), visibility, messageResponses }, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'pi-thinking-network.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), messageResponses }, null, 2)}\n`,
    'utf8',
  );
}

async function writeDeepSeekEvidence(page, messageResponses) {
  /**
   * Persist screenshot, mocked network records, and transcript state after live
   * post-refresh deltas have been appended.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'pi-deepseek-after-live-delta.png'), fullPage: true });
  const state = await page.locator('[data-testid="chat-scroll-container"]').last().evaluate((node) => ({
    text: node.textContent || '',
  }));
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'pi-deepseek-refresh-state.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), state, messageResponses }, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'pi-deepseek-network.json'),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), messageResponses }, null, 2)}\n`,
    'utf8',
  );
}
