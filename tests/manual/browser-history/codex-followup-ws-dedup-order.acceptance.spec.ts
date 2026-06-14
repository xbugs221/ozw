// @ts-nocheck -- Acceptance regression is allowed to fail until proposal 70 is implemented.
/**
 * PURPOSE: Verify Codex follow-up chat rendering through the real browser path
 * when duplicate WebSocket events and lagged read-model refreshes arrive while
 * the user sends additional prompts.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.ts';

const SESSION_ID = 'proposal-70-codex-ws-dedup-order';
const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/codex-session-70-ws-dedup-order');
const TURN_1_USER = 'proposal 70 第一轮已持久化需求';
const TURN_1_ASSISTANT = 'proposal 70 第一轮 Codex 已落盘回复';
const TURN_2_USER = 'proposal 70 第二轮追加请求';
const TURN_2_LIVE_SEGMENTS = [
  'proposal 70 第二轮 Codex live 响应第一句：我先确认当前续发请求的目标和上下文。',
  '第二句：我会把前端 WS accepted、live item、读模型刷新和完成事件拆开看。',
  '第三句：现在先保留本地 optimistic 用户气泡，不让它被滞后的持久化列表挤到尾部。',
  '第四句：随后到达的 assistant item 应该和这次用户请求保持相邻关系。',
  '第五句：即使同一个 item 重复推送，也只能更新同一条助手气泡。',
  '第六句：最终 JSONL 追上以后再用 persisted 内容收敛运行态展示。',
];
const TURN_2_LIVE = TURN_2_LIVE_SEGMENTS.join('');
const TURN_2_THINKING_1 = 'proposal 70 第二轮 thinking：先确认用户 JSONL 是否已经落盘。';
const TURN_2_TOOL_COMMAND = 'printf proposal-70-turn-2-jsonl-check';
const TURN_2_TOOL_OUTPUT = 'proposal 70 第二轮工具输出：JSONL 用户行已出现一次。';
const TURN_2_THINKING_2 = 'proposal 70 第二轮 thinking：工具结果回来后继续输出助手结论。';
const TURN_2_PERSISTED = [
  'proposal 70 第二轮 Codex 最终响应第一句：第二轮请求已经从 JSONL 读模型恢复。',
  '第二句：persisted 用户气泡和助手气泡会替换运行态副本。',
  '第三句：此前重复 accepted 和重复 live item 不应留下多余气泡。',
  '第四句：第三轮仍然处在第二轮之后，继续等待自己的持久化结果。',
  '第五句：这证明部分追上不会破坏未完成轮次的相对顺序。',
].join(' ');
const TURN_3_USER = 'proposal 70 第三轮追加请求';
const TURN_3_LIVE_SEGMENTS = [
  'proposal 70 第三轮 Codex live 响应第一句：我收到第三轮追加请求后继续沿用同一个会话上下文。',
  '第二句：此时第二轮可能已经持久化，也可能仍停留在 live transcript 中。',
  '第三句：第三轮用户气泡必须保持在第三轮助手响应之前。',
  '第四句：重复的 WS assistant item 不能制造第二条相同回复。',
  '第五句：滞后的 projects_updated 不能把第三轮用户气泡移动到错误位置。',
  '第六句：完成事件到达后才允许 persisted transcript 替换 live 副本。',
];
const TURN_3_LIVE = TURN_3_LIVE_SEGMENTS.join('');
const TURN_3_THINKING_1 = 'proposal 70 第三轮 thinking：先确认 stale history 没有重复叠到新消息上方。';
const TURN_3_TOOL_COMMAND = 'printf proposal-70-turn-3-history-dedupe';
const TURN_3_TOOL_OUTPUT = 'proposal 70 第三轮工具输出：旧历史仍然只显示一次。';
const TURN_3_THINKING_2 = 'proposal 70 第三轮 thinking：工具完成后再继续第三轮回复。';
const TURN_3_PERSISTED = [
  'proposal 70 第三轮 Codex 最终响应第一句：第三轮请求已经完整落盘。',
  '第二句：最终 transcript 应该只剩 persisted 版本。',
  '第三句：旧的 live 第三轮助手响应必须被移除。',
  '第四句：第二轮和第三轮都保持用户请求后紧跟对应助手响应。',
  '第五句：刷新浏览器以后仍然不能出现重复气泡。',
].join(' ');

test('Codex follow-up transcript ignores duplicate WS pushes and preserves turn order during lagged refreshes', async ({ page }) => {
  /**
   * Drive the real Codex manual-session UI through two follow-up sends, then
   * interleave duplicate WS frames and stale read-model reloads to prove visible
   * chat order and bubble counts stay stable.
   */
  test.setTimeout(90_000);
  const readModel = { stage: 'turn1-only' };
  const messageResponses = [];
  const wsEvents = [];

  await installCodexSocketHarness(page, wsEvents);
  await installMessagesMock(page, readModel, messageResponses);
  await openFixtureProject(page);
  await openCodexSessionRoute(page);

  const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(transcript.getByText(TURN_1_USER, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(transcript.getByText(TURN_1_ASSISTANT, { exact: true })).toBeVisible();

  await submitPrompt(page, TURN_2_USER);
  await expectTranscriptOrder(transcript, [TURN_1_USER, TURN_1_ASSISTANT, TURN_2_USER]);
  await expectVisibleCount(transcript, TURN_2_USER, 1);
  await expectUserDeliveryStatus(transcript, TURN_2_USER, 'pending');
  await emitDuplicateAcceptedForLastCommand(page);
  await expectUserDeliveryStatus(transcript, TURN_2_USER, 'sent');
  await expectVisibleCount(transcript, TURN_2_LIVE_SEGMENTS[0], 0);
  readModel.stage = 'turn2-user-only';
  await emitProjectsUpdated(page);
  await expectUserDeliveryStatus(transcript, TURN_2_USER, 'persisted');
  await expectVisibleCount(transcript, TURN_1_USER, 1);
  await expectVisibleCount(transcript, TURN_1_ASSISTANT, 1);
  await emitInterleavedAssistantRuntime(page, {
    segments: TURN_2_LIVE_SEGMENTS,
    turnId: 'proposal-70-live-turn-2',
    thinkingBeforeTool: TURN_2_THINKING_1,
    toolCommand: TURN_2_TOOL_COMMAND,
    toolOutput: TURN_2_TOOL_OUTPUT,
    thinkingAfterTool: TURN_2_THINKING_2,
  });
  await expectTranscriptOrder(transcript, [
    TURN_1_USER,
    TURN_1_ASSISTANT,
    TURN_2_USER,
    TURN_2_LIVE_SEGMENTS[0],
    TURN_2_THINKING_1,
    TURN_2_LIVE_SEGMENTS[1],
    TURN_2_TOOL_COMMAND,
    TURN_2_TOOL_OUTPUT,
    TURN_2_LIVE_SEGMENTS[2],
    TURN_2_THINKING_2,
    TURN_2_LIVE_SEGMENTS[3],
    TURN_2_LIVE_SEGMENTS[4],
    TURN_2_LIVE_SEGMENTS[5],
  ]);
  await expectVisibleCount(transcript, TURN_2_USER, 1);
  await expectVisibleCount(transcript, TURN_2_TOOL_COMMAND, 1);
  await expectVisibleCount(transcript, TURN_2_TOOL_OUTPUT, 1);

  readModel.stage = 'turn2-caught-up';
  await emitProjectsUpdated(page);
  await expectTranscriptOrder(transcript, [
    TURN_1_USER,
    TURN_1_ASSISTANT,
    TURN_2_USER,
    TURN_2_THINKING_1,
    TURN_2_TOOL_COMMAND,
    TURN_2_TOOL_OUTPUT,
    TURN_2_THINKING_2,
    TURN_2_PERSISTED,
  ]);
  await expectVisibleCount(transcript, TURN_2_USER, 1);
  await expectVisibleCount(transcript, TURN_2_PERSISTED, 1);
  await expectTurn2PersistedRuntimeVisible(transcript);

  await waitForSubmitCooldown(page);
  await submitPrompt(page, TURN_3_USER);
  await expectTranscriptOrder(transcript, [
    TURN_1_USER,
    TURN_1_ASSISTANT,
    TURN_2_USER,
    TURN_2_THINKING_1,
    TURN_2_TOOL_COMMAND,
    TURN_2_TOOL_OUTPUT,
    TURN_2_THINKING_2,
    TURN_2_PERSISTED,
    TURN_3_USER,
  ]);
  await expectVisibleCount(transcript, TURN_3_USER, 1);
  await expectUserDeliveryStatus(transcript, TURN_3_USER, 'pending');
  await emitDuplicateAcceptedForLastCommand(page);
  await expectUserDeliveryStatus(transcript, TURN_3_USER, 'sent');
  await expectVisibleCount(transcript, TURN_3_LIVE_SEGMENTS[0], 0);
  await emitProjectsUpdated(page);
  await emitProjectsUpdated(page);
  await expectVisibleCount(transcript, TURN_1_USER, 1);
  await expectVisibleCount(transcript, TURN_1_ASSISTANT, 1);
  await expectUserDeliveryStatus(transcript, TURN_3_USER, 'sent');
  readModel.stage = 'turn3-user-only';
  await emitProjectsUpdated(page);
  await expectUserDeliveryStatus(transcript, TURN_3_USER, 'persisted');
  await emitInterleavedAssistantRuntime(page, {
    segments: TURN_3_LIVE_SEGMENTS,
    turnId: 'proposal-70-live-turn-3',
    thinkingBeforeTool: TURN_3_THINKING_1,
    toolCommand: TURN_3_TOOL_COMMAND,
    toolOutput: TURN_3_TOOL_OUTPUT,
    thinkingAfterTool: TURN_3_THINKING_2,
  });
  await expectTranscriptOrder(transcript, [
    TURN_1_USER,
    TURN_1_ASSISTANT,
    TURN_2_USER,
    TURN_2_THINKING_1,
    TURN_2_TOOL_COMMAND,
    TURN_2_TOOL_OUTPUT,
    TURN_2_THINKING_2,
    TURN_2_PERSISTED,
    TURN_3_USER,
    TURN_3_LIVE_SEGMENTS[0],
    TURN_3_THINKING_1,
    TURN_3_LIVE_SEGMENTS[1],
    TURN_3_TOOL_COMMAND,
    TURN_3_TOOL_OUTPUT,
    TURN_3_LIVE_SEGMENTS[2],
    TURN_3_THINKING_2,
    TURN_3_LIVE_SEGMENTS[3],
    TURN_3_LIVE_SEGMENTS[4],
    TURN_3_LIVE_SEGMENTS[5],
  ]);
  await expectVisibleCount(transcript, TURN_2_USER, 1);
  await expectVisibleCount(transcript, TURN_2_PERSISTED, 1);
  await expectTurn2PersistedRuntimeVisible(transcript);
  await expectVisibleCount(transcript, TURN_3_USER, 1);
  await expectVisibleCount(transcript, TURN_3_TOOL_COMMAND, 1);
  await expectVisibleCount(transcript, TURN_3_TOOL_OUTPUT, 1);

  await emitDuplicateLiveAssistant(page, TURN_2_LIVE, 'proposal-70-live-turn-2');
  await emitProjectsUpdated(page);
  await expectTranscriptOrder(transcript, [
    TURN_1_USER,
    TURN_1_ASSISTANT,
    TURN_2_USER,
    TURN_2_PERSISTED,
    TURN_3_USER,
    TURN_3_LIVE_SEGMENTS[0],
    TURN_3_THINKING_1,
    TURN_3_LIVE_SEGMENTS[1],
    TURN_3_TOOL_COMMAND,
    TURN_3_TOOL_OUTPUT,
    TURN_3_LIVE_SEGMENTS[2],
    TURN_3_THINKING_2,
    TURN_3_LIVE_SEGMENTS[3],
    TURN_3_LIVE_SEGMENTS[4],
    TURN_3_LIVE_SEGMENTS[5],
  ]);
  await expectVisibleCount(transcript, TURN_2_USER, 1);
  await expectVisibleCount(transcript, TURN_2_PERSISTED, 1);
  await expectTurn2PersistedRuntimeVisible(transcript);
  await expectVisibleCount(transcript, TURN_3_USER, 1);
  await expectVisibleCount(transcript, TURN_3_TOOL_COMMAND, 1);
  await expectVisibleCount(transcript, TURN_3_TOOL_OUTPUT, 1);

  readModel.stage = 'all-caught-up';
  await emitCodexComplete(page);
  await emitCodexComplete(page);
  await page.reload({ waitUntil: 'networkidle' });
  const reloadedTranscript = page.locator('[data-testid="chat-scroll-container"]').last();
  await expectTranscriptOrder(reloadedTranscript, [
    TURN_1_USER,
    TURN_1_ASSISTANT,
    TURN_2_USER,
    TURN_2_THINKING_1,
    TURN_2_TOOL_COMMAND,
    TURN_2_TOOL_OUTPUT,
    TURN_2_THINKING_2,
    TURN_2_PERSISTED,
    TURN_3_USER,
    TURN_3_THINKING_1,
    TURN_3_TOOL_COMMAND,
    TURN_3_TOOL_OUTPUT,
    TURN_3_THINKING_2,
    TURN_3_PERSISTED,
  ]);
  await expectVisibleCount(reloadedTranscript, TURN_2_USER, 1);
  await expectVisibleCount(reloadedTranscript, TURN_2_PERSISTED, 1);
  await expectVisibleCount(reloadedTranscript, TURN_3_USER, 1);
  await expectVisibleCount(reloadedTranscript, TURN_3_PERSISTED, 1);
  await expectTurn2PersistedRuntimeVisible(reloadedTranscript);
  await expectTurn3PersistedRuntimeVisible(reloadedTranscript);

  await writeEvidence(page, messageResponses, wsEvents);
});

async function installCodexSocketHarness(page, wsEvents) {
  /**
   * Replace WebSocket with a deterministic browser-side harness that captures
   * real app sends and exposes duplicate-event helpers to the test.
   */
  await page.addInitScript(() => {
    const sentKey = '__proposal70CodexSent';
    const eventKey = '__proposal70CodexEvents';

    function readJson(key) {
      try {
        return JSON.parse(window.localStorage.getItem(key) || '[]');
      } catch {
        return [];
      }
    }

    function appendJson(key, value) {
      const values = readJson(key);
      values.push(value);
      window.localStorage.setItem(key, JSON.stringify(values));
    }

    function dispatch(socket, payload) {
      appendJson(eventKey, payload);
      const event = new MessageEvent('message', { data: JSON.stringify(payload) });
      socket?.onmessage?.(event);
      socket?.dispatchEvent?.(event);
    }

    class FakeWebSocket extends EventTarget {
      constructor() {
        super();
        window.__proposal70Socket = this;
        setTimeout(() => {
          this.readyState = WebSocket.OPEN;
          this.onopen?.();
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      send(payload) {
        const message = JSON.parse(payload);
        appendJson(sentKey, message);
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
    window.__proposal70Emit = (payload) => dispatch(window.__proposal70Socket, payload);
    window.__proposal70SentMessages = () => readJson(sentKey);
    window.__proposal70WsEvents = () => readJson(eventKey);
    window.localStorage.setItem('selected-provider', 'codex');
  });

  page.on('console', (message) => {
    wsEvents.push({ type: 'console', text: message.text() });
  });
}

async function installMessagesMock(page, readModel, messageResponses) {
  /**
   * Serve progressively caught-up Codex read models so the test controls exactly
   * when persisted echoes replace live transcript rows.
   */
  const handleMessagesRoute = async (route) => {
    const messages = buildPersistedMessages(readModel.stage);
    messageResponses.push({ stage: readModel.stage, status: 200, total: messages.length });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages,
        total: messages.length,
        hasMore: false,
        source: `proposal-70-${readModel.stage}`,
      }),
    });
  };

  await page.route(`**/api/codex/sessions/${SESSION_ID}/messages**`, handleMessagesRoute);
  await page.route(`**/api/projects/**/sessions/${SESSION_ID}/messages**`, handleMessagesRoute);
}

async function openCodexSessionRoute(page) {
  /**
   * Open the restored Codex manual-session route with the shared e2e fixture project.
   */
  const query = new URLSearchParams({
    provider: 'codex',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionSummary: 'proposal 70 Codex WS dedupe ordering',
  });
  await page.goto(`/session/${SESSION_ID}?${query.toString()}`, { waitUntil: 'networkidle' });
}

async function submitPrompt(page, text) {
  /**
   * Submit through the real composer so optimistic user state is created by app code.
   */
  const input = page.locator('textarea').first();
  await expect(input).toBeEnabled({ timeout: 20_000 });
  await input.fill(text);
  await input.press('Enter');
  await expect.poll(() => capturedCodexCommands(page).then((messages) => (
    messages.filter((message) => message.command === text).length
  ))).toBe(1);
}

async function emitDuplicateAcceptedForLastCommand(page) {
  /**
   * Re-send the accepted frame for the latest Codex command to prove accepted is idempotent.
   */
  const command = await capturedCodexCommands(page).then((messages) => messages[messages.length - 1]);
  await page.evaluate((message) => {
    const payload = {
      type: 'message-accepted',
      provider: 'codex',
      sessionId: message.sessionId || message.ozwSessionId || 'proposal-70',
      ozwSessionId: message.ozwSessionId || null,
      clientRequestId: message.clientRequestId,
    };
    window.__proposal70Emit?.(payload);
    window.__proposal70Emit?.(payload);
  }, command);
}

async function emitDelayedDuplicateLiveAssistant(page, text, itemId, delayMs) {
  /**
   * Wait before pushing the same native Codex assistant item twice so the test
   * covers the real gap where the user bubble is visible before the agent replies.
   */
  await page.waitForTimeout(delayMs);
  await emitDuplicateLiveAssistant(page, text, itemId);
}

async function emitDuplicateLiveAssistant(page, text, itemId) {
  /**
   * Push the same multi-sentence native Codex assistant item twice to prove live rendering is idempotent.
   */
  await page.evaluate(({ content, id, sessionId }) => {
    const payload = {
      type: 'codex-response',
      provider: 'codex',
      sessionId,
      data: {
        type: 'item',
        itemType: 'agent_message',
        itemId: id,
        message: { role: 'assistant', content },
      },
    };
    window.__proposal70Emit?.(payload);
    window.__proposal70Emit?.(payload);
  }, { content: text, id: itemId, sessionId: SESSION_ID });
}

async function emitLiveItem(page, item) {
  /**
   * Push one native Codex runtime item through the real WebSocket handler.
   */
  await page.evaluate(({ sessionId, itemPayload }) => {
    window.__proposal70Emit?.({
      type: 'codex-response',
      provider: 'codex',
      sessionId,
      data: {
        type: 'item',
        ...itemPayload,
      },
    });
  }, { sessionId: SESSION_ID, itemPayload: item });
}

async function emitDuplicateLiveItem(page, item) {
  /**
   * Push the same native runtime item twice to verify item-level idempotency.
   */
  await emitLiveItem(page, item);
  await emitLiveItem(page, item);
}

async function emitInterleavedAssistantRuntime(page, scenario) {
  /**
   * Stream assistant text, thinking, and a Bash tool card in one assistant
   * response area, preserving the actual provider event order.
   */
  const [
    first,
    second,
    third,
    fourth,
    fifth,
    sixth,
  ] = scenario.segments;

  await emitDuplicateLiveAssistant(page, first, `${scenario.turnId}-assistant-1`);
  await expectVisibleCount(page.locator('[data-testid="chat-scroll-container"]').last(), first, 1);
  await page.waitForTimeout(1000);

  await emitDuplicateLiveItem(page, {
    itemType: 'reasoning',
    itemId: `${scenario.turnId}-thinking-1`,
    message: { role: 'assistant', content: scenario.thinkingBeforeTool },
  });
  await expectVisibleCount(page.locator('[data-testid="chat-scroll-container"]').last(), scenario.thinkingBeforeTool, 1);
  await page.waitForTimeout(1000);

  await emitDuplicateLiveAssistant(page, second, `${scenario.turnId}-assistant-2`);
  await expectVisibleCount(page.locator('[data-testid="chat-scroll-container"]').last(), second, 1);
  await page.waitForTimeout(1000);

  await emitDuplicateLiveItem(page, {
    itemType: 'command_execution',
    itemId: `${scenario.turnId}-tool`,
    command: scenario.toolCommand,
    output: '',
    status: 'running',
  });
  await expectVisibleCount(page.locator('[data-testid="chat-scroll-container"]').last(), scenario.toolCommand, 1);
  await page.waitForTimeout(1000);

  await emitDuplicateLiveItem(page, {
    itemType: 'command_execution',
    itemId: `${scenario.turnId}-tool`,
    command: scenario.toolCommand,
    output: scenario.toolOutput,
    status: 'completed',
    exitCode: 0,
  });
  await expect(page.locator('[data-testid="chat-scroll-container"]').last().getByTestId('codex-tool-card').filter({ hasText: scenario.toolCommand })).toHaveCount(1);
  await page.waitForTimeout(1000);

  await emitDuplicateLiveAssistant(page, third, `${scenario.turnId}-assistant-3`);
  await expectVisibleCount(page.locator('[data-testid="chat-scroll-container"]').last(), third, 1);
  await page.waitForTimeout(1000);

  await emitDuplicateLiveItem(page, {
    itemType: 'reasoning',
    itemId: `${scenario.turnId}-thinking-2`,
    message: { role: 'assistant', content: scenario.thinkingAfterTool },
  });
  await expectVisibleCount(page.locator('[data-testid="chat-scroll-container"]').last(), scenario.thinkingAfterTool, 1);
  await page.waitForTimeout(1000);

  for (const [index, segment] of [fourth, fifth, sixth].entries()) {
    await emitDuplicateLiveAssistant(page, segment, `${scenario.turnId}-assistant-${index + 4}`);
    await expectVisibleCount(page.locator('[data-testid="chat-scroll-container"]').last(), segment, 1);
    if (index < 2) {
      await page.waitForTimeout(1000);
    }
  }
}

async function emitStreamingAssistantSegments(page, segments, itemId) {
  /**
   * Emit one assistant item as incremental fragments, with human-scale gaps,
   * so the browser proves it renders Codex as a stream instead of one paste.
   */
  let accumulated = '';
  for (const segment of segments) {
    accumulated += segment;
    await emitDuplicateLiveAssistant(page, accumulated, itemId);
    await expect(page.locator('[data-testid="chat-scroll-container"]').last().getByText(accumulated, { exact: true })).toHaveCount(1);
    if (accumulated !== segments.join('')) {
      await page.waitForTimeout(1000);
    }
  }
}

async function emitProjectsUpdated(page) {
  /**
   * Trigger the read-model reload path used by provider filesystem updates.
   */
  await page.evaluate(({ sessionId, projectPath }) => {
    window.__proposal70Emit?.({
      type: 'projects_updated',
      provider: 'codex',
      watchProvider: 'codex',
      sessionId,
      projectPath,
    });
  }, { sessionId: SESSION_ID, projectPath: PRIMARY_FIXTURE_PROJECT_PATH });
  await page.waitForTimeout(250);
}

async function emitCodexComplete(page) {
  /**
   * Trigger the complete-state reload that should converge live rows to persisted rows.
   */
  await page.evaluate((sessionId) => {
    window.__proposal70Emit?.({
      type: 'codex-complete',
      provider: 'codex',
      sessionId,
      actualSessionId: sessionId,
      exitCode: 0,
    });
  }, SESSION_ID);
  await page.waitForTimeout(700);
}

async function waitForSubmitCooldown(page) {
  /**
   * Wait for the app's duplicate-submit guard before sending another follow-up.
   */
  await page.waitForTimeout(1600);
}

async function capturedCodexCommands(page) {
  /**
   * Return outbound Codex command frames captured by the fake socket.
   */
  return page.evaluate(() => window.__proposal70SentMessages?.().filter((message) => message.type === 'codex-command') || []);
}

async function expectTranscriptOrder(transcript, expectedTexts) {
  /**
   * Assert the user-visible DOM text order rather than component existence.
   */
  await expect.poll(async () => transcript.evaluate((node, texts) => {
    const fullText = node.textContent || '';
    const positions = texts.map((text) => fullText.indexOf(text));
    return {
      positions,
      allPresent: positions.every((position) => position >= 0),
      inOrder: positions.every((position, index) => index === 0 || position >= positions[index - 1]),
    };
  }, expectedTexts)).toMatchObject({ allPresent: true, inOrder: true });
}

async function expectVisibleCount(transcript, text, count) {
  /**
   * Assert exact visible bubble count for one business message text.
   */
  await expect(transcript.getByText(text, { exact: true })).toHaveCount(count);
}

async function expectUserDeliveryStatus(transcript, text, status) {
  /**
   * Assert the business delivery state that maps to transparent, blue, green,
   * and red user bubbles.
   */
  await expect.poll(async () => transcript.evaluate((node, expectedText) => {
    const rows = Array.from(node.querySelectorAll('.chat-message.user'));
    const row = rows.find((element) => (element.textContent || '').includes(expectedText));
    return row?.getAttribute('data-delivery-status') || '';
  }, text)).toBe(status);
}

async function expectTurn2PersistedRuntimeVisible(transcript) {
  /**
   * Assert second-turn thinking and tool rows remain visible after persisted
   * history replaces transient live rows.
   */
  for (const text of [
    TURN_2_THINKING_1,
    TURN_2_TOOL_COMMAND,
    TURN_2_TOOL_OUTPUT,
    TURN_2_THINKING_2,
  ]) {
    await expectVisibleCount(transcript, text, 1);
  }
}

async function expectTurn3PersistedRuntimeVisible(transcript) {
  /**
   * Assert third-turn thinking and tool rows remain visible after persisted
   * history replaces transient live rows.
   */
  for (const text of [
    TURN_3_THINKING_1,
    TURN_3_TOOL_COMMAND,
    TURN_3_TOOL_OUTPUT,
    TURN_3_THINKING_2,
  ]) {
    await expectVisibleCount(transcript, text, 1);
  }
}

function buildPersistedMessages(stage) {
  /**
   * Build raw session messages in the same shape consumed by convertSessionMessages.
   */
  const messages = [
    userRecord('proposal-70-user-1', TURN_1_USER, '2026-06-04T10:00:00.000Z'),
    assistantRecord('proposal-70-assistant-1', TURN_1_ASSISTANT, '2026-06-04T10:00:05.000Z'),
  ];
  if (stage === 'turn2-user-only' || stage === 'turn2-caught-up' || stage === 'turn3-user-only' || stage === 'all-caught-up') {
    messages.push(userRecord('proposal-70-user-2', TURN_2_USER, '2026-06-04T10:01:00.000Z'));
  }
  if (stage === 'turn2-caught-up' || stage === 'turn3-user-only' || stage === 'all-caught-up') {
    messages.push(
      thinkingRecord('proposal-70-thinking-2-1', TURN_2_THINKING_1, '2026-06-04T10:01:10.000Z'),
      toolUseRecord('proposal-70-tool-2', 'proposal-70-tool-2', TURN_2_TOOL_COMMAND, '2026-06-04T10:01:15.000Z'),
      toolResultRecord('proposal-70-tool-result-2', 'proposal-70-tool-2', TURN_2_TOOL_OUTPUT, '2026-06-04T10:01:20.000Z'),
      thinkingRecord('proposal-70-thinking-2-2', TURN_2_THINKING_2, '2026-06-04T10:01:25.000Z'),
      assistantRecord('proposal-70-assistant-2', TURN_2_PERSISTED, '2026-06-04T10:01:30.000Z'),
    );
  }
  if (stage === 'turn3-user-only' || stage === 'all-caught-up') {
    messages.push(userRecord('proposal-70-user-3', TURN_3_USER, '2026-06-04T10:02:00.000Z'));
  }
  if (stage === 'all-caught-up') {
    messages.push(
      thinkingRecord('proposal-70-thinking-3-1', TURN_3_THINKING_1, '2026-06-04T10:02:10.000Z'),
      toolUseRecord('proposal-70-tool-3', 'proposal-70-tool-3', TURN_3_TOOL_COMMAND, '2026-06-04T10:02:15.000Z'),
      toolResultRecord('proposal-70-tool-result-3', 'proposal-70-tool-3', TURN_3_TOOL_OUTPUT, '2026-06-04T10:02:20.000Z'),
      thinkingRecord('proposal-70-thinking-3-2', TURN_3_THINKING_2, '2026-06-04T10:02:25.000Z'),
      assistantRecord('proposal-70-assistant-3', TURN_3_PERSISTED, '2026-06-04T10:02:30.000Z'),
    );
  }
  return messages;
}

function userRecord(messageKey, content, timestamp) {
  /**
   * Create one persisted Codex user row.
   */
  return {
    type: 'message',
    provider: 'codex',
    messageKey,
    timestamp,
    message: { role: 'user', content },
  };
}

function assistantRecord(messageKey, content, timestamp) {
  /**
   * Create one persisted Codex assistant row.
   */
  return {
    type: 'message',
    provider: 'codex',
    messageKey,
    timestamp,
    message: { role: 'assistant', content },
  };
}

function thinkingRecord(messageKey, content, timestamp) {
  /**
   * Create one persisted Codex thinking row.
   */
  return {
    type: 'thinking',
    provider: 'codex',
    messageKey,
    timestamp,
    message: { role: 'assistant', content },
  };
}

function toolUseRecord(messageKey, toolCallId, command, timestamp) {
  /**
   * Create one persisted Codex tool_use row.
   */
  return {
    type: 'tool_use',
    provider: 'codex',
    messageKey,
    timestamp,
    toolName: 'Bash',
    toolCallId,
    toolInput: { command },
    status: 'completed',
  };
}

function toolResultRecord(messageKey, toolCallId, output, timestamp) {
  /**
   * Create one persisted Codex tool_result row attached to a tool_use row.
   */
  return {
    type: 'tool_result',
    provider: 'codex',
    messageKey,
    timestamp,
    toolCallId,
    output,
  };
}

async function writeEvidence(page, messageResponses, wsEvents) {
  /**
   * Persist QA artifacts for final browser state, read-model traffic, and WS events.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'final-transcript.png'),
    fullPage: true,
  });
  const state = await page.evaluate(() => ({
    bodyText: document.body.textContent || '',
    sentMessages: window.__proposal70SentMessages?.() || [],
    wsEvents: window.__proposal70WsEvents?.() || [],
  }));
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'state-snapshot.json'),
    JSON.stringify(state, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'read-model-network.json'),
    JSON.stringify(messageResponses, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'websocket-events.json'),
    JSON.stringify({ browser: state.wsEvents, console: wsEvents }, null, 2),
    'utf8',
  );
}
