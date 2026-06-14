// @ts-nocheck -- Spec fixture builds Codex JSONL rows dynamically across backend and frontend layers.
/**
 * Sources: 2026-06-08-87-修复Codex历史会话气泡顺序错乱
 *
 * PURPOSE: Verify Codex historical session reads keep raw-line pagination,
 * provider-internal role filtering, duplicate user echo dedupe and visible turn
 * order stable through the real read model and frontend message transformer.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getCodexSessionMessages } from '../../backend/projects.ts';
import { convertSessionMessages } from '../../frontend/components/chat/utils/messageTransforms.ts';

/**
 * Run each contract inside an isolated HOME so real Codex history is untouched.
 */
async function withTemporaryHome(testBody) {
  const originalHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-codex-history-order-spec-'));

  process.env.HOME = tempHome;
  try {
    await testBody(tempHome);
  } finally {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    await fs.rm(tempHome, { recursive: true, force: true });
  }
}

/**
 * Extract the raw JSONL line number encoded in a mapped Codex message key.
 */
function getRawLineNumber(message) {
  const match = String(message?.messageKey || '').match(/:line:(\d+):/);
  return match ? Number(match[1]) : null;
}

/**
 * Collect the raw JSONL line numbers represented by one API result page.
 */
function collectRawLineNumbers(messages) {
  return new Set(
    messages
      .map(getRawLineNumber)
      .filter((lineNumber) => Number.isFinite(lineNumber)),
  );
}

/**
 * Write a rollout-style Codex session file into the isolated HOME.
 */
async function writeRolloutSession(homeDir, sessionId, lines) {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '06', '07');
  const sessionPath = path.join(sessionsDir, `rollout-2026-06-07T12-00-00-${sessionId}.jsonl`);
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
}

/**
 * Build the session metadata row that makes this a valid Codex rollout session.
 */
function sessionMeta(sessionId) {
  return {
    timestamp: '2026-06-07T04:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: sessionId,
      cwd: '/tmp/ozw-codex-history-order-project',
      originator: 'codex_exec',
      cli_version: '0.137.0',
      source: 'exec',
      model_provider: 'openai',
    },
  };
}

/**
 * Build a provider-internal developer message that must never be user-visible.
 */
function developerMessage() {
  return {
    timestamp: '2026-06-07T04:00:00.001Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: '内部开发者指令，不应显示在聊天历史中。' }],
    },
  };
}

/**
 * Build the response_item user echo row that Codex can persist beside event_msg.
 */
function userResponse(timestamp, text) {
  return {
    timestamp,
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text }],
    },
  };
}

/**
 * Build the event_msg user row used for the visible chat bubble.
 */
function userEvent(timestamp, text) {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'user_message',
      message: text,
    },
  };
}

/**
 * Build a visible assistant text row.
 */
function assistantMessage(timestamp, text) {
  return {
    timestamp,
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      content: [{ type: 'output_text', text }],
    },
  };
}

/**
 * Build a tool call row so UI message count differs from raw JSONL line count.
 */
function toolCall(timestamp, index) {
  return {
    timestamp,
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'exec_command',
      call_id: `call-${index}`,
      arguments: JSON.stringify({ cmd: `printf page-${index}` }),
    },
  };
}

/**
 * Build the matching tool result row for a tool call.
 */
function toolResult(timestamp, index) {
  return {
    timestamp,
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      call_id: `call-${index}`,
      output: `page-${index}`,
    },
  };
}

/**
 * Build a multi-turn Codex history with duplicate user echoes and many tool rows.
 */
function buildRolloutHistory(sessionId) {
  const lines = [
    sessionMeta(sessionId),
    developerMessage(),
    {
      timestamp: '2026-06-07T04:00:00.002Z',
      type: 'turn_context',
      payload: { cwd: '/tmp/ozw-codex-history-order-project' },
    },
  ];

  for (let turn = 1; turn <= 4; turn += 1) {
    const minute = String(turn).padStart(2, '0');
    const userText = `第${turn}轮用户需求`;
    lines.push(userResponse(`2026-06-07T04:${minute}:00.000Z`, userText));
    lines.push(userEvent(`2026-06-07T04:${minute}:00.001Z`, userText));
    lines.push(assistantMessage(`2026-06-07T04:${minute}:10.000Z`, `第${turn}轮开始处理`));

    for (let index = 0; index < 18; index += 1) {
      const toolIndex = turn * 100 + index;
      lines.push(toolCall(`2026-06-07T04:${minute}:20.000Z`, toolIndex));
      lines.push(toolResult(`2026-06-07T04:${minute}:21.000Z`, toolIndex));
    }

    lines.push(assistantMessage(`2026-06-07T04:${minute}:50.000Z`, `第${turn}轮最终回复`));
  }

  return lines;
}

/**
 * Convert frontend-visible messages into a compact order list for assertions.
 */
function compactVisibleOrder(messages) {
  return messages.map((message) => ({
    type: message.type,
    text: typeof message.content === 'string' ? message.content : '',
    key: message.messageKey || '',
    tool: message.toolName || '',
  }));
}

test('Codex history read model filters provider-internal developer role messages', async () => {
  /**
   * Developer/system/bootstrap rows are provider context, not chat content. If
   * they enter the read model, they also distort pagination and user bubble
   * ordering.
   */
  await withTemporaryHome(async (tempHome) => {
    const sessionId = '019ecodex-history-order-internal-role';
    await writeRolloutSession(tempHome, sessionId, buildRolloutHistory(sessionId));

    const result = await getCodexSessionMessages(sessionId, null, 0, null);
    const leakedInternalMessage = result.messages.find((message) => message.message?.role === 'developer');

    assert.equal(
      leakedInternalMessage,
      undefined,
      'developer/system/provider internal messages must not enter the Codex history messages API',
    );
  });
});

test('Codex history pagination exposes a raw line cursor and adjacent pages do not overlap', async () => {
  /**
   * The frontend must page by backend raw-line cursor, because one JSONL row can
   * create zero, one or several UI messages.
   */
  await withTemporaryHome(async (tempHome) => {
    const sessionId = '019ecodex-history-order-pagination';
    await writeRolloutSession(tempHome, sessionId, buildRolloutHistory(sessionId));

    const firstPage = await getCodexSessionMessages(sessionId, 40, 0, null);

    assert.equal(
      typeof firstPage.nextRawLineOffset,
      'number',
      'pagination responses must return nextRawLineOffset instead of relying on messages.length',
    );

    const secondPage = await getCodexSessionMessages(sessionId, 40, firstPage.nextRawLineOffset, null);
    const firstLines = collectRawLineNumbers(firstPage.messages);
    const secondLines = collectRawLineNumbers(secondPage.messages);
    const overlap = [...firstLines].filter((lineNumber) => secondLines.has(lineNumber));

    assert.deepEqual(overlap, [], 'adjacent pages must not cover the same raw JSONL lines');
  });
});

test('Codex history full load keeps user bubbles in turn order and away from the transcript tail', async () => {
  /**
   * Duplicate Codex user echoes should collapse to one visible user bubble, and
   * each bubble must stay before its own assistant/tool response.
   */
  await withTemporaryHome(async (tempHome) => {
    const sessionId = '019ecodex-history-order-full-load';
    await writeRolloutSession(tempHome, sessionId, buildRolloutHistory(sessionId));

    const result = await getCodexSessionMessages(sessionId, null, 0, null);
    const visibleMessages = convertSessionMessages(result.messages);
    const order = compactVisibleOrder(visibleMessages);
    const userIndexes = order
      .map((message, index) => (message.type === 'user' ? index : -1))
      .filter((index) => index >= 0);

    assert.equal(userIndexes.length, 4, 'four user turns must each render once after duplicate echo dedupe');

    for (let turn = 1; turn <= 4; turn += 1) {
      const userIndex = order.findIndex((message) => message.type === 'user' && message.text === `第${turn}轮用户需求`);
      const finalAssistantIndex = order.findIndex((message) => (
        message.type === 'assistant' && message.text === `第${turn}轮最终回复`
      ));
      assert.ok(userIndex >= 0, `turn ${turn} user bubble must exist`);
      assert.ok(finalAssistantIndex > userIndex, `turn ${turn} assistant response must appear after its user bubble`);
    }

    const firstUserIndex = userIndexes[0];
    const lastUserIndex = userIndexes[userIndexes.length - 1];
    assert.ok(
      lastUserIndex < order.length - 1,
      'the final user bubble must still have assistant/tool content after it, not be grouped at the tail',
    );
    assert.equal(firstUserIndex, 0, 'after filtering internal roles, the first visible bubble should be the real user');
  });
});
