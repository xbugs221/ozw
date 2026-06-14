// @ts-nocheck -- Proposal evidence test favors realistic browser behavior over strict test typing.
/**
 * PURPOSE: Collect proposal 73 browser evidence for a Pi persisted transcript
 * whose assistant content interleaves text, thinking and tool calls.
 *
 * The Node acceptance test proves each read model layer preserves order. This
 * browser test verifies the same persisted session through the real /messages
 * route and captures the artifacts required by the sealed acceptance contract.
 */
import { expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  authenticatePage,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from '../spec/helpers/spec-test-helpers.ts';
import { PLAYWRIGHT_FIXTURE_HOME } from './helpers/playwright-fixture.ts';

const SESSION_ID = 'proposal-73-pi-native-order-browser';
const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/pi-session-message-order');
const USER_TEXT = 'proposal 73 用户要求 Pi 按顺序读取文件、思考并执行命令';
const INTRO_TEXT = 'proposal 73 assistant 正文开头：先确认用户请求和当前目录。';
const THINKING_BEFORE_TOOL = 'proposal 73 thinking：检查上下文后再决定要执行的命令。';
const BEFORE_TOOL_TEXT = 'proposal 73 assistant 工具前正文：接下来运行一个只读命令。';
const COMMAND_TEXT = 'printf proposal-73-pi-order';
const TOOL_OUTPUT = 'proposal-73-pi-order';
const THINKING_AFTER_TOOL = 'proposal 73 thinking：工具输出已经回来，继续整理最终结论。';
const FINAL_TEXT = 'proposal 73 assistant 最终正文：命令输出已验证，消息顺序保持正确。';
const REPEATED_USER_TEXT = '继续';
const REPEATED_REPLY_ONE = 'proposal 73 第一次继续的 Pi 回复';
const REPEATED_REPLY_TWO = 'proposal 73 第二次继续的 Pi 回复';
const EXPECTED_RAW_ORDER = [
  `user:${USER_TEXT}`,
  `assistant:${INTRO_TEXT}`,
  `thinking:${THINKING_BEFORE_TOOL}`,
  `assistant:${BEFORE_TOOL_TEXT}`,
  `tool_use:bash:${COMMAND_TEXT}`,
  `tool_result:${TOOL_OUTPUT}`,
  `thinking:${THINKING_AFTER_TOOL}`,
  `assistant:${FINAL_TEXT}`,
  `user:${REPEATED_USER_TEXT}`,
  `assistant:${REPEATED_REPLY_ONE}`,
  `user:${REPEATED_USER_TEXT}`,
  `assistant:${REPEATED_REPLY_TWO}`,
];

test('Pi persisted browser transcript preserves provider order and writes acceptance evidence', async ({ page }) => {
  /**
   * Seed one native Pi session, open it through the normal browser route, capture
   * the /messages response, and screenshot the final visible transcript.
   */
  await writePiSessionFixture();
  await authenticatePage(page);

  const messageResponses = [];
  page.on('response', async (response) => {
    if (!response.url().includes(`/sessions/${SESSION_ID}/messages`)) {
      return;
    }
    try {
      messageResponses.push({
        url: response.url(),
        status: response.status(),
        body: await response.json(),
      });
    } catch (error) {
      messageResponses.push({
        url: response.url(),
        status: response.status(),
        error: String(error),
      });
    }
  });

  const query = new URLSearchParams({
    provider: 'pi',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionSummary: 'proposal 73 Pi 顺序浏览器验收',
  });
  await page.goto(`/session/${SESSION_ID}?${query.toString()}`, { waitUntil: 'networkidle' });

  for (const text of [
    USER_TEXT,
    INTRO_TEXT,
    THINKING_BEFORE_TOOL,
    BEFORE_TOOL_TEXT,
    COMMAND_TEXT,
    THINKING_AFTER_TOOL,
    FINAL_TEXT,
    REPEATED_REPLY_ONE,
    REPEATED_REPLY_TWO,
  ]) {
    await expect(page.locator('body')).toContainText(text, { timeout: 15_000 });
  }

  const bodyText = await page.locator('body').innerText();
  assertTranscriptOrder(bodyText, [
    USER_TEXT,
    INTRO_TEXT,
    THINKING_BEFORE_TOOL,
    BEFORE_TOOL_TEXT,
    COMMAND_TEXT,
    THINKING_AFTER_TOOL,
    FINAL_TEXT,
    REPEATED_USER_TEXT,
    REPEATED_REPLY_ONE,
    REPEATED_USER_TEXT,
    REPEATED_REPLY_TWO,
  ]);
  expect(countOccurrences(bodyText, REPEATED_USER_TEXT)).toBeGreaterThanOrEqual(2);

  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'final-transcript.png'),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'messages-network.json'),
    JSON.stringify({
      sessionId: SESSION_ID,
      capturedAt: new Date().toISOString(),
      responses: messageResponses,
    }, null, 2),
    'utf8',
  );

  expect(messageResponses.length).toBeGreaterThan(0);
  const completeResponses = messageResponses.filter((entry) => isCompleteTranscriptResponse(entry));
  expect(completeResponses.length, 'must capture at least one full /messages response without afterLine').toBeGreaterThan(0);
  expect(completeResponses.at(-1).body.messages.map(toRawOrderLabel).filter(Boolean)).toEqual(EXPECTED_RAW_ORDER);

  for (const entry of messageResponses.filter((response) => hasAfterLineCursor(response.url))) {
    const rawOrder = entry.body?.messages?.map(toRawOrderLabel).filter(Boolean) || [];
    expect(
      rawOrder.length === 0 || isSubsequence(EXPECTED_RAW_ORDER, rawOrder),
      `afterLine refresh may be empty or a suffix of the full transcript: ${entry.url}`,
    ).toBe(true);
  }
});

async function writePiSessionFixture() {
  /**
   * Write the native Pi JSONL rows read by the browser /messages endpoint.
   */
  const sessionDir = path.join(PLAYWRIGHT_FIXTURE_HOME, '.pi', 'agent', 'sessions', '2026', '06', '05');
  await fs.mkdir(sessionDir, { recursive: true });
  const filePath = path.join(sessionDir, `2026-06-05T08-00-00-000Z_${SESSION_ID}.jsonl`);
  const rows = [
    {
      type: 'session',
      id: SESSION_ID,
      cwd: PRIMARY_FIXTURE_PROJECT_PATH,
      timestamp: '2026-06-05T08:00:00.000Z',
    },
    piMessage('proposal-73-user-1', '2026-06-05T08:00:01.000Z', 'user', [{ type: 'text', text: USER_TEXT }]),
    piMessage('proposal-73-assistant-1', '2026-06-05T08:00:02.000Z', 'assistant', [
      { type: 'text', text: INTRO_TEXT },
      { type: 'thinking', thinking: THINKING_BEFORE_TOOL },
      { type: 'text', text: BEFORE_TOOL_TEXT },
      { type: 'toolCall', id: 'proposal-73-tool-1', name: 'bash', arguments: { command: COMMAND_TEXT } },
    ], 'proposal-73-user-1'),
    {
      type: 'message',
      id: 'proposal-73-tool-result-1',
      parentId: 'proposal-73-assistant-1',
      timestamp: '2026-06-05T08:00:03.000Z',
      message: {
        role: 'toolResult',
        toolCallId: 'proposal-73-tool-1',
        toolName: 'bash',
        content: [{ type: 'text', text: TOOL_OUTPUT }],
      },
    },
    piMessage('proposal-73-assistant-2', '2026-06-05T08:00:04.000Z', 'assistant', [
      { type: 'thinking', thinking: THINKING_AFTER_TOOL },
      { type: 'text', text: FINAL_TEXT },
    ], 'proposal-73-tool-result-1'),
    piMessage('proposal-73-repeat-user-1', '2026-06-05T08:00:04.500Z', 'user', [{ type: 'text', text: REPEATED_USER_TEXT }]),
    piMessage('proposal-73-repeat-assistant-1', '2026-06-05T08:00:04.600Z', 'assistant', [{ type: 'text', text: REPEATED_REPLY_ONE }], 'proposal-73-repeat-user-1'),
    piMessage('proposal-73-repeat-user-2', '2026-06-05T08:00:04.700Z', 'user', [{ type: 'text', text: REPEATED_USER_TEXT }]),
    piMessage('proposal-73-repeat-assistant-2', '2026-06-05T08:00:04.800Z', 'assistant', [{ type: 'text', text: REPEATED_REPLY_TWO }], 'proposal-73-repeat-user-2'),
  ];
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

function piMessage(id, timestamp, role, content, parentId = undefined) {
  /**
   * Build one native Pi JSONL message row.
   */
  return {
    type: 'message',
    id,
    parentId,
    timestamp,
    message: { role, content },
  };
}

function assertTranscriptOrder(text, expectedParts) {
  /**
   * Assert visible transcript text appears in the same order as Pi wrote it.
   */
  let cursor = 0;
  for (const part of expectedParts) {
    const index = text.indexOf(part, cursor);
    expect(index, `expected transcript to contain "${part}" after index ${cursor}`).toBeGreaterThanOrEqual(0);
    cursor = index + part.length;
  }
}

function countOccurrences(text, needle) {
  /**
   * Count repeated visible user turns without depending on exact DOM structure.
   */
  return text.split(needle).length - 1;
}

function isCompleteTranscriptResponse(entry) {
  /**
   * Identify the full browser /messages read instead of a later afterLine poll.
   */
  const messages = entry.body?.messages;
  return entry.status === 200
    && !hasAfterLineCursor(entry.url)
    && Array.isArray(messages)
    && messages.length === EXPECTED_RAW_ORDER.length;
}

function hasAfterLineCursor(url) {
  /**
   * Detect incremental refresh requests that may legitimately return no rows.
   */
  try {
    const parsed = new URL(url);
    return parsed.searchParams.has('afterLine');
  } catch {
    return url.includes('afterLine=');
  }
}

function isSubsequence(fullOrder, candidateOrder) {
  /**
   * Check that an incremental response keeps provider order when it has rows.
   */
  if (candidateOrder.length === 0) {
    return true;
  }
  let cursor = 0;
  for (const item of fullOrder) {
    if (item === candidateOrder[cursor]) {
      cursor += 1;
      if (cursor === candidateOrder.length) {
        return true;
      }
    }
  }
  return false;
}

function toRawOrderLabel(message) {
  /**
   * Convert /messages raw rows into the same labels used by the Node contract.
   */
  if (message.type === 'user' || message.type === 'assistant') {
    return `${message.type}:${String(message.message?.content || '').trim()}`;
  }
  if (message.type === 'thinking') {
    return `thinking:${String(message.message?.content || '').trim()}`;
  }
  if (message.type === 'tool_use') {
    return `tool_use:${message.toolName}:${extractCommandText(message.toolInput)}`;
  }
  if (message.type === 'tool_result') {
    return `tool_result:${String(message.output || '').trim()}`;
  }
  return '';
}

function extractCommandText(value) {
  /**
   * Normalize Pi tool input from object or JSON string into the command text.
   */
  if (typeof value === 'string') {
    try {
      return extractCommandText(JSON.parse(value));
    } catch {
      return value.trim();
    }
  }
  if (value && typeof value === 'object') {
    return String(value.command || value.cmd || value.input || '').trim();
  }
  return '';
}
