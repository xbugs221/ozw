/**
 * PURPOSE: Contract tests for Codex follow-up refresh ordering when provider
 * JSONL/read-model history lags behind local live transcript state.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { mergePersistedAndOptimisticMessages } from '../../../frontend/components/chat/utils/sessionMessageMerge.ts';
import type { ChatMessage } from '../../../frontend/components/chat/types/types.ts';

/**
 * Build a user chat row that mirrors a frontend optimistic/accepted send.
 */
function userMessage(content: string, timestamp: string, requestId?: string): ChatMessage {
  return {
    type: 'user',
    content,
    submittedContent: content,
    timestamp,
    provider: 'codex',
    clientRequestId: requestId,
    messageKey: requestId ? `optimistic:${requestId}` : undefined,
    deliveryStatus: requestId ? 'persisted' : 'persisted',
  };
}

/**
 * Build an assistant row from persisted Codex JSONL/read-model history.
 */
function persistedAssistant(content: string, timestamp: string, key: string): ChatMessage {
  return {
    type: 'assistant',
    content,
    timestamp,
    provider: 'codex',
    messageKey: key,
  };
}

/**
 * Build a live Codex assistant row that should stay visible until JSONL catches up.
 */
function liveAssistant(content: string, timestamp: string, key: string): ChatMessage {
  return {
    type: 'assistant',
    content,
    timestamp,
    provider: 'codex',
    source: 'codex-live',
    messageKey: key,
  };
}

/**
 * Return a compact representation of the user-visible transcript order.
 */
function visibleOrder(messages: ChatMessage[]): string[] {
  return messages.map((message) => `${message.type}:${message.content}`);
}

test('Codex refresh merge keeps follow-up user bubbles attached to their live replies', () => {
  /** Scenario: three Codex turns are visible locally while only turn 1 has
   * reached the persisted read model; reload must not group users 2 and 3 at
   * the bottom ahead of their assistant replies. */
  const persistedMessages: ChatMessage[] = [
    userMessage('第一轮需求', '2026-06-03T10:00:00.000Z'),
    persistedAssistant('第一轮 Codex 回复已经落盘', '2026-06-03T10:00:05.000Z', 'codex:c68:line:2'),
  ];

  const previousMessages: ChatMessage[] = [
    ...persistedMessages,
    userMessage('第二轮追加需求', '2026-06-03T10:01:00.000Z', 'chatreq-c68-2'),
    liveAssistant('第二轮 Codex 正在分析，期间产生了大量响应内容', '2026-06-03T10:01:10.000Z', 'codex-live:c68-2'),
    userMessage('第三轮追加需求', '2026-06-03T10:02:00.000Z', 'chatreq-c68-3'),
    liveAssistant('第三轮 Codex 正在继续处理最新请求', '2026-06-03T10:02:10.000Z', 'codex-live:c68-3'),
  ];

  const mergedMessages = mergePersistedAndOptimisticMessages(persistedMessages, previousMessages);

  assert.deepEqual(
    visibleOrder(mergedMessages),
    [
      'user:第一轮需求',
      'assistant:第一轮 Codex 回复已经落盘',
      'user:第二轮追加需求',
      'assistant:第二轮 Codex 正在分析，期间产生了大量响应内容',
      'user:第三轮追加需求',
      'assistant:第三轮 Codex 正在继续处理最新请求',
    ],
  );
});

test('Codex refresh merge dedupes caught-up turns without moving the remaining live turn', () => {
  /** Scenario: turn 2 has just reached JSONL while turn 3 remains live-only;
   * the persisted echo should replace the optimistic copy, and the remaining
   * live turn should keep its original position after turn 2. */
  const persistedMessages: ChatMessage[] = [
    userMessage('第一轮需求', '2026-06-03T10:00:00.000Z'),
    persistedAssistant('第一轮 Codex 回复已经落盘', '2026-06-03T10:00:05.000Z', 'codex:c68:line:2'),
    {
      ...userMessage('第二轮追加需求', '2026-06-03T10:01:01.000Z'),
      messageKey: 'codex:c68:line:3',
    },
    persistedAssistant('第二轮 Codex 正式落盘回复', '2026-06-03T10:01:30.000Z', 'codex:c68:line:4'),
  ];

  const previousMessages: ChatMessage[] = [
    userMessage('第一轮需求', '2026-06-03T10:00:00.000Z'),
    persistedAssistant('第一轮 Codex 回复已经落盘', '2026-06-03T10:00:05.000Z', 'codex:c68:line:2'),
    userMessage('第二轮追加需求', '2026-06-03T10:01:00.000Z', 'chatreq-c68-2'),
    liveAssistant('第二轮 Codex 正式落盘回复', '2026-06-03T10:01:20.000Z', 'codex-live:c68-2'),
    userMessage('第三轮追加需求', '2026-06-03T10:02:00.000Z', 'chatreq-c68-3'),
    liveAssistant('第三轮 Codex 正在继续处理最新请求', '2026-06-03T10:02:10.000Z', 'codex-live:c68-3'),
  ];

  const mergedMessages = mergePersistedAndOptimisticMessages(persistedMessages, previousMessages);

  assert.deepEqual(
    visibleOrder(mergedMessages),
    [
      'user:第一轮需求',
      'assistant:第一轮 Codex 回复已经落盘',
      'user:第二轮追加需求',
      'assistant:第二轮 Codex 正式落盘回复',
      'user:第三轮追加需求',
      'assistant:第三轮 Codex 正在继续处理最新请求',
    ],
  );

  assert.equal(
    mergedMessages.filter((message) => message.type === 'user' && message.content === '第二轮追加需求').length,
    1,
  );
  assert.equal(
    mergedMessages.filter((message) => message.type === 'assistant' && message.content === '第二轮 Codex 正式落盘回复').length,
    1,
  );
});

test('Codex follow-up user anchored to prior user is inserted after that prior turn', () => {
  /** Scenario: the next send can carry a turnAnchorKey that resolves to the
   * previous user row while the previous assistant reply is already present.
   * The new user must be inserted at the end of the previous turn, not between
   * the previous user and assistant.
   */
  const priorUser = {
    ...userMessage('上一轮用户消息', '2026-06-03T10:00:00.000Z'),
    messageKey: 'codex:c68:line:1',
  };
  const persistedMessages: ChatMessage[] = [
    priorUser,
    persistedAssistant('上一轮 Codex 回复', '2026-06-03T10:00:05.000Z', 'codex:c68:line:2'),
  ];

  const previousMessages: ChatMessage[] = [
    ...persistedMessages,
    {
      ...userMessage('这一轮新需求', '2026-06-03T10:01:00.000Z', 'chatreq-c68-2'),
      turnAnchorKey: 'message-user-codex:c68:line:1',
    },
    liveAssistant('这一轮 Codex 正在处理', '2026-06-03T10:01:10.000Z', 'codex-live:c68-2'),
  ];

  const mergedMessages = mergePersistedAndOptimisticMessages(persistedMessages, previousMessages);

  assert.deepEqual(
    visibleOrder(mergedMessages),
    [
      'user:上一轮用户消息',
      'assistant:上一轮 Codex 回复',
      'user:这一轮新需求',
      'assistant:这一轮 Codex 正在处理',
    ],
  );
});
