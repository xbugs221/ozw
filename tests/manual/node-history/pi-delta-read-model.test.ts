// @ts-nocheck -- Proposal acceptance test: executes against the current server read model.
/**
 * PURPOSE: Verify Pi text_delta events are aggregated into user-visible chat
 * messages instead of being exposed as one assistant row per transport chunk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { readCoConversationMessages } from '../../../backend/co-read-model.ts';

async function writeJson(filePath, value) {
  /**
   * Write JSON fixture data using the same durable files read by ozw.
   */
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writePiDeltaConversation(coHome) {
  /**
   * Create a co conversation whose Pi output mirrors real text_delta traffic.
   */
  const conversationId = 'c-pi-delta';
  const turnId = 'turn_pi_delta';
  const requestId = 'req-pi-delta';
  const turnDir = path.join(coHome, 'turns', turnId);

  await writeJson(path.join(coHome, 'conversations', conversationId, 'state.json'), {
    contract: 'co-conversation-v1',
    conversation_id: conversationId,
    provider: 'pi',
    provider_session_id: 'pi-provider-delta',
    project_path: '/tmp/ozw-pi-delta-project',
    active_turn_id: '',
    status: 'completed',
    turns: [turnId],
  });
  await writeJson(path.join(coHome, 'requests', 'done', `${requestId}.json`), {
    request_id: requestId,
    conversation_id: conversationId,
    provider: 'pi',
    text: '测试 Pi 流式输出',
    created_at: '2026-05-23T09:38:20.000Z',
  });
  await writeJson(path.join(turnDir, 'request.json'), {
    request_id: requestId,
    conversation_id: conversationId,
  });

  // Real Pi events carry a thinking block at content[0] and visible
  // text at content[1]. The read model must find the type==='text' block
  // regardless of its position in the content array.
  const delta = (seq, responseId, text, cumulativeText) => ({
    seq,
    created_at: `2026-05-23T09:38:${String(20 + seq).padStart(2, '0')}.000Z`,
    type: 'pi-response',
    provider: 'pi',
    turn_id: turnId,
    conversation_id: conversationId,
    data: {
      type: 'item',
      itemType: 'agent_message',
      message: { content: text },
      raw: {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 1,
          delta: text,
          partial: {
            responseId,
            role: 'assistant',
            content: [
              { thinking: `thinking about ${cumulativeText}`, thinkingSignature: 'reasoning_content', type: 'thinking' },
              { type: 'text', text: cumulativeText },
            ],
          },
        },
        message: {
          responseId,
          role: 'assistant',
          content: [
            { thinking: `thinking about ${cumulativeText}`, thinkingSignature: 'reasoning_content', type: 'thinking' },
            { type: 'text', text: cumulativeText },
          ],
        },
      },
    },
  });

  const events = [
    delta(1, 'response-one', 'Let', 'Let'),
    delta(2, 'response-one', ' me', 'Let me'),
    delta(3, 'response-one', ' test.', 'Let me test.'),
    {
      seq: 4,
      created_at: '2026-05-23T09:38:24.000Z',
      type: 'pi-complete',
      provider: 'pi',
      turn_id: turnId,
      conversation_id: conversationId,
      data: { type: 'turn_complete', raw: { type: 'turn_end' } },
    },
    delta(5, 'response-two', '结果', '结果'),
    delta(6, 'response-two', '正常', '结果正常'),
    delta(7, 'response-two', '。', '结果正常。'),
  ];
  await fs.mkdir(turnDir, { recursive: true });
  await fs.writeFile(path.join(turnDir, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');

  return {
    conversation_id: conversationId,
    provider: 'pi',
    provider_session_id: 'pi-provider-delta',
    turns: [turnId],
  };
}

test('Pi events with thinking block in content[0] are still aggregated correctly (c929 shape)', async () => {
  /**
   * c929 real events place a thinking block at content[0] and visible
   * text at content[1].  The read model must locate the text block by
   * type, not by index.
   */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-oz46-pi-c929-'));
  const previousCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = path.join(tempRoot, 'co');

  try {
    const conversationId = 'c929-shape';
    const turnId = 'turn_c929_shape';
    const requestId = 'req-c929';
    const turnDir = path.join(process.env.CCFLOW_CO_HOME, 'turns', turnId);

    await writeJson(path.join(process.env.CCFLOW_CO_HOME, 'conversations', conversationId, 'state.json'), {
      contract: 'co-conversation-v1',
      conversation_id: conversationId,
      provider: 'pi',
      provider_session_id: 'pi-c929-session',
      project_path: '/tmp/ozw-pi-c929-project',
      active_turn_id: turnId,
      status: 'running',
      turns: [turnId],
    });
    await writeJson(path.join(process.env.CCFLOW_CO_HOME, 'requests', 'done', `${requestId}.json`), {
      request_id: requestId,
      conversation_id: conversationId,
      provider: 'pi',
      text: '测试',
      created_at: '2026-05-23T09:38:20.000Z',
    });
    await writeJson(path.join(turnDir, 'request.json'), { request_id: requestId, conversation_id: conversationId });

    // Mirror real c929: thinking block at content[0], text at content[1],
    // cumulative partial text, delta string in message.content, no terminal
    // pi-complete.
    const makeDelta = (seq, cumulativeText, delta) => ({
      seq,
      created_at: `2026-05-23T09:38:${String(20 + seq).padStart(2, '0')}.000Z`,
      type: 'pi-response',
      provider: 'pi',
      turn_id: turnId,
      conversation_id: conversationId,
      data: {
        type: 'item',
        message: { content: delta },
        raw: {
          assistantMessageEvent: {
            contentIndex: 1,
            delta,
            partial: {
              responseId: 'resp-abc',
              role: 'assistant',
              content: [
                { thinking: 'reasoning', thinkingSignature: 'thinkingSignature', type: 'thinking' },
                { text: cumulativeText, type: 'text' },
              ],
            },
          },
          message: {
            responseId: 'resp-abc',
            role: 'assistant',
            content: [
              { thinking: 'reasoning', thinkingSignature: 'thinkingSignature', type: 'thinking' },
              { text: cumulativeText, type: 'text' },
            ],
          },
        },
      },
    });

    // Real Pi events carry cumulative partial text (it grows over time).
    const events = [
      makeDelta(1, 'Let', 'Let'),
      makeDelta(2, 'Let me', ' me'),
      makeDelta(3, 'Let me first', ' first'),
    ];
    await fs.mkdir(turnDir, { recursive: true });
    await fs.writeFile(path.join(turnDir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');

    const conversation = {
      conversation_id: conversationId,
      provider: 'pi',
      provider_session_id: 'pi-c929-session',
      turns: [turnId],
    };
    const result = await readCoConversationMessages(conversation, 'pi');
    const transcript = result.messages.map((m) => ({
      type: m.type,
      content: m.message?.content,
    }));

    assert.deepEqual(transcript, [
      { type: 'user', content: '测试' },
      { type: 'assistant', content: 'Let me first' },
    ]);
  } finally {
    if (previousCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = previousCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('Pi text_delta events are aggregated into complete assistant messages', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-oz46-pi-delta-'));
  const previousCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = path.join(tempRoot, 'co');

  try {
    const conversation = await writePiDeltaConversation(process.env.CCFLOW_CO_HOME);
    const result = await readCoConversationMessages(conversation, 'pi');
    const transcript = result.messages.map((message) => ({
      type: message.type,
      content: message.message?.content,
    }));

    assert.deepEqual(transcript, [
      { type: 'user', content: '测试 Pi 流式输出' },
      { type: 'assistant', content: 'Let me test.' },
      { type: 'assistant', content: '结果正常。' },
    ]);
  } finally {
    if (previousCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = previousCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
