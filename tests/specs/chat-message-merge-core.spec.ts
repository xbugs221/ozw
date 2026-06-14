/**
 * Sources: 2026-06-11-96-建立聊天消息归并内核合同,
 * 2026-06-11-97-修复Codex-WS气泡顺序和归属,
 * 2026-06-11-98-稳定Codex流式和ToolCall渲染,
 * 2026-06-11-102-长会话消息增量瘦身,
 * 2026-06-14-111-聊天消息归并内核可测化
 *
 * PURPOSE: Verify the chat message merge core keeps persisted, live and
 * optimistic Codex messages attached to their original turns.
 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { chatMessageReducer } from '../../frontend/components/chat/state/chatMessageReducer.ts';
import type { ChatMessageAction } from '../../frontend/components/chat/state/chatMessageStateTypes.ts';
import type { ChatMessage } from '../../frontend/components/chat/types/types.ts';
import {
  mergePersistedAndOptimisticMessages,
  mergeSessionMessageDelta,
} from '../../frontend/components/chat/utils/sessionMessageMerge.ts';
import { mergeSessionMessagesByIdentityPreservingOrder } from '../../frontend/components/chat/utils/sessionMessageDedup.ts';

const REPO_ROOT = process.cwd();
const REQUIRED_REDUCER_MODULES = [
  'frontend/components/chat/state/chatMessageReducer.ts',
  'frontend/components/chat/state/chatRealtimeEvents.ts',
  'frontend/components/chat/state/chatMessageStateTypes.ts',
];

/**
 * Build a minimal chat message row that matches the real frontend shape.
 */
function row(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    type: 'assistant',
    content: '',
    timestamp: '2026-06-10T00:00:00.000Z',
    ...overrides,
  } as ChatMessage;
}

/**
 * Return visible text values in UI order for clear business assertions.
 */
function visibleTexts(messages: ChatMessage[]): string[] {
  return messages.map((message) => String(message.content || message.displayText || message.toolName || ''));
}

/**
 * Count exact visible messages after merge.
 */
function countText(messages: ChatMessage[], text: string): number {
  return visibleTexts(messages).filter((value) => value === text).length;
}

/**
 * Read a repository file for static reducer boundary checks.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('chat transcript merge rules stay behind the reducer boundary', async () => {
  const realtimeHookSource = await readRepoFile('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
  const realtimeHookImplSource = await readRepoFile('frontend/components/chat/hooks/useChatRealtimeHandlersImpl.ts');
  const sessionHookSource = await readRepoFile('frontend/components/chat/hooks/useChatSessionState.ts');
  const moduleSnapshots = [];

  for (const relativePath of REQUIRED_REDUCER_MODULES) {
    let exists = true;
    let source = '';
    try {
      await stat(path.join(REPO_ROOT, relativePath));
      source = await readRepoFile(relativePath);
    } catch {
      exists = false;
    }
    moduleSnapshots.push({
      path: relativePath,
      exists,
      lineCount: source ? source.split(/\r?\n/).length : 0,
      hasTypeSuppression: /@ts-nocheck|@ts-ignore|@ts-expect-error/.test(source),
      mentionsExistingMergeCore: /mergePersistedAndOptimisticMessages|mergeSessionMessageDelta/.test(source),
    });
  }

  const snapshot = {
    realtimeHookLineCount: realtimeHookSource.split(/\r?\n/).length,
    realtimeHookImplLineCount: realtimeHookImplSource.split(/\r?\n/).length,
    sessionHookLineCount: sessionHookSource.split(/\r?\n/).length,
    directSetChatMessagesCount: (realtimeHookImplSource.match(/\bsetChatMessages\s*\(/g) || []).length,
    genericApplyUpdaterActionCount: (realtimeHookImplSource.match(/\bapplyUpdater\b/g) || []).length,
    arbitraryTranscriptUpdaterCount: (realtimeHookImplSource.match(/updateChatMessages\s*\(\s*\([^)]*(?:previous|messages)[^)]*\)\s*=>/g) || []).length,
    inlineTranscriptMutationCount: (realtimeHookImplSource.match(/\bupdateChatMessages\s*\(\s*\([^)]*\)\s*=>\s*(?:\[|[^{]*\.(?:map|filter|concat)\s*\()/g) || []).length,
    modules: moduleSnapshots,
  };

  for (const module of moduleSnapshots) {
    assert.equal(module.exists, true, `${module.path} must exist`);
    assert.equal(module.hasTypeSuppression, false, `${module.path} must not use TypeScript suppression`);
  }

  const reducer = moduleSnapshots.find((module) => module.path.endsWith('chatMessageReducer.ts'));
  assert.equal(reducer?.mentionsExistingMergeCore, true, 'chatMessageReducer.ts must reuse the existing merge core');
  assert.ok(snapshot.realtimeHookLineCount < 20, `useChatRealtimeHandlers.ts must stay as a thin re-export, got ${snapshot.realtimeHookLineCount}`);
  assert.ok(snapshot.realtimeHookImplLineCount < 1500, `useChatRealtimeHandlersImpl.ts must not keep growing transcript merge rules, got ${snapshot.realtimeHookImplLineCount}`);
  assert.ok(snapshot.directSetChatMessagesCount <= 5, `direct setChatMessages branches must stay controlled, got ${snapshot.directSetChatMessagesCount}`);
  assert.equal(snapshot.genericApplyUpdaterActionCount, 0, 'hook must not pass arbitrary transcript updates through applyUpdater');
  assert.equal(snapshot.arbitraryTranscriptUpdaterCount, 0, 'hook must not pass arbitrary transcript updater closures');
  assert.equal(snapshot.inlineTranscriptMutationCount, 0, 'hook must not inline array/map transcript mutations in updateChatMessages');
  assert.ok(snapshot.sessionHookLineCount > 0, 'session hook source must be readable for persisted reload boundary checks');
});

test('chat message reducer actions produce stable transcript state', () => {
  const coveredActions = new Set<ChatMessageAction['type']>();
  let messages: ChatMessage[] = [
    row({ type: 'user', content: 'pending user', deliveryStatus: 'pending', clientRequestId: 'client-1' }),
  ];

  /**
   * Dispatch one reducer action and keep the current transcript for the next action.
   */
  const reduce = (action: ChatMessageAction): ChatMessage[] => {
    coveredActions.add(action.type);
    messages = chatMessageReducer({ messages }, action).messages;
    return messages;
  };

  reduce({ type: 'acceptedUserMessageSent', clientRequestId: 'client-1' });
  assert.equal(messages[0].deliveryStatus, 'sent');

  reduce({ type: 'userMessagesPersisted' });
  assert.equal(messages[0].deliveryStatus, 'persisted');

  reduce({ type: 'streamingChunkAppended', chunk: 'hello' });
  reduce({ type: 'streamingChunkAppended', chunk: ' world' });
  assert.equal(messages.at(-1)?.content, 'hello world');
  assert.equal(messages.at(-1)?.isStreaming, true);

  reduce({ type: 'streamingMessageFinalized' });
  assert.equal(messages.at(-1)?.isStreaming, false);

  reduce({
    type: 'assistantMessageAppended',
    persistUsers: true,
    message: row({ type: 'assistant', content: 'assistant reply', source: 'claude-realtime' }),
  });
  assert.equal(messages.at(-1)?.content, 'assistant reply');

  reduce({
    type: 'assistantMessageAppended',
    message: row({
      type: 'assistant',
      content: '',
      isToolUse: true,
      isSubagentContainer: true,
      toolId: 'parent-tool',
      toolName: 'Task',
      toolResult: null,
      subagentState: { childTools: [], currentToolIndex: -1, isComplete: false },
    }),
  });
  reduce({
    type: 'childToolUseAppended',
    parentToolUseId: 'parent-tool',
    childTool: {
      toolId: 'child-tool',
      toolName: 'Read',
      toolInput: { file: 'README.md' },
      toolResult: null,
      timestamp: new Date('2026-06-14T00:00:01.000Z'),
    },
  });
  const parentAfterChild = messages.find((item) => item.toolId === 'parent-tool');
  assert.equal(parentAfterChild?.subagentState?.childTools.length, 1);
  assert.equal(parentAfterChild?.subagentState?.currentToolIndex, 0);

  reduce({
    type: 'toolUseResultApplied',
    parentToolUseId: 'parent-tool',
    toolUseId: 'child-tool',
    toolResult: {
      content: 'child result',
      isError: false,
      timestamp: new Date('2026-06-14T00:00:02.000Z'),
    },
  });
  assert.equal(parentAfterChild?.subagentState?.childTools[0].toolResult, null, 'reducer must not mutate the previous parent object');
  const parentAfterChildResult = messages.find((item) => item.toolId === 'parent-tool');
  assert.equal(parentAfterChildResult?.subagentState?.childTools[0].toolResult?.content, 'child result');

  reduce({
    type: 'toolUseResultApplied',
    toolUseId: 'parent-tool',
    toolResult: {
      content: 'parent result',
      isError: false,
      timestamp: new Date('2026-06-14T00:00:03.000Z'),
    },
  });
  const completedParent = messages.find((item) => item.toolId === 'parent-tool');
  assert.equal(completedParent?.toolResult?.content, 'parent result');
  assert.equal(completedParent?.subagentState?.isComplete, true);

  reduce({ type: 'errorMessageAppended', content: 'plain error' });
  reduce({ type: 'uniqueErrorMessageAppended', content: 'deduped error' });
  reduce({ type: 'uniqueErrorMessageAppended', content: 'deduped error' });
  assert.equal(countText(messages, 'deduped error'), 1);

  messages = [
    ...messages,
    row({ type: 'user', content: 'rejected user', deliveryStatus: 'pending', clientRequestId: 'reject-1' }),
  ];
  reduce({ type: 'pendingUserMessageRejected', clientRequestId: 'reject-1', errorContent: 'reject reason' });
  assert.equal(messages.find((item) => item.clientRequestId === 'reject-1')?.deliveryStatus, 'failed');
  assert.equal(messages.at(-1)?.content, 'reject reason');

  reduce({
    type: 'persistedReloaded',
    persistedMessages: [
      row({ type: 'user', content: 'persisted user', clientRequestId: 'persisted-1', deliveryStatus: 'persisted', messageKey: 'persisted-u1' }),
      row({ type: 'assistant', content: 'persisted assistant', messageKey: 'persisted-a1' }),
    ],
    preservePreviousMessages: false,
    sessionId: 'boundary-action-session',
  });
  assert.deepEqual(visibleTexts(messages), ['persisted user', 'persisted assistant']);

  reduce({
    type: 'persistedDeltaAppended',
    sessionId: 'boundary-action-session',
    incomingRawMessages: [
      {
        type: 'assistant',
        timestamp: '2026-06-14T00:01:00.000Z',
        provider: 'codex',
        messageKey: 'delta-a1',
        message: { role: 'assistant', content: 'delta assistant' },
      },
    ],
  });
  assert.deepEqual(visibleTexts(messages), ['persisted user', 'persisted assistant', 'delta assistant']);

  reduce({
    type: 'liveRuntimeEventReceived',
    event: {
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'agent_message',
        itemId: 'live-agent-1',
        message: { role: 'assistant', content: 'live assistant' },
        status: 'completed',
      },
    },
  });
  assert.equal(messages.at(-1)?.content, 'live assistant');
  assert.equal(messages.at(-1)?.source, 'codex-live');

  const expectedActions: ChatMessageAction['type'][] = [
    'acceptedUserMessageSent',
    'userMessagesPersisted',
    'streamingChunkAppended',
    'streamingMessageFinalized',
    'assistantMessageAppended',
    'childToolUseAppended',
    'toolUseResultApplied',
    'errorMessageAppended',
    'uniqueErrorMessageAppended',
    'pendingUserMessageRejected',
    'persistedReloaded',
    'persistedDeltaAppended',
    'liveRuntimeEventReceived',
  ];
  assert.deepEqual([...coveredActions].sort(), [...expectedActions].sort());
  assert.deepEqual(visibleTexts(messages), ['persisted user', 'persisted assistant', 'delta assistant', 'live assistant']);
});

test('persisted user echo stays in its original turn instead of moving to the bottom', () => {
  const previous = [
    row({ type: 'user', content: 'turn 1 user', timestamp: '2026-06-10T10:00:00.000Z', clientRequestId: 'turn-1', deliveryStatus: 'persisted' }),
    row({ type: 'assistant', content: 'turn 1 assistant', timestamp: '2026-06-10T10:00:10.000Z', messageKey: 'a1' }),
    row({ type: 'user', content: 'turn 2 user', timestamp: '2026-06-10T10:01:00.000Z', clientRequestId: 'turn-2', deliveryStatus: 'persisted' }),
    row({ type: 'assistant', content: 'turn 2 live', timestamp: '2026-06-10T10:01:05.000Z', source: 'codex-live', messageKey: 'live-a2' }),
    row({ type: 'user', content: 'turn 3 user', timestamp: '2026-06-10T10:02:00.000Z', clientRequestId: 'turn-3', deliveryStatus: 'pending' }),
  ];
  const persistedOutOfOrder = [
    row({ type: 'assistant', content: 'turn 1 assistant', timestamp: '2026-06-10T10:00:10.000Z', messageKey: 'a1' }),
    row({ type: 'user', content: 'turn 2 user', timestamp: '2026-06-10T10:01:00.000Z', clientRequestId: 'turn-2', deliveryStatus: 'persisted', messageKey: 'u2' }),
    row({ type: 'assistant', content: 'turn 2 final', timestamp: '2026-06-10T10:01:15.000Z', messageKey: 'a2' }),
    row({ type: 'user', content: 'turn 1 user', timestamp: '2026-06-10T10:00:00.000Z', clientRequestId: 'turn-1', deliveryStatus: 'persisted', messageKey: 'u1' }),
  ];

  const merged = mergePersistedAndOptimisticMessages(persistedOutOfOrder, previous, { sessionId: 'spec-chat-merge' });

  assert.deepEqual(visibleTexts(merged).slice(0, 5), [
    'turn 1 user',
    'turn 1 assistant',
    'turn 2 user',
    'turn 2 final',
    'turn 3 user',
  ]);
  assert.equal(countText(merged, 'turn 1 user'), 1, 'first user bubble must not be duplicated at the bottom');
  assert.equal(countText(merged, 'turn 2 live'), 0, 'live assistant must be covered by persisted final answer');
});

test('delayed REST refresh cannot append an old user bubble after the latest Codex turn', () => {
  const previous = [
    row({ type: 'user', content: 'old user 1', clientRequestId: 'turn-1', deliveryStatus: 'persisted', timestamp: '2026-06-10T10:00:00.000Z' }),
    row({ type: 'assistant', content: 'old assistant 1', messageKey: 'a1', timestamp: '2026-06-10T10:00:10.000Z' }),
    row({ type: 'user', content: 'new user 2', clientRequestId: 'turn-2', deliveryStatus: 'sent', timestamp: '2026-06-10T10:01:00.000Z' }),
    row({ type: 'assistant', content: 'new live 2', source: 'codex-live', messageKey: 'live-a2', timestamp: '2026-06-10T10:01:05.000Z' }),
  ];
  const delayedPersisted = [
    row({ type: 'assistant', content: 'old assistant 1', messageKey: 'a1', timestamp: '2026-06-10T10:00:10.000Z' }),
    row({ type: 'user', content: 'new user 2', clientRequestId: 'turn-2', deliveryStatus: 'persisted', messageKey: 'u2', timestamp: '2026-06-10T10:01:00.000Z' }),
    row({ type: 'assistant', content: 'new final 2', messageKey: 'a2', timestamp: '2026-06-10T10:01:12.000Z' }),
    row({ type: 'user', content: 'old user 1', clientRequestId: 'turn-1', deliveryStatus: 'persisted', messageKey: 'u1', timestamp: '2026-06-10T10:00:00.000Z' }),
  ];

  const merged = mergePersistedAndOptimisticMessages(delayedPersisted, previous, { sessionId: 'spec-chat-merge-delayed-rest' });

  assert.deepEqual(visibleTexts(merged).slice(0, 4), ['old user 1', 'old assistant 1', 'new user 2', 'new final 2']);
  assert.equal(visibleTexts(merged).at(-1), 'new final 2', 'latest row must not be an old user bubble');
});

test('partial tail refresh anchors missing old user before its persisted assistant instead of bottom append', () => {
  const previous = [
    row({ type: 'user', content: 'old user outside tail', clientRequestId: 'turn-1', deliveryStatus: 'persisted', timestamp: '2026-06-10T10:00:00.000Z' }),
    row({ type: 'assistant', content: 'old assistant inside tail', messageKey: 'a1', timestamp: '2026-06-10T10:00:10.000Z' }),
    row({ type: 'user', content: 'new user 2', clientRequestId: 'turn-2', deliveryStatus: 'sent', timestamp: '2026-06-10T10:01:00.000Z' }),
    row({ type: 'assistant', content: 'new live 2', source: 'codex-live', messageKey: 'live-a2', timestamp: '2026-06-10T10:01:05.000Z' }),
  ];
  const partialTailPersisted = [
    row({ type: 'assistant', content: 'old assistant inside tail', messageKey: 'a1', timestamp: '2026-06-10T10:00:10.000Z' }),
    row({ type: 'user', content: 'new user 2', clientRequestId: 'turn-2', deliveryStatus: 'persisted', messageKey: 'u2', timestamp: '2026-06-10T10:01:00.000Z' }),
    row({ type: 'assistant', content: 'new final 2', messageKey: 'a2', timestamp: '2026-06-10T10:01:12.000Z' }),
  ];

  const merged = mergePersistedAndOptimisticMessages(partialTailPersisted, previous, { sessionId: 'spec-chat-merge-partial-tail' });

  assert.deepEqual(visibleTexts(merged), ['old user outside tail', 'old assistant inside tail', 'new user 2', 'new final 2']);
  assert.equal(visibleTexts(merged).at(-1), 'new final 2', 'partial tail reload must not append missing old users after the latest turn');
});

test('partial tail refresh drops unanchored persisted old user instead of bottom append', () => {
  const previous = [
    row({ type: 'user', content: 'old persisted user outside refreshed tail', clientRequestId: 'turn-1', deliveryStatus: 'persisted', timestamp: '2026-06-10T10:00:00.000Z' }),
    row({ type: 'assistant', content: 'old assistant outside refreshed tail', messageKey: 'a1', timestamp: '2026-06-10T10:00:10.000Z' }),
    row({ type: 'user', content: 'latest user', clientRequestId: 'turn-2', deliveryStatus: 'sent', timestamp: '2026-06-10T10:01:00.000Z' }),
    row({ type: 'assistant', content: 'latest live answer', source: 'codex-live', messageKey: 'live-a2', timestamp: '2026-06-10T10:01:05.000Z' }),
  ];
  const refreshedTail = [
    row({ type: 'user', content: 'latest user', clientRequestId: 'turn-2', deliveryStatus: 'persisted', messageKey: 'u2', timestamp: '2026-06-10T10:01:00.000Z' }),
    row({ type: 'assistant', content: 'latest final answer', messageKey: 'a2', timestamp: '2026-06-10T10:01:12.000Z' }),
  ];

  const merged = mergePersistedAndOptimisticMessages(refreshedTail, previous, { sessionId: 'spec-chat-merge-unanchored-persisted-user' });

  assert.deepEqual(visibleTexts(merged), ['latest user', 'latest final answer']);
  assert.equal(
    countText(merged, 'old persisted user outside refreshed tail'),
    0,
    'already-persisted historical user rows outside the refreshed window must not be appended after the latest answer',
  );
});

test('three Codex turns keep historical users in place while late duplicate live rows arrive', () => {
  const previous = [
    row({ type: 'user', content: 'turn 1 user', clientRequestId: 'turn-1', deliveryStatus: 'persisted', timestamp: '2026-06-10T10:00:00.000Z' }),
    row({ type: 'assistant', content: 'turn 1 final', messageKey: 'a1', timestamp: '2026-06-10T10:00:10.000Z' }),
    row({ type: 'user', content: 'turn 2 user', clientRequestId: 'turn-2', deliveryStatus: 'persisted', timestamp: '2026-06-10T10:01:00.000Z' }),
    row({ type: 'assistant', content: 'turn 2 final', messageKey: 'a2', timestamp: '2026-06-10T10:01:10.000Z' }),
    row({ type: 'user', content: 'turn 3 user', clientRequestId: 'turn-3', deliveryStatus: 'sent', timestamp: '2026-06-10T10:02:00.000Z' }),
    row({ type: 'assistant', content: 'turn 3 live', source: 'codex-live', messageKey: 'live-a3', timestamp: '2026-06-10T10:02:05.000Z' }),
    row({ type: 'assistant', content: 'turn 2 final', source: 'codex-live', messageKey: 'live-a2', timestamp: '2026-06-10T10:02:06.000Z' }),
  ];
  const delayedPersisted = [
    row({ type: 'assistant', content: 'turn 1 final', messageKey: 'a1', timestamp: '2026-06-10T10:00:10.000Z' }),
    row({ type: 'user', content: 'turn 2 user', clientRequestId: 'turn-2', deliveryStatus: 'persisted', messageKey: 'u2', timestamp: '2026-06-10T10:01:00.000Z' }),
    row({ type: 'assistant', content: 'turn 2 final', messageKey: 'a2', timestamp: '2026-06-10T10:01:10.000Z' }),
    row({ type: 'user', content: 'turn 3 user', clientRequestId: 'turn-3', deliveryStatus: 'persisted', messageKey: 'u3', timestamp: '2026-06-10T10:02:00.000Z' }),
    row({ type: 'user', content: 'turn 1 user', clientRequestId: 'turn-1', deliveryStatus: 'persisted', messageKey: 'u1', timestamp: '2026-06-10T10:00:00.000Z' }),
  ];

  const merged = mergePersistedAndOptimisticMessages(delayedPersisted, previous, { sessionId: 'spec-chat-merge-three-turns' });
  const texts = visibleTexts(merged);

  assert.deepEqual(texts, ['turn 1 user', 'turn 1 final', 'turn 2 user', 'turn 2 final', 'turn 3 user', 'turn 3 live']);
  assert.equal(countText(merged, 'turn 1 user'), 1);
  assert.equal(countText(merged, 'turn 2 final'), 1);
  assert.equal(texts.at(-1), 'turn 3 live', 'latest visible row must remain the active third turn');
});

test('duplicate persisted and optimistic rows keep one user bubble per client request', () => {
  const previous = [
    row({ type: 'user', content: 'same request', clientRequestId: 'same-client-request', deliveryStatus: 'sent', timestamp: '2026-06-10T11:00:00.000Z' }),
  ];
  const persisted = [
    row({ type: 'user', content: 'same request', clientRequestId: 'same-client-request', deliveryStatus: 'persisted', timestamp: '2026-06-10T11:00:00.000Z', messageKey: 'persisted-user' }),
  ];

  const merged = mergePersistedAndOptimisticMessages(persisted, previous, { sessionId: 'spec-chat-merge-duplicate' });

  assert.equal(countText(merged, 'same request'), 1);
  assert.equal(merged[0].deliveryStatus, 'persisted');
});

test('empty persisted assistant replay cannot erase a non-empty Codex live draft', () => {
  const liveDraft = 'The response is still streaming and must not be erased.';
  const previous = [
    row({ type: 'user', content: 'explain stream stability', clientRequestId: 'turn-98', deliveryStatus: 'sent', timestamp: '2026-06-10T12:00:00.000Z' }),
    row({ type: 'assistant', content: liveDraft, source: 'codex-live', messageKey: 'codex:assistant-turn-98', timestamp: '2026-06-10T12:00:05.000Z' }),
  ];
  const stalePersistedRefresh = [
    row({ type: 'user', content: 'explain stream stability', clientRequestId: 'turn-98', deliveryStatus: 'persisted', messageKey: 'user-turn-98', timestamp: '2026-06-10T12:00:00.000Z' }),
    row({ type: 'assistant', content: '', messageKey: 'empty-assistant-turn-98', timestamp: '2026-06-10T12:00:01.000Z' }),
  ];

  const merged = mergePersistedAndOptimisticMessages(stalePersistedRefresh, previous, { sessionId: 'change-98-empty-replay' });

  assert.deepEqual(
    visibleTexts(merged),
    ['explain stream stability', liveDraft],
    'empty persisted assistant rows represent read-model lag and must not replace non-empty live draft text',
  );

  const finalPersistedRefresh = [
    row({ type: 'user', content: 'explain stream stability', clientRequestId: 'turn-98', deliveryStatus: 'persisted', messageKey: 'user-turn-98', timestamp: '2026-06-10T12:00:00.000Z' }),
    row({ type: 'assistant', content: 'The response is final and stable.', messageKey: 'final-assistant-turn-98', timestamp: '2026-06-10T12:00:08.000Z' }),
  ];
  const finalMerged = mergePersistedAndOptimisticMessages(finalPersistedRefresh, previous, { sessionId: 'change-98-final-replay' });

  assert.deepEqual(
    visibleTexts(finalMerged),
    ['explain stream stability', 'The response is final and stable.'],
    'non-empty persisted final should replace the live draft exactly once',
  );
});

test('equal-timestamp persisted turns keep user and assistant grouped by turn anchor', () => {
  const persisted = [
    row({ type: 'user', content: 'turn 1 user', timestamp: '2026-06-10T12:00:00.000Z', turnAnchorKey: 'turn-1', messageKey: 'u1' }),
    row({ type: 'user', content: 'turn 2 user', timestamp: '2026-06-10T12:00:00.000Z', turnAnchorKey: 'turn-2', messageKey: 'u2' }),
    row({ type: 'assistant', content: 'turn 1 assistant', timestamp: '2026-06-10T12:00:00.000Z', turnAnchorKey: 'turn-1', messageKey: 'a1' }),
    row({ type: 'assistant', content: 'turn 2 assistant', timestamp: '2026-06-10T12:00:00.000Z', turnAnchorKey: 'turn-2', messageKey: 'a2' }),
  ];

  const merged = mergePersistedAndOptimisticMessages(persisted, [], { sessionId: 'spec-chat-merge-equal-timestamps' });

  assert.deepEqual(visibleTexts(merged), [
    'turn 1 user',
    'turn 1 assistant',
    'turn 2 user',
    'turn 2 assistant',
  ]);
});

test('equal-timestamp persisted assistants without turn anchors stay with user turns', () => {
  const persisted = [
    row({ type: 'user', content: 'turn 1 user', timestamp: '2026-06-10T13:00:00.000Z', clientRequestId: 'turn-1', messageKey: 'u1' }),
    row({ type: 'user', content: 'turn 2 user', timestamp: '2026-06-10T13:00:00.000Z', clientRequestId: 'turn-2', messageKey: 'u2' }),
    row({ type: 'assistant', content: 'turn 1 assistant', timestamp: '2026-06-10T13:00:00.000Z', messageKey: 'a1' }),
    row({ type: 'assistant', content: 'turn 2 assistant', timestamp: '2026-06-10T13:00:00.000Z', messageKey: 'a2' }),
  ];

  const merged = mergePersistedAndOptimisticMessages(persisted, [], { sessionId: 'spec-chat-merge-real-assistant-shape' });

  assert.deepEqual(visibleTexts(merged), [
    'turn 1 user',
    'turn 1 assistant',
    'turn 2 user',
    'turn 2 assistant',
  ]);
});

test('out-of-order persisted assistant rows use provider line order before turn inference', () => {
  const persisted = [
    row({ type: 'assistant', content: 'turn 2 assistant', timestamp: '2026-06-10T14:00:00.000Z', messageKey: 'codex:session:line:4:msg:0' }),
    row({ type: 'user', content: 'turn 1 user', timestamp: '2026-06-10T14:00:00.000Z', clientRequestId: 'turn-1', messageKey: 'codex:session:line:1:msg:0' }),
    row({ type: 'assistant', content: 'turn 1 assistant', timestamp: '2026-06-10T14:00:00.000Z', messageKey: 'codex:session:line:2:msg:0' }),
    row({ type: 'user', content: 'turn 2 user', timestamp: '2026-06-10T14:00:00.000Z', clientRequestId: 'turn-2', messageKey: 'codex:session:line:3:msg:0' }),
  ];

  const merged = mergePersistedAndOptimisticMessages(persisted, [], { sessionId: 'spec-chat-merge-real-out-of-order' });

  assert.deepEqual(visibleTexts(merged), [
    'turn 1 user',
    'turn 1 assistant',
    'turn 2 user',
    'turn 2 assistant',
  ]);
});

test('long-session delta append keeps existing UI rows stable and appends new raw messages once', () => {
  const existingMessages = Array.from({ length: 80 }, (_, index) => row({
    type: index % 2 === 0 ? 'user' : 'assistant',
    content: `已有 UI 消息 ${index}`,
    timestamp: `2026-06-11T05:${String(index % 60).padStart(2, '0')}:00.000Z`,
    provider: 'codex',
    messageKey: `stable-${index}`,
    deliveryStatus: 'persisted',
  }));
  const incomingRawMessages = [
    {
      type: 'message',
      timestamp: '2026-06-11T06:00:00.000Z',
      provider: 'codex',
      messageKey: 'delta-user-1',
      message: { role: 'user', content: '新增前端 delta 用户消息' },
    },
    {
      type: 'assistant',
      timestamp: '2026-06-11T06:00:01.000Z',
      provider: 'codex',
      messageKey: 'delta-assistant-1',
      message: { role: 'assistant', content: '新增前端 delta 助手消息' },
    },
    {
      type: 'assistant',
      timestamp: '2026-06-11T06:00:01.000Z',
      provider: 'codex',
      messageKey: 'delta-assistant-1',
      message: { role: 'assistant', content: '重复到达的助手消息' },
    },
  ];

  const nextMessages = mergeSessionMessageDelta({
    existingMessages,
    incomingRawMessages,
    sessionId: 'spec-chat-merge-delta-append',
  });

  assert.equal(nextMessages.length, existingMessages.length + 2);
  assert.equal(nextMessages[0], existingMessages[0], 'existing first UI row reference must stay stable');
  assert.equal(
    nextMessages[existingMessages.length - 1],
    existingMessages[existingMessages.length - 1],
    'existing last UI row reference must stay stable',
  );
  assert.deepEqual(nextMessages.slice(-2).map((message) => message.messageKey), [
    'delta-user-1',
    'delta-assistant-1',
  ]);
  assert.equal(countText(nextMessages, '重复到达的助手消息'), 0, 'duplicate raw messageKey must not append twice');
});

test('persisted delta user echo replaces accepted follow-up bubble instead of duplicating it', () => {
  const existingMessages = [
    row({
      type: 'user',
      content: '追加消息去重',
      submittedContent: '追加消息去重',
      timestamp: '2026-06-12T06:10:00.000Z',
      provider: 'codex',
      messageKey: 'optimistic:client-followup-1',
      clientRequestId: 'client-followup-1',
      deliveryStatus: 'sent',
    }),
    row({
      type: 'assistant',
      content: '追加消息的实时回复',
      timestamp: '2026-06-12T06:10:01.000Z',
      provider: 'codex',
      source: 'codex-live',
      messageKey: 'live-followup-assistant-1',
    }),
  ];
  const incomingRawMessages = [
    {
      type: 'message',
      timestamp: '2026-06-12T06:10:02.000Z',
      provider: 'codex',
      messageKey: 'persisted-followup-user-1',
      message: { role: 'user', content: '追加消息去重' },
    },
  ];

  const nextMessages = mergeSessionMessageDelta({
    existingMessages,
    incomingRawMessages,
    sessionId: 'spec-chat-merge-delta-followup-user',
  });

  assert.equal(countText(nextMessages, '追加消息去重'), 1, 'accepted and persisted user bubbles must converge to one visible row');
  assert.equal(nextMessages.length, 2);
  assert.equal(nextMessages[0].deliveryStatus, 'persisted');
  assert.equal(nextMessages[0].messageKey, 'persisted-followup-user-1');
  assert.equal(nextMessages[0].clientRequestId, 'client-followup-1');
  assert.deepEqual(visibleTexts(nextMessages), ['追加消息去重', '追加消息的实时回复']);
});

test('cursor delta replacement keeps updated rows in their original transcript position', () => {
  const existingMessages = [
    row({
      type: 'user',
      content: '第一轮用户',
      timestamp: '2026-06-12T07:00:00.000Z',
      provider: 'codex',
      messageKey: 'turn-1-user',
      deliveryStatus: 'persisted',
    }),
    row({
      type: 'assistant',
      content: '第一轮旧的局部回复',
      timestamp: '2026-06-12T07:00:01.000Z',
      provider: 'codex',
      messageKey: 'turn-1-assistant',
    }),
    row({
      type: 'user',
      content: '第二轮用户',
      timestamp: '2026-06-12T07:01:00.000Z',
      provider: 'codex',
      messageKey: 'turn-2-user',
      deliveryStatus: 'persisted',
    }),
    row({
      type: 'assistant',
      content: '第二轮回复',
      timestamp: '2026-06-12T07:01:01.000Z',
      provider: 'codex',
      messageKey: 'turn-2-assistant',
    }),
  ];
  const incomingRawMessages = [
    {
      type: 'message',
      timestamp: '2026-06-12T07:00:01.000Z',
      provider: 'codex',
      messageKey: 'turn-1-assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '第一轮更新后的完整回复', messageKey: 'turn-1-assistant' }] },
    },
  ];

  const nextMessages = mergeSessionMessageDelta({
    existingMessages,
    incomingRawMessages,
    sessionId: 'spec-chat-merge-cursor-replacement-position',
  });

  assert.deepEqual(visibleTexts(nextMessages), [
    '第一轮用户',
    '第一轮更新后的完整回复',
    '第二轮用户',
    '第二轮回复',
  ]);
  assert.equal(countText(nextMessages, '第一轮旧的局部回复'), 0);
});

test('raw cursor session refresh replaces existing identity without moving it to the bottom', () => {
  const existingRows = [
    { messageKey: 'raw-u1', type: 'message', message: { role: 'user', content: '第一轮用户' } },
    { messageKey: 'raw-a1', type: 'assistant', message: { role: 'assistant', content: '第一轮旧回复' } },
    { messageKey: 'raw-u2', type: 'message', message: { role: 'user', content: '第二轮用户' } },
    { messageKey: 'raw-a2', type: 'assistant', message: { role: 'assistant', content: '第二轮回复' } },
  ];
  const incomingRows = [
    { messageKey: 'raw-a1', type: 'assistant', message: { role: 'assistant', content: '第一轮完整回复' } },
    { messageKey: 'raw-a3', type: 'assistant', message: { role: 'assistant', content: '第三轮回复' } },
  ];

  const mergedRows = mergeSessionMessagesByIdentityPreservingOrder(existingRows, incomingRows);

  assert.deepEqual(
    mergedRows.map((message) => message.messageKey),
    ['raw-u1', 'raw-a1', 'raw-u2', 'raw-a2', 'raw-a3'],
  );
  assert.equal((mergedRows[1].message as Record<string, string>).content, '第一轮完整回复');
});

test('session message delta replaces covered live assistant instead of duplicating dynamic push', () => {
  const existingMessages = [
    row({
      type: 'user',
      content: '解释动态推送去重',
      timestamp: '2026-06-12T06:00:00.000Z',
      provider: 'codex',
      messageKey: 'delta-live-user',
      clientRequestId: 'delta-live-request',
      deliveryStatus: 'persisted',
    }),
    row({
      type: 'assistant',
      content: '动态推送中的 assistant 最终内容',
      timestamp: '2026-06-12T06:00:01.000Z',
      provider: 'codex',
      source: 'codex-live',
      messageKey: 'codex:live-delta-assistant',
    }),
  ];
  const incomingRawMessages = [
    {
      type: 'assistant',
      timestamp: '2026-06-12T06:00:02.000Z',
      provider: 'codex',
      messageKey: 'codex:persisted-delta-assistant',
      message: { role: 'assistant', content: '动态推送中的 assistant 最终内容' },
    },
  ];

  const nextMessages = mergeSessionMessageDelta({
    existingMessages,
    incomingRawMessages,
    sessionId: 'spec-chat-merge-delta-live-duplicate',
  });

  assert.equal(countText(nextMessages, '动态推送中的 assistant 最终内容'), 1, 'live push and persisted delta must converge to one assistant bubble');
  assert.equal(
    nextMessages.some((message) => message.source === 'codex-live' && message.content === '动态推送中的 assistant 最终内容'),
    false,
    'covered live assistant must be removed once persisted delta arrives',
  );
  assert.equal(
    nextMessages.some((message) => message.messageKey === 'codex:persisted-delta-assistant'),
    true,
    'persisted assistant row should become the visible authoritative message',
  );
});
