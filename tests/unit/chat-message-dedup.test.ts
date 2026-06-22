/**
 * PURPOSE: Verify refresh-time transcript deduping collapses accidental
 * adjacent duplicates without deleting genuinely separate repeated messages.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { dedupeAdjacentChatMessages } from '../../frontend/components/chat/utils/messageDedup';
import { mergeSessionMessagesByIdentityPreservingOrder } from '../../frontend/components/chat/utils/sessionMessageDedup';
import { mergePersistedAndOptimisticMessages } from '../../frontend/components/chat/utils/sessionMessageMerge';
import { reduceNativeRuntimeEvent } from '../../frontend/components/chat/utils/nativeRuntimeTranscript';

test('dedupeAdjacentChatMessages collapses adjacent duplicate user messages from session restore', () => {
  const messages = [
    {
      type: 'user',
      content: '帮我查一下日志',
      timestamp: '2026-04-15T10:00:00.000Z',
    },
    {
      type: 'user',
      content: '帮我查一下日志',
      timestamp: '2026-04-15T10:00:01.500Z',
    },
    {
      type: 'assistant',
      content: '收到',
      timestamp: '2026-04-15T10:00:03.000Z',
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 2);
  assert.equal(dedupedMessages[0].content, '帮我查一下日志');
  assert.equal(dedupedMessages[1].content, '收到');
});

test('dedupeAdjacentChatMessages keeps repeated user messages that are meaningfully separated in time', () => {
  const messages = [
    {
      type: 'user',
      content: '继续',
      timestamp: '2026-04-15T10:00:00.000Z',
    },
    {
      type: 'assistant',
      content: '好的',
      timestamp: '2026-04-15T10:00:02.000Z',
    },
    {
      type: 'user',
      content: '继续',
      timestamp: '2026-04-15T10:02:00.000Z',
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 3);
  assert.deepEqual(dedupedMessages.map((message) => message.content), ['继续', '好的', '继续']);
});

test('dedupeAdjacentChatMessages collapses adjacent persisted assistant text duplicates with different keys', () => {
  const messages = [
    {
      type: 'assistant',
      content: '我会再跑一次生产构建，覆盖 Vite/Tailwind 打包路径，确认新组件的样式类和导入都能过构建。',
      timestamp: '2026-06-21T08:10:00.000Z',
      messageKey: 'codex:c1:line:120:msg:0',
      deliveryStatus: 'persisted' as const,
    },
    {
      type: 'assistant',
      content: '我会再跑一次生产构建，覆盖 Vite/Tailwind 打包路径，确认新组件的样式类和导入都能过构建。',
      timestamp: '2026-06-21T08:10:00.500Z',
      messageKey: 'codex:c1:line:121:msg:0',
      deliveryStatus: 'persisted' as const,
    },
    {
      type: 'assistant',
      content: '生产构建也通过了。最后确认一下工作区状态，避免构建产物或无关文件被误认为本次修改。',
      timestamp: '2026-06-21T08:10:05.000Z',
      messageKey: 'codex:c1:line:122:msg:0',
      deliveryStatus: 'persisted' as const,
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.deepEqual(
    dedupedMessages.map((message) => message.content),
    [
      '我会再跑一次生产构建，覆盖 Vite/Tailwind 打包路径，确认新组件的样式类和导入都能过构建。',
      '生产构建也通过了。最后确认一下工作区状态，避免构建产物或无关文件被误认为本次修改。',
    ],
  );
  assert.equal(dedupedMessages[0].messageKey, 'codex:c1:line:120:msg:0');
});

test('dedupeAdjacentChatMessages keeps markdown assistant row over duplicate raw task notification', () => {
  const content = '我现在创建一个小型架构 Mermaid 源文件，然后用 headless Chromium 把它渲染成 PNG。输出会放在 `docs/mermaid-preview.*`，方便你在应用文件树里直接打开图片测试。';
  const messages = [
    {
      type: 'assistant',
      content,
      timestamp: '2026-06-21T08:20:00.000Z',
      messageKey: 'codex-live:agent-message-1',
      source: 'codex-live',
    },
    {
      type: 'assistant',
      content,
      timestamp: '2026-06-21T08:20:00.300Z',
      messageKey: 'codex:c1:line:130:msg:0',
      deliveryStatus: 'persisted' as const,
      isTaskNotification: true,
      taskStatus: 'in_progress',
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 1);
  assert.equal(dedupedMessages[0].content, content);
  assert.equal(dedupedMessages[0].isTaskNotification, undefined);
});

test('dedupeAdjacentChatMessages replaces duplicate raw task notification with markdown assistant row', () => {
  const content = '我现在创建一个小型架构 Mermaid 源文件，然后用 headless Chromium 把它渲染成 PNG。输出会放在 `docs/mermaid-preview.*`，方便你在应用文件树里直接打开图片测试。';
  const messages = [
    {
      type: 'assistant',
      content,
      timestamp: '2026-06-21T08:20:00.000Z',
      messageKey: 'codex:c1:line:130:msg:0',
      deliveryStatus: 'persisted' as const,
      isTaskNotification: true,
      taskStatus: 'in_progress',
    },
    {
      type: 'assistant',
      content,
      timestamp: '2026-06-21T08:20:00.300Z',
      messageKey: 'codex-live:agent-message-1',
      source: 'codex-live',
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 1);
  assert.equal(dedupedMessages[0].content, content);
  assert.equal(dedupedMessages[0].isTaskNotification, undefined);
});

test('dedupeAdjacentChatMessages collapses non-adjacent same-timestamp user echoes', () => {
  const messages = [
    {
      type: 'user',
      content: '滚动到底部后不要重复',
      timestamp: '2026-04-30T04:10:00.000Z',
    },
    {
      type: 'assistant',
      content: '处理中',
      timestamp: '2026-04-30T04:10:01.000Z',
    },
    {
      type: 'user',
      content: '滚动到底部后不要重复',
      timestamp: '2026-04-30T04:10:00.000Z',
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.deepEqual(dedupedMessages.map((message) => message.content), ['滚动到底部后不要重复', '处理中']);
});

test('dedupeAdjacentChatMessages collapses non-adjacent user echoes inside the send window', () => {
  const messages = [
    {
      type: 'user',
      content: '我重启服务了，你新建个会话实测一遍',
      timestamp: '2026-04-30T06:38:03.100Z',
      deliveryStatus: 'persisted' as const,
    },
    {
      type: 'assistant',
      content: '开始测试',
      timestamp: '2026-04-30T06:38:04.000Z',
    },
    {
      type: 'user',
      content: '我重启服务了，你新建个会话实测一遍',
      timestamp: '2026-04-30T06:38:03.900Z',
      deliveryStatus: 'sent' as const,
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.deepEqual(
    dedupedMessages.map((message) => `${message.type}:${message.content}`),
    ['user:我重启服务了，你新建个会话实测一遍', 'assistant:开始测试'],
  );
  assert.equal(dedupedMessages[0].deliveryStatus, 'persisted');
});

test('dedupeAdjacentChatMessages merges optimistic user bubble with persisted echo', () => {
  const messages = [
    {
      type: 'user',
      content: '发送时用户气泡不要重复',
      timestamp: '2026-04-30T04:30:00.000Z',
      clientRequestId: 'chatreq-test',
      deliveryStatus: 'pending' as const,
    },
    {
      type: 'user',
      content: '发送时用户气泡不要重复',
      timestamp: '2026-04-30T04:30:01.000Z',
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 1);
  assert.equal(dedupedMessages[0].content, '发送时用户气泡不要重复');
  assert.equal(dedupedMessages[0].deliveryStatus, 'persisted');
});

test('dedupeAdjacentChatMessages ignores render messageKey differences for optimistic echoes', () => {
  const messages = [
    {
      type: 'user',
      content: '发送后底部不要重复气泡',
      timestamp: '2026-05-21T02:30:00.000Z',
      clientRequestId: 'chatreq-keyed-optimistic',
      messageKey: 'optimistic:chatreq-keyed-optimistic',
      deliveryStatus: 'sent' as const,
    },
    {
      type: 'user',
      content: '发送后底部不要重复气泡',
      timestamp: '2026-05-21T02:30:01.000Z',
      messageKey: 'codex:c7:line:42',
      deliveryStatus: 'persisted' as const,
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 1);
  assert.equal(dedupedMessages[0].deliveryStatus, 'persisted');
});

test('dedupeAdjacentChatMessages collapses repeated persisted user echoes from follow refresh', () => {
  const messages = Array.from({ length: 6 }, (_, index) => ({
    type: 'user',
    content: '另外，检查一下ws live路径的消息显示规则，观测到它又重复显示内容了（刷新后不重复）',
    timestamp: `2026-06-22T02:30:49.${String(index).padStart(3, '0')}Z`,
    messageKey: `codex:c42:line:${120 + index}:msg:0`,
    deliveryStatus: 'persisted' as const,
  }));

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 1);
  assert.equal(
    dedupedMessages[0].content,
    '另外，检查一下ws live路径的消息显示规则，观测到它又重复显示内容了（刷新后不重复）',
  );
  assert.equal(dedupedMessages[0].deliveryStatus, 'persisted');
});

test('mergePersistedAndOptimisticMessages matches persisted user row despite different messageKey', () => {
  const mergedMessages = mergePersistedAndOptimisticMessages(
    [
      {
        type: 'user',
        content: '刷新前后都只显示一条用户气泡',
        timestamp: '2026-05-21T02:31:01.000Z',
        messageKey: 'codex:c7:line:43',
      },
    ],
    [
      {
        type: 'user',
        content: '刷新前后都只显示一条用户气泡',
        submittedContent: '刷新前后都只显示一条用户气泡',
        timestamp: '2026-05-21T02:31:00.000Z',
        clientRequestId: 'chatreq-merge-optimistic',
        messageKey: 'optimistic:chatreq-merge-optimistic',
        deliveryStatus: 'sent' as const,
      },
    ],
  );

  assert.equal(mergedMessages.length, 1);
  assert.equal(mergedMessages[0].deliveryStatus, 'persisted');
  assert.equal(mergedMessages[0].clientRequestId, 'chatreq-merge-optimistic');
});

test('mergePersistedAndOptimisticMessages preserves accepted follow-up until transcript catches up', () => {
  const mergedMessages = mergePersistedAndOptimisticMessages(
    [
      {
        type: 'user',
        content: '第一条已经落盘',
        timestamp: '2026-05-28T03:00:00.000Z',
      },
      {
        type: 'assistant',
        content: '第一条回复仍在刷新',
        timestamp: '2026-05-28T03:00:05.000Z',
      },
    ],
    [
      {
        type: 'user',
        content: '第二条在回复过程中发送',
        submittedContent: '第二条在回复过程中发送',
        timestamp: '2026-05-28T03:00:10.000Z',
        clientRequestId: 'chatreq-followup-sent',
        messageKey: 'optimistic:chatreq-followup-sent',
        deliveryStatus: 'persisted' as const,
      },
    ],
  );

  assert.deepEqual(
    mergedMessages.map((message) => `${message.type}:${message.content}`),
    [
      'user:第一条已经落盘',
      'assistant:第一条回复仍在刷新',
      'user:第二条在回复过程中发送',
    ],
  );
});

test('mergePersistedAndOptimisticMessages drops live assistant once JSONL contains the same final text', () => {
  const mergedMessages = mergePersistedAndOptimisticMessages(
    [
      {
        type: 'user',
        content: '续发后不要把实时回复和 JSONL 回复渲染两遍',
        timestamp: '2026-05-29T06:12:30.000Z',
        messageKey: 'codex:c21:line:6:msg:0',
      },
      {
        type: 'assistant',
        content: '我会先检查路由映射，再确认消息来源。',
        timestamp: '2026-05-29T06:12:33.000Z',
        messageKey: 'codex:c21:line:10:msg:0',
      },
    ],
    [
      {
        type: 'assistant',
        content: '我会先检查路由映射，再确认消息来源。',
        timestamp: '2026-05-29T06:13:20.000Z',
        messageKey: 'codex-live:unknown',
        source: 'codex-live',
      },
    ],
  );

  assert.deepEqual(
    mergedMessages.map((message) => `${message.type}:${message.content}`),
    [
      'user:续发后不要把实时回复和 JSONL 回复渲染两遍',
      'assistant:我会先检查路由映射，再确认消息来源。',
    ],
  );
  assert.equal(mergedMessages[1].messageKey, 'codex:c21:line:10:msg:0');
});

test('mergePersistedAndOptimisticMessages drops live assistant prefix after JSONL final text catches up', () => {
  const mergedMessages = mergePersistedAndOptimisticMessages(
    [
      {
        type: 'user',
        content: '动态推送不要把运行中片段和落盘最终回复渲染两遍',
        timestamp: '2026-06-12T08:12:30.000Z',
        messageKey: 'codex:c33:line:6:msg:0',
      },
      {
        type: 'assistant',
        content: '我会先检查 live transcript 行，再用 read model 做一次最终校准。',
        timestamp: '2026-06-12T08:12:33.000Z',
        messageKey: 'codex:c33:line:10:msg:0',
      },
    ],
    [
      {
        type: 'assistant',
        content: '我会先检查 live transcript 行',
        timestamp: '2026-06-12T08:12:31.000Z',
        messageKey: 'codex-live:item-delta-33',
        source: 'codex-live',
      },
    ],
  );

  assert.deepEqual(
    mergedMessages.map((message) => `${message.type}:${message.content}`),
    [
      'user:动态推送不要把运行中片段和落盘最终回复渲染两遍',
      'assistant:我会先检查 live transcript 行，再用 read model 做一次最终校准。',
    ],
  );
});

test('mergeSessionMessagesByIdentityPreservingOrder skips cN active overlay assistant already loaded from JSONL', () => {
  const persistedText = '我会把这次决策同步到 ~/.matx 里的 skill/subagent，保留显式触发和宽泛搜索。';
  const mergedMessages = mergeSessionMessagesByIdentityPreservingOrder(
    [
      {
        type: 'assistant',
        timestamp: '2026-06-18T06:02:28.879Z',
        provider: 'codex',
        messageKey: 'codex:provider-session:line:253:msg:0',
        message: { role: 'assistant', content: persistedText },
      },
    ],
    [
      {
        type: 'assistant',
        timestamp: '2026-06-18T06:02:28.900Z',
        provider: 'codex',
        messageKey: 'codex:msg_live_overlay_1',
        message: { role: 'assistant', content: persistedText },
      },
    ],
  );

  assert.equal(mergedMessages.length, 1);
  assert.equal(mergedMessages[0].messageKey, 'codex:provider-session:line:253:msg:0');
  assert.equal(mergedMessages[0].message?.content, persistedText);
});

test('mergeSessionMessagesByIdentityPreservingOrder extends loaded JSONL assistant with longer active overlay text', () => {
  const persistedPrefix = '我会保持两个文件都是说明层，不新增 skill.runtime.yaml';
  const liveExpanded = '我会保持两个文件都是说明层，不新增 skill.runtime.yaml 或 workflow 节点；这符合自动触发先不做、JSON 约定先不做的范围。';
  const mergedMessages = mergeSessionMessagesByIdentityPreservingOrder(
    [
      {
        type: 'assistant',
        timestamp: '2026-06-18T06:02:37.986Z',
        provider: 'codex',
        messageKey: 'codex:provider-session:line:256:msg:0',
        message: { role: 'assistant', content: persistedPrefix },
      },
    ],
    [
      {
        type: 'assistant',
        timestamp: '2026-06-18T06:02:38.100Z',
        provider: 'codex',
        messageKey: 'codex:msg_live_overlay_2',
        message: { role: 'assistant', content: liveExpanded },
      },
    ],
  );

  assert.equal(mergedMessages.length, 1);
  assert.equal(mergedMessages[0].messageKey, 'codex:provider-session:line:256:msg:0');
  assert.equal(mergedMessages[0].message?.content, liveExpanded);
});

test('mergePersistedAndOptimisticMessages drops live tool card once JSONL contains the same tool call', () => {
  const mergedMessages = mergePersistedAndOptimisticMessages(
    [
      {
        type: 'assistant',
        content: '',
        timestamp: '2026-05-29T06:20:33.000Z',
        messageKey: 'codex:c21:line:11:msg:0',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: '{ "command": "pnpm run typecheck" }',
        toolCallId: 'call_typecheck',
        toolResult: {
          content: 'typecheck passed',
        },
      },
    ],
    [
      {
        type: 'assistant',
        content: '',
        timestamp: '2026-05-29T06:20:31.000Z',
        messageKey: 'codex-live:call_typecheck',
        source: 'codex-live',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: { command: 'pnpm run typecheck' },
        toolCallId: 'call_typecheck',
        toolResult: {
          content: 'typecheck passed',
        },
      },
    ],
  );

  assert.equal(mergedMessages.length, 1);
  assert.equal(mergedMessages[0].messageKey, 'codex:c21:line:11:msg:0');
});

test('mergePersistedAndOptimisticMessages drops live tool card once JSONL has a result with the same tool identity', () => {
  const mergedMessages = mergePersistedAndOptimisticMessages(
    [
      {
        type: 'assistant',
        content: '',
        timestamp: '2026-05-29T06:20:33.000Z',
        messageKey: 'codex:c21:line:12:msg:0',
        isToolUse: true,
        toolName: 'ctx_batch_execute',
        toolInput: { command: 'rg --files' },
        toolCallId: 'call_context_tree',
        toolResult: {
          content: [{ type: 'text', text: 'Source Tree\nrg --files\nOutput\nfrontend/App.tsx' }],
        },
      },
    ],
    [
      {
        type: 'assistant',
        content: '',
        timestamp: '2026-05-29T06:20:31.000Z',
        messageKey: 'codex-live:call_context_tree',
        source: 'codex-realtime',
        isToolUse: true,
        toolName: 'ctx_batch_execute',
        toolInput: { command: 'rg --files' },
        toolCallId: 'call_context_tree',
        toolResult: {
          content: 'rg --files\nfrontend/App.tsx',
        },
      },
    ],
  );

  assert.equal(mergedMessages.length, 1);
  assert.equal(mergedMessages[0].messageKey, 'codex:c21:line:12:msg:0');
});

test('mergePersistedAndOptimisticMessages preserves live tool result until JSONL result catches up', () => {
  const mergedMessages = mergePersistedAndOptimisticMessages(
    [
      {
        type: 'assistant',
        content: '',
        timestamp: '2026-05-29T06:20:33.000Z',
        messageKey: 'codex:c21:line:11:msg:0',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: '{ "command": "pnpm run typecheck" }',
        toolCallId: 'call_typecheck_pending',
      },
    ],
    [
      {
        type: 'assistant',
        content: '',
        timestamp: '2026-05-29T06:20:31.000Z',
        messageKey: 'codex-live:call_typecheck_pending',
        source: 'codex-live',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: { command: 'pnpm run typecheck' },
        toolCallId: 'call_typecheck_pending',
        toolResult: {
          content: 'typecheck passed',
        },
      },
    ],
  );

  assert.equal(mergedMessages.length, 2);
  assert.equal(mergedMessages[1].source, 'codex-live');
});

test('reduceNativeRuntimeEvent drops live tool echo when JSONL already has the completed tool result', () => {
  const messages = reduceNativeRuntimeEvent(
    [
      {
        type: 'assistant',
        content: '',
        timestamp: '2026-05-29T06:20:33.000Z',
        messageKey: 'codex:c21:line:12:msg:0',
        isToolUse: true,
        toolName: 'ctx_batch_execute',
        toolInput: JSON.stringify({ commands: [{ label: 'Source Tree', command: 'rg --files' }] }),
        toolCallId: 'call_context_tree',
        toolResult: {
          content: 'Source Tree\nrg --files\nOutput\nfrontend/App.tsx',
        },
      },
    ],
    {
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'command_execution',
        itemId: 'call_context_tree',
        command: 'ctx_batch_execute',
        arguments: {
          commands: [{ label: 'Source Tree', command: 'rg --files' }],
        },
        output: 'rg --files\nfrontend/App.tsx',
        exitCode: 0,
      },
    },
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].messageKey, 'codex:c21:line:12:msg:0');
});

test('mergePersistedAndOptimisticMessages drops stale live file update JSON with no persisted row', () => {
  const mergedMessages = mergePersistedAndOptimisticMessages(
    [
      {
        type: 'user',
        content: '滚动到底部后不要恢复 provider 文件更新 JSON',
        timestamp: '2026-05-29T06:21:00.000Z',
        messageKey: 'codex:c21:line:10:msg:0',
      },
    ],
    [
      {
        type: 'assistant',
        content: JSON.stringify({
          path: '/home/zzl/projects/ozw/tests/spec/project-route-addressing.spec.ts',
          kind: 'update',
        }, null, 2),
        timestamp: '2026-05-29T06:21:01.000Z',
        messageKey: 'codex-live:file-update-json',
        source: 'codex-live',
      },
    ],
  );

  assert.deepEqual(
    mergedMessages.map((message) => `${message.type}:${message.content}`),
    ['user:滚动到底部后不要恢复 provider 文件更新 JSON'],
  );
});

test('dedupeAdjacentChatMessages treats empty attachment arrays as plain user messages', () => {
  const messages = [
    {
      type: 'user',
      content: '空附件数组不要阻断去重',
      timestamp: '2026-04-15T10:00:00.000Z',
      clientRequestId: 'chatreq-empty-attachments',
      deliveryStatus: 'pending' as const,
      attachments: [],
    },
    {
      type: 'user',
      content: '空附件数组不要阻断去重',
      timestamp: '2026-04-15T10:00:01.000Z',
      clientRequestId: 'chatreq-empty-attachments',
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 1);
  assert.equal(dedupedMessages[0].deliveryStatus, 'persisted');
});

test('dedupeAdjacentChatMessages merges duplicated user bubbles with the same attachment', () => {
  const messages = [
    {
      type: 'user',
      content: '带附件的用户消息不要重复',
      timestamp: '2026-04-30T07:36:19.000Z',
      deliveryStatus: 'sent' as const,
      attachments: [
        {
          name: 'b7190647290f8eb88c52.jpg',
          absolutePath: '/home/zzl/ozw-uploads/1/1777534579564-6135f129/b7190647290f8eb88c52.jpg',
        },
      ],
    },
    {
      type: 'user',
      content: '带附件的用户消息不要重复',
      timestamp: '2026-04-30T07:36:19.000Z',
      deliveryStatus: 'persisted' as const,
      attachments: [
        {
          name: 'b7190647290f8eb88c52.jpg',
          absolutePath: '/home/zzl/ozw-uploads/1/1777534579564-6135f129/b7190647290f8eb88c52.jpg',
        },
      ],
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 1);
  assert.equal(dedupedMessages[0].deliveryStatus, 'persisted');
});

test('dedupeAdjacentChatMessages keeps same text when attachments differ', () => {
  const messages = [
    {
      type: 'user',
      content: '同一说明但附件不同',
      timestamp: '2026-04-30T07:36:19.000Z',
      attachments: [{ name: 'before.jpg', absolutePath: '/tmp/before.jpg' }],
    },
    {
      type: 'user',
      content: '同一说明但附件不同',
      timestamp: '2026-04-30T07:36:20.000Z',
      attachments: [{ name: 'after.jpg', absolutePath: '/tmp/after.jpg' }],
    },
  ];

  const dedupedMessages = dedupeAdjacentChatMessages(messages);

  assert.equal(dedupedMessages.length, 2);
});
