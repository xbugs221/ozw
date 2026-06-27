/**
 * Sources: 2026-06-11-96-建立聊天消息归并内核合同,
 * 2026-06-11-97-修复Codex-WS气泡顺序和归属,
 * 2026-06-11-98-稳定Codex流式和ToolCall渲染,
 * 2026-06-11-102-长会话消息增量瘦身,
 * 2026-06-14-111-聊天消息归并内核可测化,
 * 2026-06-16-6-聊天Live渲染与工具卡片体系化
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
import { convertSessionMessages } from '../../frontend/components/chat/utils/messageTransforms.ts';
import { mergeSessionMessagesByIdentityPreservingOrder } from '../../frontend/components/chat/utils/sessionMessageDedup.ts';
import { getIntrinsicMessageKey } from '../../frontend/components/chat/utils/messageKeys.ts';
import { shouldDeferFollowLatestRefresh } from '../../frontend/components/chat/utils/liveTurnMergePolicy.ts';
import {
  getMaxSessionMessageRawLineCursor,
  getSessionMessageRawLineCursor,
  resolveSessionMessageRawLineCursor,
} from '../../frontend/components/chat/session/sessionMessageLoader.ts';
import { getSessionViewIdentityKey } from '../../frontend/components/chat/session/sessionIdentity.ts';
import { normalizeCodexFunctionCall } from '../../shared/codex-message-normalizer.ts';
import { reduceNativeRuntimeEvent } from '../../frontend/components/chat/utils/nativeRuntimeTranscript.ts';

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
  assert.equal(messages[0].deliveryStatus, 'persisted');

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

test('accepted Codex live turn renders before JSONL history catches up', () => {
  /**
   * Business case: Codex app-server accepts a manual prompt and starts streaming
   * before ~/.codex/sessions JSONL exposes the user echo. The user bubble must
   * already be green and the live assistant text must stay visible through an
   * empty persisted reload.
   */
  const clientRequestId = 'codex-live-before-jsonl';
  let messages: ChatMessage[] = [
    row({
      type: 'user',
      content: 'explain why live status matters',
      deliveryStatus: 'pending',
      clientRequestId,
      messageKey: `optimistic:${clientRequestId}`,
    }),
  ];

  messages = chatMessageReducer(
    { messages },
    { type: 'acceptedUserMessageSent', clientRequestId },
  ).messages;
  assert.equal(messages[0].deliveryStatus, 'persisted', 'accepted user bubble must be green before JSONL echo');

  messages = chatMessageReducer(
    { messages },
    {
      type: 'liveRuntimeEventReceived',
      event: {
        type: 'codex-response',
        data: {
          type: 'item',
          itemType: 'agent_message',
          itemId: 'codex-live-before-jsonl-agent',
          message: { role: 'assistant', content: 'live answer before persisted history' },
          status: 'completed',
        },
      },
    },
  ).messages;
  assert.deepEqual(visibleTexts(messages), ['explain why live status matters', 'live answer before persisted history']);

  messages = chatMessageReducer(
    { messages },
    {
      type: 'persistedReloaded',
      persistedMessages: [],
      preservePreviousMessages: true,
      sessionId: 'codex-live-before-jsonl-session',
    },
  ).messages;
  assert.deepEqual(
    visibleTexts(messages),
    ['explain why live status matters', 'live answer before persisted history'],
    'empty JSONL refresh must not hide accepted live output',
  );
});

test('Codex live assistant with different item ids updates one in-flight bubble', () => {
  /**
   * Business case: during a running response, providers can replay the same
   * assistant text under a final item id after an in-progress item id. The UI
   * must update the in-flight bubble instead of rendering the response twice.
   */
  let messages: ChatMessage[] = [
    row({
      type: 'user',
      content: '解释响应中重复渲染',
      deliveryStatus: 'persisted',
      clientRequestId: 'live-duplicate-turn',
      messageKey: 'user-live-duplicate-turn',
    }),
  ];

  messages = chatMessageReducer(
    { messages },
    {
      type: 'liveRuntimeEventReceived',
      event: {
        type: 'codex-response',
        data: {
          type: 'item',
          itemType: 'agent_message',
          itemId: 'streaming-agent-item',
          status: 'in_progress',
          delta: { text: '响应过程中不应该重复显示。' },
          message: { role: 'assistant' },
        },
      },
    },
  ).messages;

  messages = chatMessageReducer(
    { messages },
    {
      type: 'liveRuntimeEventReceived',
      event: {
        type: 'codex-response',
        data: {
          type: 'item',
          itemType: 'agent_message',
          itemId: 'completed-agent-item',
          status: 'completed',
          message: { role: 'assistant', content: '响应过程中不应该重复显示。' },
        },
      },
    },
  ).messages;

  assert.equal(countText(messages, '响应过程中不应该重复显示。'), 1);
});

test('Pi live subagent result and delayed input render as one tool card', () => {
  /**
   * Business case: Pi can send a tool result and later echo the matching tool
   * input through WS with a different transport item id. The UI must merge both
   * fragments into one subagent card before a page refresh replays JSONL.
   */
  let messages: ChatMessage[] = [
    row({
      type: 'user',
      content: '用 subagent 检查 live 工具卡合并',
      deliveryStatus: 'persisted',
      clientRequestId: 'pi-subagent-live-merge',
      messageKey: 'user-pi-subagent-live-merge',
    }),
  ];

  messages = reduceNativeRuntimeEvent(messages, {
    type: 'pi-response',
    data: {
      type: 'item',
      itemType: 'tool_result',
      itemId: 'pi-result-envelope',
      tool_call_id: 'pi-subagent-call-1',
      tool: 'subagent',
      result: 'review completed',
      status: 'completed',
    },
  }) as ChatMessage[];

  messages = reduceNativeRuntimeEvent(messages, {
    type: 'pi-response',
    data: {
      type: 'item',
      itemType: 'tool_call',
      itemId: 'pi-input-envelope',
      call_id: 'pi-subagent-call-1',
      tool: 'subagent',
      arguments: {
        agent: 'reviewer',
        task: 'check websocket merge',
      },
      status: 'running',
    },
  }) as ChatMessage[];

  const toolCards = messages.filter((message) => message.isToolUse);
  assert.equal(toolCards.length, 1, 'live input/result fragments must not create duplicate tool cards');
  assert.equal(toolCards[0].isSubagentContainer, true);
  assert.equal(toolCards[0].subagentState?.isComplete, true);
  assert.equal(toolCards[0].status, 'completed');
  assert.match(String(toolCards[0].toolInput), /reviewer/);
  assert.equal(toolCards[0].toolResult?.content, 'review completed');
});

test('persisted Pi subagent tool_use becomes a subagent container', () => {
  /**
   * Business case: after refresh, Pi `subagent` tool calls should render through
   * the same dedicated container as legacy Task/Agent calls.
   */
  const converted = convertSessionMessages([
    {
      type: 'message',
      provider: 'pi',
      timestamp: '2026-06-20T10:00:00.000Z',
      messageKey: 'pi-subagent-message',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'pi-subagent-call-2',
            name: 'subagent',
            input: {
              agent: 'reviewer',
              task: 'inspect persisted subagent rendering',
            },
          },
        ],
      },
    },
  ]);

  assert.equal(converted.length, 1);
  assert.equal(converted[0].isToolUse, true);
  assert.equal(converted[0].isSubagentContainer, true);
  assert.match(String(converted[0].toolInput), /persisted subagent/);
});

test('session view identity changes for same id across provider and route aliases', () => {
  /**
   * Business case: new-session navigation must clear visible messages when the
   * URL/view changes, even if a provider id or cN alias shape is reused.
   */
  const project = {
    name: 'ozw',
    fullPath: '/home/zzl/projects/ozw',
    path: '/home/zzl/projects/ozw',
  } as any;

  const codexC1 = {
    id: 'c1',
    routeIndex: 1,
    __provider: 'codex',
    createdAt: '2026-06-20T10:00:00.000Z',
  } as any;
  const piC1 = {
    ...codexC1,
    __provider: 'pi',
  } as any;
  const codexC2 = {
    ...codexC1,
    id: 'c2',
    routeIndex: 2,
  } as any;

  assert.notEqual(
    getSessionViewIdentityKey(project, codexC1),
    getSessionViewIdentityKey(project, piC1),
  );
  assert.notEqual(
    getSessionViewIdentityKey(project, codexC1),
    getSessionViewIdentityKey(project, codexC2),
  );
  assert.equal(
    getSessionViewIdentityKey(project, codexC1),
    getSessionViewIdentityKey(project, { ...codexC1 }),
  );
});

test('follow latest tail refresh does not append short persisted partial beside live assistant', () => {
  /**
   * Clicking the follow-latest button refreshes the JSONL tail while the same
   * provider turn may still be streaming over WS. A short persisted partial
   * must not create a second dynamic assistant bubble next to the live one.
   */
  const messages = [
    row({
      type: 'user',
      content: '点击跟随后动态响应不要重复',
      deliveryStatus: 'persisted',
      clientRequestId: 'follow-live-dup',
      messageKey: 'optimistic:follow-live-dup',
      timestamp: '2026-06-18T20:15:00.000Z',
    }),
    row({
      type: 'assistant',
      content: '动态响应正在持续输出，用户刚刚点了跟随按钮。',
      source: 'codex-live',
      clientRequestId: 'follow-live-dup',
      messageKey: 'codex:live-follow-stream',
      timestamp: '2026-06-18T20:15:01.000Z',
    }),
  ];

  const merged = mergeSessionMessageDelta({
    existingMessages: messages,
    incomingRawMessages: [
      {
        type: 'message',
        provider: 'codex',
        clientRequestId: 'follow-live-dup',
        messageKey: 'codex:line:42:msg:0',
        timestamp: '2026-06-18T20:15:02.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: '动态响应',
            },
          ],
        },
      },
    ],
    sessionId: 'follow-live-dup-session',
  });

  assert.deepEqual(
    visibleTexts(merged),
    ['点击跟随后动态响应不要重复', '动态响应正在持续输出，用户刚刚点了跟随按钮。'],
  );
  assert.equal(merged.filter((message) => message.type === 'assistant' && !message.isToolUse).length, 1);
});

test('follow latest does not request JSONL refresh while native live turn owns the visible tail', () => {
  /**
   * Business case: clicking follow-latest during a running native provider
   * response should only move the viewport. The active WS live bubble remains
   * the current-turn source until completion or reconnect/external refresh.
   */
  const liveMessages = [
    row({
      type: 'assistant',
      content: '正在通过 WS live 输出',
      source: 'codex-live',
      messageKey: 'codex:live-follow-owner',
    }),
  ];

  assert.equal(
    shouldDeferFollowLatestRefresh({
      messages: liveMessages,
      isRealtimeConnected: true,
      isTurnRunning: true,
    }),
    true,
  );
  assert.equal(
    shouldDeferFollowLatestRefresh({
      messages: liveMessages,
      isRealtimeConnected: false,
      isTurnRunning: true,
    }),
    false,
  );
  assert.equal(
    shouldDeferFollowLatestRefresh({
      messages: liveMessages,
      isRealtimeConnected: true,
      isTurnRunning: false,
    }),
    false,
  );
});

test('follow latest tail refresh dedupes live assistant when persisted text only adds markdown code marks', () => {
  /**
   * Real Codex app-server streams may first send plain live text, then replay
   * the same assistant row from JSONL with inline-code markdown. The transcript
   * should converge to one assistant bubble instead of rendering both sources.
   */
  const liveText = '我看到这条 FOLLOW_DUP_REAL_TEST_20260618... 已经作为用户消息发出来了，刚才点击命令被中断。';
  const persistedText = '我看到这条 `FOLLOW_DUP_REAL_TEST_20260618...` 已经作为用户消息发出来了，刚才点击命令被中断。';
  const merged = mergeSessionMessageDelta({
    existingMessages: [
      row({
        type: 'user',
        content: 'FOLLOW_DUP_REAL_TEST_20260618 请只回复一句中文',
        deliveryStatus: 'persisted',
        messageKey: 'optimistic:follow-markdown-dedupe',
      }),
      row({
        type: 'assistant',
        content: liveText,
        source: 'codex-live',
        messageKey: 'codex:msg_live_markdown_dedupe',
      }),
    ],
    incomingRawMessages: [
      {
        type: 'message',
        provider: 'codex',
        messageKey: 'codex:session:line:1181:msg:0',
        timestamp: '2026-06-18T20:20:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: persistedText }],
        },
      },
    ],
    sessionId: 'follow-markdown-dedupe-session',
  });

  assert.equal(merged.filter((message) => message.type === 'assistant' && !message.isToolUse).length, 1);
  assert.deepEqual(visibleTexts(merged), [
    'FOLLOW_DUP_REAL_TEST_20260618 请只回复一句中文',
    persistedText,
  ]);
});

test('persisted reload dedupes live overlay and JSONL assistant rows in the same turn', () => {
  /**
   * After refresh, a previously live Codex row can be loaded together with the
   * authoritative JSONL line for the same assistant text. The persisted
   * transcript should keep the JSONL row only.
   */
  const liveText = '我看到这条 FOLLOW_DUP_REAL_TEST_20260618... 已经作为用户消息发出来了，刚才点击命令被中断。';
  const persistedText = '我看到这条 `FOLLOW_DUP_REAL_TEST_20260618...` 已经作为用户消息发出来了，刚才点击命令被中断。';
  const merged = mergePersistedAndOptimisticMessages([
    row({
      type: 'user',
      content: 'FOLLOW_DUP_REAL_TEST_20260618 请只回复一句中文',
      deliveryStatus: 'persisted',
      messageKey: 'codex:session:line:1180:msg:0',
    }),
    row({
      type: 'assistant',
      content: liveText,
      messageKey: 'codex:msg_0cc31214e5e98958016a33e2760c108191ad7285c9f161c31a',
    }),
    row({
      type: 'assistant',
      content: persistedText,
      messageKey: 'codex:session:line:1181:msg:0',
    }),
  ], [], { sessionId: 'persisted-live-overlay-dedupe' });

  assert.equal(merged.filter((message) => message.type === 'assistant' && !message.isToolUse).length, 1);
  assert.deepEqual(visibleTexts(merged), [
    'FOLLOW_DUP_REAL_TEST_20260618 请只回复一句中文',
    persistedText,
  ]);
});

test('assistant rows from one live turn do not share react row identity', () => {
  /**
   * A single provider turn can render multiple assistant rows with the same
   * clientRequestId while streaming. React row identity must use row/tool
   * fields instead of the shared request id.
   */
  const firstAssistant = row({
    type: 'assistant',
    content: '第一段动态响应',
    clientRequestId: 'chatreq-same-turn',
    messageKey: 'codex:live:first',
  });
  const secondAssistant = row({
    type: 'assistant',
    content: '第二段动态响应',
    clientRequestId: 'chatreq-same-turn',
    messageKey: 'codex:live:second',
  });

  assert.notEqual(
    getIntrinsicMessageKey(firstAssistant),
    getIntrinsicMessageKey(secondAssistant),
  );
});

test('persisted upload note restores user attachment marker after refresh', () => {
  /**
   * Business case: provider history stores uploaded files as a hidden prompt
   * note. Refresh must keep the user-visible attachment marker so users can see
   * what the agent received.
   */
  const converted = convertSessionMessages([
    {
      type: 'message',
      provider: 'codex',
      timestamp: '2026-06-10T12:30:00.000Z',
      messageKey: 'persisted-upload-user',
      message: {
        role: 'user',
        content: [
          '请读取附件',
          '',
          '[User uploaded files for this message]',
          'The files were saved to local paths below. Inspect them directly and decide how to parse them.',
          '1. docs/upload.txt -> /home/zzl/ozw-uploads/u1/b1/docs/upload.txt (text/plain, 42 bytes)',
        ].join('\n'),
      },
    },
  ]);

  assert.equal(converted.length, 1);
  assert.equal(converted[0].content, '请读取附件');
  assert.equal(converted[0].attachments?.[0]?.relativePath, 'docs/upload.txt');
  assert.equal(converted[0].attachments?.[0]?.absolutePath, '/home/zzl/ozw-uploads/u1/b1/docs/upload.txt');
});

test('convertSessionMessages hides provider bootstrap content before first user prompt', () => {
  /**
   * Business case: Codex can replay AGENTS.md and environment bootstrap rows as
   * user content. The chat surface must show only the text the user authored.
   */
  const agentsBootstrap = [
    '# AGENTS.md instructions',
    '',
    '<INSTRUCTIONS>',
    '# KISS',
    '- 使用rtk前缀执行shell命令',
    '</INSTRUCTIONS>',
  ].join('\n');
  const environmentContext = [
    '<environment_context>',
    '<cwd>/home/zzl/projects/ozw</cwd>',
    '<timezone>Asia/Makassar</timezone>',
    '</environment_context>',
  ].join('\n');
  const userPrompt = '修复前端两个问题';

  const converted = convertSessionMessages([
    {
      type: 'message',
      provider: 'codex',
      timestamp: '2026-06-22T12:30:00.000Z',
      messageKey: 'codex-bootstrap-user-row',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: agentsBootstrap },
          { type: 'text', text: environmentContext },
          { type: 'text', text: userPrompt },
        ],
      },
    },
  ]);

  assert.equal(converted.length, 1);
  assert.equal(converted[0].content, userPrompt);
  assert.equal(visibleTexts(converted).join('\n').includes('AGENTS.md instructions'), false);
  assert.equal(visibleTexts(converted).join('\n').includes('<environment_context>'), false);
});

test('accepted Pi live turn renders before JSONL history catches up', () => {
  /**
   * Business case: Pi streams assistant text before its persisted session file
   * has replayed the turn. The accepted local user row and Pi live row must
   * remain visible through an empty reload.
   */
  const messages = mergePersistedAndOptimisticMessages(
    [],
    [
      row({
        type: 'user',
        content: 'explain pi live status',
        deliveryStatus: 'persisted',
        clientRequestId: 'pi-live-before-jsonl',
        messageKey: 'optimistic:pi-live-before-jsonl',
      }),
      row({
        type: 'assistant',
        content: 'pi live answer before persisted history',
        source: 'pi-live',
        messageKey: 'pi-live-before-jsonl-agent',
      }),
    ],
    { preservePreviousMessages: true, sessionId: 'pi-live-before-jsonl-session' },
  );

  assert.deepEqual(
    visibleTexts(messages),
    ['explain pi live status', 'pi live answer before persisted history'],
    'empty JSONL refresh must not hide accepted Pi live output',
  );
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

test('final-only persisted Pi refresh preserves live thinking and tool rows', () => {
  const previous = [
    row({
      type: 'user',
      content: 'inspect pi live ws render',
      clientRequestId: 'pi-live-turn',
      deliveryStatus: 'sent',
      turnAnchorKey: 'pi-live-turn',
      timestamp: '2026-06-19T10:00:00.000Z',
    }),
    row({
      type: 'assistant',
      content: 'pi thinking still live',
      source: 'pi-live',
      provider: 'pi',
      isThinking: true,
      messageKey: 'pi:live-thinking',
      turnAnchorKey: 'pi-live-turn',
      timestamp: '2026-06-19T10:00:01.000Z',
    }),
    row({
      type: 'assistant',
      content: '',
      source: 'pi-live',
      provider: 'pi',
      isToolUse: true,
      toolName: 'Bash',
      toolInput: 'printf "pi live tool"',
      toolCallId: 'pi-live-tool',
      toolId: 'pi-live-tool',
      toolResult: { content: 'pi live tool output', isError: false },
      messageKey: 'pi:live-tool',
      turnAnchorKey: 'pi-live-turn',
      timestamp: '2026-06-19T10:00:02.000Z',
    }),
    row({
      type: 'assistant',
      content: 'pi live final draft',
      source: 'pi-live',
      provider: 'pi',
      messageKey: 'pi:live-final',
      turnAnchorKey: 'pi-live-turn',
      timestamp: '2026-06-19T10:00:03.000Z',
    }),
  ];
  const persisted = [
    row({
      type: 'user',
      content: 'inspect pi live ws render',
      clientRequestId: 'pi-live-turn',
      deliveryStatus: 'persisted',
      turnAnchorKey: 'pi-live-turn',
      messageKey: 'pi:persisted-user',
      timestamp: '2026-06-19T10:00:00.000Z',
    }),
    row({
      type: 'assistant',
      content: 'pi persisted final',
      provider: 'pi',
      messageKey: 'pi:persisted-final',
      turnAnchorKey: 'pi-live-turn',
      timestamp: '2026-06-19T10:00:04.000Z',
    }),
  ];

  const merged = mergePersistedAndOptimisticMessages(persisted, previous, { sessionId: 'pi-final-only-refresh' });

  assert.equal(countText(merged, 'pi thinking still live'), 1);
  assert.equal(merged.filter((message) => message.isToolUse && message.toolName === 'Bash').length, 1);
  assert.equal(countText(merged, 'pi persisted final'), 1);
  assert.equal(countText(merged, 'pi live final draft'), 0);
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

test('session refresh cursor follows raw transcript line keys instead of visible message count', () => {
  const rawMessages = [
    { messageKey: 'codex:fixture-session:line:18:user' },
    { messageKey: 'codex:fixture-session:line:27:tool:read-file-1' },
    { messageKey: 'codex:fixture-session:line:33:tool-result:read-file-1' },
  ];

  assert.equal(getSessionMessageRawLineCursor(rawMessages[1]), 27);
  assert.equal(getMaxSessionMessageRawLineCursor(rawMessages), 33);
  assert.equal(
    resolveSessionMessageRawLineCursor(rawMessages, 3),
    33,
    'latest refresh must not use the three visible rows as the JSONL afterLine cursor',
  );
  assert.equal(resolveSessionMessageRawLineCursor([], 40), 40);
});

test('standalone read and write tool results update existing tool cards during refresh', () => {
  const existingMessages = [
    row({
      type: 'assistant',
      content: '',
      timestamp: '2026-06-12T08:00:00.000Z',
      provider: 'codex',
      source: 'codex-live',
      messageKey: 'codex:live-read-file',
      isToolUse: true,
      toolName: 'Read',
      toolInput: JSON.stringify({ file_path: '/repo/src/app.ts' }),
      toolCallId: 'read-file-1',
      toolId: 'read-file-1',
      toolResult: null,
    }),
    row({
      type: 'assistant',
      content: '',
      timestamp: '2026-06-12T08:00:01.000Z',
      provider: 'codex',
      source: 'codex-live',
      messageKey: 'codex:live-write-file',
      isToolUse: true,
      toolName: 'Write',
      toolInput: JSON.stringify({ file_path: '/repo/src/out.ts', content: 'export const ok = true;' }),
      toolCallId: 'write-file-1',
      toolId: 'write-file-1',
      toolResult: null,
    }),
  ];

  const nextMessages = mergeSessionMessageDelta({
    existingMessages,
    incomingRawMessages: [
      {
        type: 'tool_result',
        timestamp: '2026-06-12T08:00:02.000Z',
        provider: 'codex',
        messageKey: 'codex:fixture-session:line:33:tool-result:read-file-1',
        toolCallId: 'read-file-1',
        output: 'export const value = 1;',
      },
      {
        type: 'tool_result',
        timestamp: '2026-06-12T08:00:03.000Z',
        provider: 'codex',
        messageKey: 'codex:fixture-session:line:34:tool-result:write-file-1',
        toolCallId: 'write-file-1',
        output: 'file written',
      },
    ],
    sessionId: 'spec-chat-merge-standalone-tool-results',
  });

  assert.equal(nextMessages.length, 2, 'result-only refresh must not append duplicate tool cards');
  assert.equal(nextMessages[0].toolName, 'Read');
  assert.equal(nextMessages[0].toolResult?.content, 'export const value = 1;');
  assert.equal(nextMessages[1].toolName, 'Write');
  assert.equal(nextMessages[1].toolResult?.content, 'file written');
  assert.notEqual(nextMessages[0], existingMessages[0], 'updated read card must be copied instead of mutated');
  assert.equal(existingMessages[0].toolResult, null, 'old read card object must stay immutable');
});

test('apply_patch FileChanges rows carry per-file diff snapshots for editor open', () => {
  /**
   * Real Codex apply_patch calls render as compact FileChanges rows. Clicking an
   * edited file should still have old/new text so the editor opens a diff.
   */
  const normalized = normalizeCodexFunctionCall({
    name: 'apply_patch',
    arguments: JSON.stringify({
      patch: [
        '*** Begin Patch',
        '*** Update File: docs/example.md',
        '@@',
        '-old value',
        '+new value',
        ' shared context',
        '*** End Patch',
      ].join('\n'),
    }),
    call_id: 'patch-1',
  });

  const toolInput = normalized.toolInput as {
    changes: Array<{ path: string; old_string?: string; new_string?: string }>;
  };

  assert.equal(normalized.toolName, 'FileChanges');
  assert.equal(toolInput.changes[0]?.path, 'docs/example.md');
  assert.equal(toolInput.changes[0]?.old_string, 'old value\nshared context');
  assert.equal(toolInput.changes[0]?.new_string, 'new value\nshared context');
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
