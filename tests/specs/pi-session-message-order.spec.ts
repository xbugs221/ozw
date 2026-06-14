// @ts-nocheck -- Spec fixture reuses dynamic route/test doubles across backend and frontend layers.
/**
 * Sources: 2026-06-05-73-修复Pi会话消息顺序错乱
 *
 * PURPOSE: Verify Pi persisted session order through the real native JSONL read
 * model and frontend message transformer, so provider content order is not
 * rewritten by type grouping during refresh or pagination.
 *
 * Plain-language summary:
 * Pi writes one conversation as a JSONL file. Inside one assistant reply, Pi can
 * mix normal text, thinking text and tool calls in the exact order the user saw
 * them. ozw must keep that order. This test creates such a transcript and then
 * reads it through the same paths real users hit, so a fix cannot pass by only
 * changing one helper while the browser still shows the wrong order.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { handleGetSessionMessages } from '../../backend/session-messages-handler.ts';
import {
  clearProjectDirectoryCache,
  createManualSessionDraft,
  finalizeManualSessionRoute,
  getPiSessionMessages,
} from '../../backend/projects.ts';
import { convertSessionMessages } from '../../frontend/components/chat/utils/messageTransforms.ts';

const SESSION_ID = 'proposal-73-pi-native-order';
const PROJECT_NAME = 'proposal-73-pi-order-project';
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
const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/pi-session-message-order');

test('Pi persisted transcript preserves native text thinking tool order through native, cN route, cursor and visible UI transforms', async () => {
  /**
   * Create a realistic Pi native transcript and verify backend raw messages,
   * cN /messages handler output, cursor reads and frontend-visible messages all
   * keep provider order across mixed content parts and repeated user text.
   *
   * The four reads below intentionally cover different user situations:
   * - nativeResult: backend reads the Pi provider session directly.
   * - routeResult: browser refresh reads the visible cN manual-session route.
   * - cursorResult: "load newer messages after line N" must not regroup rows.
   * - visibleMessages: frontend conversion must show the same order to humans.
   */
  const tempHome = path.join(os.tmpdir(), `ozw-proposal-73-${Date.now()}`);
  const previousHome = process.env.HOME;
  const previousXdgStateHome = process.env.XDG_STATE_HOME;
  const previousCoHome = process.env.CCFLOW_CO_HOME;

  process.env.HOME = tempHome;
  process.env.XDG_STATE_HOME = path.join(tempHome, '.local', 'state');
  process.env.CCFLOW_CO_HOME = path.join(tempHome, '.local', 'state', 'ozw', 'co');
  try {
    const projectPath = path.join(tempHome, 'workspace', 'proposal-73-pi-order');
    await fs.mkdir(projectPath, { recursive: true });
    await writeProjectConfig(tempHome, PROJECT_NAME, projectPath);
    clearProjectDirectoryCache();
    await writePiSessionFixture(tempHome, projectPath);
    // A Pi manual session shown in ozw uses a route id like c1/c2, while the
    // actual Pi transcript has its own provider session id. This binding creates
    // the real relationship the browser uses after refresh.
    const draft = await createManualSessionDraft(PROJECT_NAME, projectPath, 'pi', 'proposal 73 Pi 顺序验收');
    await finalizeManualSessionRoute(PROJECT_NAME, draft.id, SESSION_ID, 'pi', projectPath);

    const nativeResult = await getPiSessionMessages(SESSION_ID, null, 0, null);
    const routeResult = await readMessagesThroughRoute(PROJECT_NAME, draft.id, projectPath);
    const cursorResult = await getPiSessionMessages(SESSION_ID, null, 0, 2);
    const rawOrder = nativeResult.messages.map(toRawOrderLabel).filter(Boolean);
    const routeRawOrder = routeResult.messages.map(toRawOrderLabel).filter(Boolean);
    const cursorRawOrder = cursorResult.messages.map(toRawOrderLabel).filter(Boolean);
    const visibleMessages = convertSessionMessages(routeResult.messages);
    const visibleOrder = visibleMessages.map(toVisibleOrderLabel).filter(Boolean);
    // Even when the assertion fails, keep a snapshot with all four views. This
    // makes QA review concrete: reviewers can compare what Pi wrote, what the API
    // returned, and what the frontend would render.
    await writeOrderEvidence({
      rawOrder,
      routeRawOrder,
      cursorRawOrder,
      visibleOrder,
      nativeMessages: nativeResult.messages,
      routeMessages: routeResult.messages,
      cursorMessages: cursorResult.messages,
      visibleMessages,
    });

    const expectedRawOrder = [
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
    // This is the core contract: the backend raw transcript must read exactly as
    // Pi wrote it. The old bug fails here because both assistant text parts are
    // merged and moved after thinking/tool rows.
    assert.deepEqual(rawOrder, expectedRawOrder, 'native Pi read model must keep provider order exactly');
    // A fix that only repairs provider-session direct reads is not enough. Users
    // usually open cN routes in ozw, so the route handler must return the same
    // sequence as the provider read model.
    assert.deepEqual(routeRawOrder, expectedRawOrder, 'cN /messages route must return the same order as native Pi read model');
    // Pagination/cursor refresh is how the UI asks for "messages after line 2".
    // It must preserve the same order and must not reprocess the mixed assistant
    // row differently from the full-session read.
    assert.deepEqual(cursorRawOrder, expectedRawOrder.slice(1), 'afterLine cursor reads must not regroup the mixed assistant row');

    // Raw API order is not enough; the final user-visible ChatMessage list must
    // also keep the same story order. tool_result is absent here because the UI
    // should attach it to the tool card instead of showing a separate bubble.
    assert.deepEqual(visibleOrder, [
      `user:${USER_TEXT}`,
      `assistant:${INTRO_TEXT}`,
      `thinking:${THINKING_BEFORE_TOOL}`,
      `assistant:${BEFORE_TOOL_TEXT}`,
      `tool_use:bash:${COMMAND_TEXT}`,
      `thinking:${THINKING_AFTER_TOOL}`,
      `assistant:${FINAL_TEXT}`,
      `user:${REPEATED_USER_TEXT}`,
      `assistant:${REPEATED_REPLY_ONE}`,
      `user:${REPEATED_USER_TEXT}`,
      `assistant:${REPEATED_REPLY_TWO}`,
    ]);
    // Users often send short repeated prompts such as "continue". A lazy fix that
    // dedupes by text or timestamp could wrongly delete the second real turn.
    assert.equal(
      visibleMessages.filter((message) => message.type === 'user' && message.content === REPEATED_USER_TEXT).length,
      2,
      'two identical Pi user turns must both remain visible; text-based dedupe is not acceptable',
    );

    const toolCard = visibleMessages.find((message) => message.isToolUse && message.toolName === 'bash');
    assert.ok(toolCard, 'Pi toolCall must become one visible tool card');
    // The tool result should enrich the existing tool card. If it becomes a
    // second tool card, users see the command/result pair split apart.
    assert.equal(
      visibleMessages.filter((message) => message.isToolUse && message.toolCallId === 'proposal-73-tool-1').length,
      1,
      'the same Pi toolCallId must produce one tool card, not one call card plus one result card',
    );
    // This confirms the output text is still available for inspection, even
    // though it is attached to the card instead of rendered as its own message.
    assert.equal(
      extractToolResultText(toolCard),
      TOOL_OUTPUT,
      'Pi toolResult must attach to the original tool card without moving the card',
    );
    // A compact final guard for the visible narrative: text before thinking,
    // thinking before text before tool, tool before later thinking, then final
    // answer. This is the order a non-technical reviewer can inspect manually.
    assertOrderIndexes(
      visibleOrder,
      [
        `assistant:${INTRO_TEXT}`,
        `thinking:${THINKING_BEFORE_TOOL}`,
        `assistant:${BEFORE_TOOL_TEXT}`,
        `tool_use:bash:${COMMAND_TEXT}`,
        `thinking:${THINKING_AFTER_TOOL}`,
        `assistant:${FINAL_TEXT}`,
      ],
      'frontend visible order must preserve text/thinking/tool/text boundaries',
    );
  } finally {
    // Restore process-wide environment variables because these tests simulate a
    // different HOME/XDG state tree. Without cleanup, later tests could read the
    // temporary Pi transcript by accident.
    if (previousHome !== undefined) {
      process.env.HOME = previousHome;
    } else {
      delete process.env.HOME;
    }
    if (previousXdgStateHome !== undefined) {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    } else {
      delete process.env.XDG_STATE_HOME;
    }
    if (previousCoHome !== undefined) {
      process.env.CCFLOW_CO_HOME = previousCoHome;
    } else {
      delete process.env.CCFLOW_CO_HOME;
    }
    clearProjectDirectoryCache();
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

async function writePiSessionFixture(homeDir, projectPath) {
  /**
   * Write a native Pi JSONL transcript whose single assistant message interleaves
   * text, thinking and a tool call in the same content array.
   *
   * The important fixture shape is:
   * user asks -> assistant text -> thinking -> assistant text -> tool call
   * -> tool result -> thinking -> final text -> "continue" -> reply
   * -> "continue" again -> second reply.
   *
   * This mirrors the real problem: Pi can put several visible pieces inside one
   * assistant JSONL row. ozw must unfold those pieces in their original order.
   */
  const sessionDir = path.join(homeDir, '.pi', 'agent', 'sessions', '2026', '06', '05');
  await fs.mkdir(sessionDir, { recursive: true });
  const filePath = path.join(sessionDir, `2026-06-05T08-00-00-000Z_${SESSION_ID}.jsonl`);
  const rows = [
    {
      type: 'session',
      id: SESSION_ID,
      cwd: projectPath,
      timestamp: '2026-06-05T08:00:00.000Z',
    },
    {
      type: 'message',
      id: 'proposal-73-user-1',
      timestamp: '2026-06-05T08:00:01.000Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: USER_TEXT }],
      },
    },
    {
      type: 'message',
      id: 'proposal-73-assistant-1',
      parentId: 'proposal-73-user-1',
      timestamp: '2026-06-05T08:00:02.000Z',
      message: {
        role: 'assistant',
        content: [
          // These four parts intentionally share the same JSONL row and timestamp.
          // Any implementation that groups by type will move the two text parts
          // away from their surrounding thinking/tool entries.
          { type: 'text', text: INTRO_TEXT },
          { type: 'thinking', thinking: THINKING_BEFORE_TOOL },
          { type: 'text', text: BEFORE_TOOL_TEXT },
          {
            type: 'toolCall',
            id: 'proposal-73-tool-1',
            name: 'bash',
            arguments: { command: COMMAND_TEXT },
          },
        ],
      },
    },
    {
      type: 'message',
      id: 'proposal-73-tool-result-1',
      parentId: 'proposal-73-assistant-1',
      timestamp: '2026-06-05T08:00:03.000Z',
      message: {
        role: 'toolResult',
        toolCallId: 'proposal-73-tool-1',
        toolName: 'bash',
        // The output arrives in a later JSONL row, but it belongs to the previous
        // toolCall. The UI should attach it to that card instead of creating a
        // new message after the final answer.
        content: [{ type: 'text', text: TOOL_OUTPUT }],
      },
    },
    {
      type: 'message',
      id: 'proposal-73-assistant-2',
      parentId: 'proposal-73-tool-result-1',
      timestamp: '2026-06-05T08:00:04.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: THINKING_AFTER_TOOL },
          { type: 'text', text: FINAL_TEXT },
        ],
      },
    },
    {
      type: 'message',
      id: 'proposal-73-repeat-user-1',
      timestamp: '2026-06-05T08:00:04.500Z',
      message: {
        role: 'user',
        // Two repeated "continue" turns prove the fix cannot dedupe user turns
        // using only visible text or a short timestamp window.
        content: [{ type: 'text', text: REPEATED_USER_TEXT }],
      },
    },
    {
      type: 'message',
      id: 'proposal-73-repeat-assistant-1',
      parentId: 'proposal-73-repeat-user-1',
      timestamp: '2026-06-05T08:00:04.600Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: REPEATED_REPLY_ONE }],
      },
    },
    {
      type: 'message',
      id: 'proposal-73-repeat-user-2',
      timestamp: '2026-06-05T08:00:04.700Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: REPEATED_USER_TEXT }],
      },
    },
    {
      type: 'message',
      id: 'proposal-73-repeat-assistant-2',
      parentId: 'proposal-73-repeat-user-2',
      timestamp: '2026-06-05T08:00:04.800Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: REPEATED_REPLY_TWO }],
      },
    },
  ];

  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

async function writeProjectConfig(homeDir, projectName, projectPath) {
  /**
   * Persist the project path in ozw config so cN route resolution uses the real
   * manual-session metadata path instead of a test-only shortcut.
   *
   * Non-technical translation: this makes ozw believe the temporary folder is a
   * real project, so the route test behaves like opening an actual workspace.
   */
  const stateRoot = process.env.XDG_STATE_HOME || path.join(homeDir, '.local', 'state');
  const cfgDir = path.join(stateRoot, 'ozw');
  await fs.mkdir(cfgDir, { recursive: true });
  await fs.writeFile(
    path.join(cfgDir, 'conf.json'),
    JSON.stringify({ [projectName]: { originalPath: projectPath } }, null, 2),
    'utf8',
  );
}

function createMockRes() {
  /**
   * Minimal Express response double for exercising the production route handler.
   *
   * Express normally writes JSON to an HTTP response. In this test we call the
   * same handler directly and capture the status/body in a small object.
   */
  let statusCode = 200;
  let body = null;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      body = data;
      return this;
    },
    getStatus() {
      return statusCode;
    },
    getJson() {
      return body;
    },
  };
}

async function readMessagesThroughRoute(projectName, routeSessionId, projectPath) {
  /**
   * Exercise the same cN route endpoint used after a browser refresh.
   *
   * This catches a common incomplete fix: changing provider-session reads while
   * leaving ozw's visible route path broken.
   */
  const req = {
    params: { projectName, sessionId: routeSessionId },
    query: { provider: 'pi', projectPath },
  };
  const res = createMockRes();
  await handleGetSessionMessages(req, res);
  assert.equal(res.getStatus(), 200, `expected route status 200, got ${res.getStatus()}`);
  const body = res.getJson();
  assert.ok(Array.isArray(body?.messages), 'route response must include messages array');
  return body;
}

function toRawOrderLabel(message) {
  /**
   * Convert backend raw messages into stable order labels for business assertions.
   *
   * The labels intentionally look like "assistant:<text>" or "tool_use:bash:<cmd>"
   * so a failed diff reads like a transcript, not like internal objects.
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

function toVisibleOrderLabel(message) {
  /**
   * Convert frontend ChatMessage rows into the order a user reads in the UI.
   *
   * Raw backend rows and UI rows are different shapes. This helper normalizes the
   * UI shape into the same plain transcript labels used above.
   */
  if (message.isToolUse) {
    return `tool_use:${message.toolName}:${extractCommandText(message.toolInput)}`;
  }
  if (message.isThinking) {
    return `thinking:${String(message.content || '').trim()}`;
  }
  if (message.type === 'user' || message.type === 'assistant') {
    return `${message.type}:${String(message.content || '').trim()}`;
  }
  return '';
}

function extractCommandText(value) {
  /**
   * Resolve command text from raw Pi tool input or frontend-normalized strings.
   *
   * Tool input may be stored as an object or a JSON string depending on whether
   * it came from the backend raw row or the frontend transformed row.
   */
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return extractCommandText(parsed);
    } catch {
      return value.trim();
    }
  }
  if (value && typeof value === 'object') {
    return String(value.command || value.cmd || value.input || '').trim();
  }
  return '';
}

function extractToolResultText(message) {
  /**
   * Read the visible tool result content attached to a converted tool card.
   *
   * This does not search the whole transcript. It proves the result is attached
   * to the exact tool card users would expand in the chat UI.
   */
  const result = message.toolResult;
  if (!result || typeof result !== 'object') {
    return '';
  }
  return String(result.content || '').trim();
}

function assertOrderIndexes(order, expectedSubsequence, message) {
  /**
   * Assert every expected item is present once and appears in the listed order.
   *
   * This is easier to read than comparing the whole transcript when we only care
   * about a critical story segment.
   */
  const indexes = expectedSubsequence.map((item) => order.indexOf(item));
  assert.ok(indexes.every((index) => index >= 0), `${message}: every item must be present`);
  assert.deepEqual([...indexes].sort((a, b) => a - b), indexes, message);
}

async function writeOrderEvidence(snapshot) {
  /**
   * Persist a compact state snapshot for later wo QA evidence collection.
   *
   * The snapshot is not required for the assertion itself. It exists so QA can
   * open one JSON file and see all intermediate views that led to the verdict.
   */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'ordered-transcript.json'),
    JSON.stringify(snapshot, null, 2),
    'utf8',
  );
}
