/**
 * PURPOSE: Verify native SDK runtime events can directly render live chat
 * messages before provider JSONL history is available.
 */

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

type ChatMessageLike = {
  type?: string;
  content?: unknown;
  provider?: string;
  source?: string;
  messageKey?: string;
  isThinking?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: { content?: unknown; isError?: boolean } | null;
  toolCallId?: unknown;
  toolId?: unknown;
  deliveryStatus?: string;
  turnAnchorKey?: unknown;
  exitCode?: unknown;
  status?: string;
};

type NativeTranscriptModule = {
  reduceNativeRuntimeEvent: (messages: ChatMessageLike[], event: Record<string, unknown>) => ChatMessageLike[];
};

type SessionMergeModule = {
  mergePersistedAndOptimisticMessages: (
    persistedMessages: ChatMessageLike[],
    previousMessages: ChatMessageLike[],
    options?: { sessionId?: string | null },
  ) => ChatMessageLike[];
};

const REPO_ROOT = process.cwd();

async function readRepoFile(relativePath: string): Promise<string> {
  /**
   * PURPOSE: Read production source so the acceptance test exercises the real
   * frontend handler contract rather than a copied fixture.
   */
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

async function loadNativeTranscriptModule(): Promise<NativeTranscriptModule> {
  /**
   * PURPOSE: Load the reducer that execution must provide for native live
   * message rendering; failing here means the target architecture is absent.
   */
  const modulePath = path.join(REPO_ROOT, 'frontend/components/chat/utils/nativeRuntimeTranscript.ts');
  try {
    const mod = await import(pathToFileURL(modulePath).href) as Partial<NativeTranscriptModule>;
    assert.equal(
      typeof mod.reduceNativeRuntimeEvent,
      'function',
      'nativeRuntimeTranscript.ts must export reduceNativeRuntimeEvent(messages, event)',
    );
    return mod as NativeTranscriptModule;
  } catch (error) {
    assert.fail(`Expected native runtime transcript reducer module to be importable: ${(error as Error).message}`);
  }
}

async function loadSessionMergeModule(): Promise<SessionMergeModule> {
  /**
   * PURPOSE: Load the real transcript merge function so refresh protection is
   * tested against production frontend state logic.
   */
  const modulePath = path.join(REPO_ROOT, 'frontend/components/chat/utils/sessionMessageMerge.ts');
  try {
    const mod = await import(pathToFileURL(modulePath).href) as Partial<SessionMergeModule>;
    assert.equal(
      typeof mod.mergePersistedAndOptimisticMessages,
      'function',
      'sessionMessageMerge.ts must export mergePersistedAndOptimisticMessages',
    );
    return mod as SessionMergeModule;
  } catch (error) {
    assert.fail(`Expected session message merge module to be importable: ${(error as Error).message}`);
  }
}

function extractMessageText(message: ChatMessageLike | undefined): string {
  /**
   * PURPOSE: Normalize the small ChatMessage subset this acceptance test needs
   * without depending on the full React rendering layer.
   */
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: unknown }).text ?? '');
      return '';
    }).join('');
  }
  return '';
}

function assertCodexFileChangesCard(message: ChatMessageLike | undefined, expectedPath: string): void {
  /**
   * PURPOSE: Assert Codex live file-operation bookkeeping reaches the UI as a
   * FileChanges tool card rather than raw assistant JSON.
   */
  assert.ok(message, 'file operation must create one live card row');
  assert.equal(message.isToolUse, true, 'file operation must be a tool card');
  assert.equal(message.toolName, 'FileChanges', 'file operation must reuse FileChanges renderer');
  assert.match(JSON.stringify(message.toolInput), new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(extractMessageText(message), '', 'file operation card must not carry raw JSON in content');
}

test('Codex agent_message updates the same live assistant message by provider item id', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const firstEvent = {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'codex-msg-1',
      message: { role: 'assistant', content: 'Hel' },
    },
  };
  const updateEvent = {
    ...firstEvent,
    data: {
      ...firstEvent.data,
      message: { role: 'assistant', content: 'Hello from Codex' },
    },
  };

  const afterFirst = reduceNativeRuntimeEvent([], firstEvent);
  const afterUpdate = reduceNativeRuntimeEvent(afterFirst, updateEvent);
  const assistantMessages = afterUpdate.filter((message) => message.type === 'assistant');

  assert.equal(assistantMessages.length, 1, 'same Codex itemId must update one assistant message');
  assert.equal(extractMessageText(assistantMessages[0]), 'Hello from Codex');
  assert.equal(assistantMessages[0].provider, 'codex');
  assert.match(String(assistantMessages[0].messageKey || ''), /codex-msg-1/);
});

test('Codex live file update JSON renders as FileChanges before follow-latest catches up', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const event = {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'codex-file-update-json',
      message: {
        role: 'assistant',
        content: JSON.stringify({
          path: '/home/zzl/projects/ozw/tests/spec/project-route-addressing.spec.ts',
          kind: 'update',
        }, null, 2),
      },
    },
  };

  const result = reduceNativeRuntimeEvent([], event);

  assert.equal(result.length, 1, 'file update bookkeeping JSON must become one live card row');
  assertCodexFileChangesCard(result[0], 'tests/spec/project-route-addressing.spec.ts');
});

test('Codex live file update object renders as FileChanges before follow-latest catches up', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const event = {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'codex-file-update-object',
      message: {
        role: 'assistant',
        content: {
          path: '/home/zzl/projects/ozw/tests/spec/project-route-addressing.spec.ts',
          kind: 'update',
        },
      },
    },
  };

  const result = reduceNativeRuntimeEvent([], event);

  assert.equal(result.length, 1, 'structured file update payload must become one live card row');
  assertCodexFileChangesCard(result[0], 'tests/spec/project-route-addressing.spec.ts');
});

test('Codex live output_text file update JSON renders as FileChanges before follow-latest catches up', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const event = {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'codex-file-update-output-text',
      message: {
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: JSON.stringify({
            path: '/home/zzl/projects/ozw/tests/spec/project-route-addressing.spec.ts',
            kind: 'update',
          }, null, 2),
        }],
      },
    },
  };

  const result = reduceNativeRuntimeEvent([], event);

  assert.equal(result.length, 1, 'output_text file update JSON must become one live card row');
  assertCodexFileChangesCard(result[0], 'tests/spec/project-route-addressing.spec.ts');
});

test('Codex live file_change converges with JSONL FileChanges replay without duplicate cards', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const { mergePersistedAndOptimisticMessages } = await loadSessionMergeModule();
  const liveMessages = reduceNativeRuntimeEvent([
    {
      type: 'user',
      content: 'edit file',
      deliveryStatus: 'sent',
      turnAnchorKey: 'turn-1',
    },
  ], {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'file_change',
      itemId: 'same-file-op',
      changes: [{ kind: 'update', path: 'src/live-update.ts' }],
      status: 'completed',
    },
  });
  const persistedMessages = [
    {
      type: 'user',
      content: 'edit file',
      deliveryStatus: 'persisted',
      turnAnchorKey: 'turn-1',
    },
    {
      type: 'assistant',
      content: '',
      isToolUse: true,
      toolName: 'FileChanges',
      toolInput: {
        status: 'Edit file',
        changes: [{ kind: 'edit', path: 'src/live-update.ts' }],
      },
      toolCallId: 'same-file-op',
      toolId: 'same-file-op',
      toolResult: { content: '', isError: false, status: 'completed' },
    },
  ];

  const merged = mergePersistedAndOptimisticMessages(persistedMessages, liveMessages, { sessionId: 'proposal-88-file-change-dedupe' });
  const fileChangeCards = merged.filter((message) => message.isToolUse && message.toolName === 'FileChanges');

  assert.equal(liveMessages.length, 2, 'live file_change must append one FileChanges card after the local user');
  assertCodexFileChangesCard(liveMessages[1], 'src/live-update.ts');
  assert.equal(fileChangeCards.length, 1, 'JSONL replay must replace the matching live FileChanges card');
  assert.equal(fileChangeCards[0].toolCallId, 'same-file-op');
});

test('Codex live nested message file update JSON renders as FileChanges before follow-latest catches up', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const event = {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'codex-file-update-nested-message',
      message: {
        role: 'assistant',
        content: {
          message: {
            content: JSON.stringify({
              path: '/home/zzl/projects/ozw/tests/spec/project-route-addressing.spec.ts',
              kind: 'update',
            }, null, 2),
          },
        },
      },
    },
  };

  const result = reduceNativeRuntimeEvent([], event);

  assert.equal(result.length, 1, 'nested message file update JSON must become one live card row');
  assertCodexFileChangesCard(result[0], 'tests/spec/project-route-addressing.spec.ts');
});

test('Pi text deltas for the same message id merge into one live assistant message', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const firstDelta = {
    type: 'pi-response',
    sessionId: 'pi-live-session',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'pi-msg-1',
      message: { role: 'assistant', content: 'Hel' },
    },
  };
  const secondDelta = {
    ...firstDelta,
    data: {
      ...firstDelta.data,
      message: { role: 'assistant', content: 'lo from Pi' },
    },
  };

  const afterFirst = reduceNativeRuntimeEvent([], firstDelta);
  const afterSecond = reduceNativeRuntimeEvent(afterFirst, secondDelta);
  const assistantMessages = afterSecond.filter((message) => message.type === 'assistant');

  assert.equal(assistantMessages.length, 1, 'same Pi message id must not create duplicate assistant bubbles');
  assert.equal(extractMessageText(assistantMessages[0]), 'Hello from Pi');
  assert.equal(assistantMessages[0].provider, 'pi');
  assert.match(String(assistantMessages[0].messageKey || ''), /pi-msg-1/);
});

test('Pi reasoning delta upserts into a single assistant message with isThinking by item id', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const firstDelta = {
    type: 'pi-response',
    sessionId: 'pi-live-session',
    data: {
      type: 'item',
      itemType: 'reasoning',
      itemId: 'pi-reason-1',
      message: { role: 'assistant', content: 'Let me think', isReasoning: true },
    },
  };
  const secondDelta = {
    ...firstDelta,
    data: {
      ...firstDelta.data,
      message: { role: 'assistant', content: ' about this step', isReasoning: true },
    },
  };

  const afterFirst = reduceNativeRuntimeEvent([], firstDelta);
  const afterSecond = reduceNativeRuntimeEvent(afterFirst, secondDelta);
  const assistantMessages = afterSecond.filter((message) => message.type === 'assistant');

  assert.equal(assistantMessages.length, 1, 'same Pi reasoning itemId must update one assistant message');
  assert.equal(assistantMessages[0].isThinking, true, 'reasoning message must have isThinking === true');
  assert.equal(extractMessageText(assistantMessages[0]), 'Let me think about this step');
  assert.equal(assistantMessages[0].provider, 'pi');
  assert.match(String(assistantMessages[0].messageKey || ''), /pi-reason-1/);
});

test('Pi tool_call and tool_result upsert into a single assistant message with isToolUse by toolCallId', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const startEvent = {
    type: 'pi-response',
    sessionId: 'pi-live-session',
    data: {
      type: 'item',
      itemType: 'tool_call',
      itemId: 'pi-tool-1',
      tool: 'read_file',
      status: 'running',
    },
  };
  const endEvent = {
    type: 'pi-response',
    sessionId: 'pi-live-session',
    data: {
      type: 'item',
      itemType: 'tool_result',
      itemId: 'pi-tool-1',
      tool: 'read_file',
      result: 'file contents',
      status: 'completed',
    },
  };

  const afterStart = reduceNativeRuntimeEvent([], startEvent);
  const afterEnd = reduceNativeRuntimeEvent(afterStart, endEvent);
  const assistantMessages = afterEnd.filter((message) => message.type === 'assistant');

  assert.equal(assistantMessages.length, 1, 'same Pi toolCallId must update one assistant message');
  assert.equal(assistantMessages[0].provider, 'pi');
  assert.equal(assistantMessages[0].isToolUse, true, 'tool message must have isToolUse');
  assert.equal(assistantMessages[0].toolName, 'read_file', 'tool message must carry toolName');
  assert.equal(assistantMessages[0].toolResult?.content, 'file contents', 'tool_result must set toolResult.content');
  assert.match(String(assistantMessages[0].messageKey || ''), /pi-tool-1/);
});

test('Pi agent_end without itemId does not create a second live bubble when deltas already exist', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const deltaEvent = {
    type: 'pi-response',
    sessionId: 'pi-live-session',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'pi-msg-1',
      message: { role: 'assistant', content: 'Hello from Pi' },
    },
  };
  const agentEndEvent = {
    type: 'pi-response',
    sessionId: 'pi-live-session',
    data: {
      type: 'item',
      itemType: 'agent_message',
      message: { role: 'assistant', content: 'Hello from Pi' },
    },
  };

  const afterDelta = reduceNativeRuntimeEvent([], deltaEvent);
  const afterAgentEnd = reduceNativeRuntimeEvent(afterDelta, agentEndEvent);
  const assistantMessages = afterAgentEnd.filter((message) => message.type === 'assistant');

  assert.equal(assistantMessages.length, 1, 'agent_end without itemId must not create duplicate assistant bubble');
});

test('Codex command_execution produces assistant message with isToolUse, command and output', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const event = {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'command_execution',
      itemId: 'cmd-1',
      command: 'ls -la',
      output: 'total 12',
      exitCode: 0,
      status: 'completed',
    },
  };

  const result = reduceNativeRuntimeEvent([], event);
  const assistantMessages = result.filter((m) => m.type === 'assistant');

  assert.equal(assistantMessages.length, 1, 'command_execution must produce one assistant message');
  assert.equal(assistantMessages[0].isToolUse, true, 'must set isToolUse');
  assert.equal(assistantMessages[0].toolName, 'Bash', 'command_execution must reuse Bash renderer');
  assert.equal(assistantMessages[0].toolInput, 'ls -la', 'must carry command in Bash input as normalized string');
  assert.equal(assistantMessages[0].toolResult, null, 'successful command_execution keeps noisy output collapsed until needed');
  assert.equal(assistantMessages[0].exitCode, 0, 'must carry exitCode');
});

test('Codex realtime function_call output updates the same write_stdin assistant card', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const callEvent = {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'function_call',
      item: {
        type: 'function_call',
        name: 'write_stdin',
        call_id: 'call-write-stdin-1',
        arguments: JSON.stringify({ session_id: 41605, chars: '' }),
      },
    },
  };
  const outputEvent = {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'function_call_output',
      item: {
        type: 'function_call_output',
        call_id: 'call-write-stdin-1',
        output: [
          { text: 'Chunk ID: abc\n' },
          { text: 'Output:\n刷新网页后重载的样式' },
        ],
      },
    },
  };

  const afterCall = reduceNativeRuntimeEvent([], callEvent);
  const afterOutput = reduceNativeRuntimeEvent(afterCall, outputEvent);
  const assistantMessages = afterOutput.filter((m) => m.type === 'assistant');

  assert.equal(assistantMessages.length, 1, 'function_call_output must update the existing assistant card');
  assert.equal(assistantMessages[0].toolName, 'write_stdin', 'tool name must be preserved from the function_call');
  assert.equal(
    JSON.parse(String(assistantMessages[0].toolInput)).session_id,
    41605,
    'function_call_output must not erase the input payload needed by the compact renderer',
  );
  assert.equal(assistantMessages[0].toolCallId, 'call-write-stdin-1', 'toolCallId must stay stable');
  assert.equal(
    assistantMessages[0].toolResult?.content,
    'Chunk ID: abc\n\nOutput:\n刷新网页后重载的样式',
    'structured output parts must become readable text instead of [object Object]',
  );
});

test('Codex realtime update_plan function_call renders as a tool card instead of raw JSON text', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const event = {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'function_call',
      item: {
        type: 'function_call',
        name: 'update_plan',
        callId: 'call-plan-live-1',
        arguments: {
          explanation: '实时更新计划',
          plan: [{ step: '修复 Codex WS update 渲染', status: 'in_progress' }],
        },
      },
    },
  };

  const result = reduceNativeRuntimeEvent([], event);
  const assistantMessages = result.filter((m) => m.type === 'assistant');

  assert.equal(assistantMessages.length, 1, 'update_plan function_call must produce one assistant tool message');
  assert.equal(assistantMessages[0].isToolUse, true, 'update_plan must be marked as tool use');
  assert.equal(assistantMessages[0].toolName, 'update_plan', 'tool renderer must receive update_plan name');
  assert.equal(assistantMessages[0].toolCallId, 'call-plan-live-1', 'camelCase callId must become stable toolCallId');
  assert.equal(assistantMessages[0].content, '', 'tool calls must not render their JSON input as assistant text');
  assert.match(
    String(assistantMessages[0].toolInput),
    /修复 Codex WS update 渲染/,
    'structured plan payload must stay in toolInput for the plan renderer',
  );
});

test('Codex realtime update wrapper renders nested functionCall as a tool card', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const event = {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'update',
      item: {
        type: 'functionCall',
        id: 'call-plan-update-wrapper',
        name: 'update_plan',
        arguments: {
          plan: [{ step: '解包 Codex update 事件', status: 'completed' }],
        },
      },
    },
  };

  const result = reduceNativeRuntimeEvent([], event);
  const assistantMessages = result.filter((m) => m.type === 'assistant');

  assert.equal(assistantMessages.length, 1, 'update wrapper must produce one assistant tool message');
  assert.equal(assistantMessages[0].isToolUse, true, 'nested functionCall must be marked as tool use');
  assert.equal(assistantMessages[0].toolName, 'update_plan');
  assert.equal(assistantMessages[0].toolCallId, 'call-plan-update-wrapper');
  assert.equal(assistantMessages[0].content, '', 'update JSON must not be rendered as assistant text');
  assert.match(String(assistantMessages[0].toolInput), /解包 Codex update 事件/);
});

test('Codex realtime agent_message update JSON is rerouted to a tool card', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const event = {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'agent-json-update',
      message: {
        role: 'assistant',
        content: JSON.stringify({
          type: 'update',
          item: {
            type: 'functionCall',
            callId: 'call-plan-agent-json',
            name: 'update_plan',
            arguments: {
              explanation: '不要把 update JSON 当正文',
              plan: [{ step: '渲染工具卡片', status: 'completed' }],
            },
          },
        }),
      },
    },
  };

  const result = reduceNativeRuntimeEvent([], event);
  const assistantMessages = result.filter((m) => m.type === 'assistant');

  assert.equal(assistantMessages.length, 1, 'agent_message update JSON must produce one assistant tool message');
  assert.equal(assistantMessages[0].isToolUse, true);
  assert.equal(assistantMessages[0].toolName, 'update_plan');
  assert.equal(assistantMessages[0].toolCallId, 'call-plan-agent-json');
  assert.equal(assistantMessages[0].content, '', 'raw update JSON must not remain visible as assistant text');
  assert.match(String(assistantMessages[0].toolInput), /不要把 update JSON 当正文/);
});

test('Codex WebSocket handler forwards function_call items to the native live reducer', async () => {
  const source = await readRepoFile('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
  const liveTypesBlock = source.match(/const CODEX_LIVE_ITEM_TYPES = \[[^\]]+\]/)?.[0] || '';

  assert.ok(liveTypesBlock.includes("'function_call'"), 'handler must accept Codex function_call live items');
  assert.ok(
    liveTypesBlock.includes("'function_call_output'"),
    'handler must accept Codex function_call_output live items',
  );
  assert.ok(liveTypesBlock.includes("'update'"), 'handler must accept Codex update live item wrappers');
  assert.ok(
    source.includes('reduceNativeRuntimeEvent(previous, latestMessage as Record<string, unknown>)'),
    'accepted Codex live items must flow through the shared native reducer',
  );
});

test('Codex realtime mcp tool output normalizes object arrays to text', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const event = {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'mcp_tool_call',
      itemId: 'mcp-write-1',
      tool: 'functions.write_stdin',
      arguments: { session_id: 41605, chars: '' },
      result: [
        { content: 'line one' },
        { output: 'line two' },
      ],
      status: 'completed',
    },
  };

  const result = reduceNativeRuntimeEvent([], event);
  const assistantMessages = result.filter((m) => m.type === 'assistant');

  assert.equal(assistantMessages.length, 1, 'mcp tool event must produce one live assistant message');
  assert.equal(assistantMessages[0].toolResult?.content, 'line one\nline two');
  assert.ok(
    !String(assistantMessages[0].toolResult?.content).includes('[object Object]'),
    'live tool result must not stringify structured objects as [object Object]',
  );
});

test('session refresh preserves native live rows until provider transcript catches up', async () => {
  const { mergePersistedAndOptimisticMessages } = await loadSessionMergeModule();
  const liveMessages: ChatMessageLike[] = [
    {
      type: 'assistant',
      content: 'Codex is still streaming',
      provider: 'codex',
      source: 'codex-live',
      messageKey: 'codex:msg-1',
    },
    {
      type: 'assistant',
      provider: 'pi',
      source: 'pi-live',
      messageKey: 'pi:tool-1',
      isToolUse: true,
      toolName: 'Bash',
      toolInput: { command: 'pwd' },
      toolResult: { content: '/tmp/project' },
    },
  ];

  const merged = mergePersistedAndOptimisticMessages([], liveMessages);

  assert.equal(merged.length, 2, 'empty or stale persisted refresh must not erase live native rows');
  assert.deepEqual(
    merged.map((message) => message.messageKey),
    ['codex:msg-1', 'pi:tool-1'],
    'Codex and Pi live rows must remain visible across refresh',
  );
});

test('Codex complete refresh preserves live rows until provider JSONL catches up', async () => {
  const source = await readRepoFile('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
  const codexCompleteBlock = source.match(/case 'codex-complete': \{[\s\S]*?break;/)?.[0] || '';

  assert.ok(codexCompleteBlock, 'codex-complete handler must exist');
  assert.deepEqual(
    [...codexCompleteBlock.matchAll(/preserveLiveMessages:\s*(true|false)/g)].map((match) => match[1]),
    ['true', 'true'],
    'completion reloads must keep live reasoning/tool rows visible while persisted history catches up',
  );
});

test('session messages handler checks live snapshot before JSONL when providerSessionId is bound', async () => {
  const source = await readRepoFile('backend/session-messages-handler.ts');
  const cNBlock = source.match(/if \(isCbwRouteSessionId\(sessionId\)\) \{[\s\S]*?\n\s*\}\s*\n\s*if \(!resolvedProvider\)/)?.[0] || '';
  assert.ok(cNBlock, 'cN route block must exist');

  const liveSnapshotIdx = cNBlock.indexOf('getNativeSessionLiveTranscript');
  const providerSessionIdIdx = cNBlock.indexOf('providerSessionId');
  assert.ok(liveSnapshotIdx >= 0, 'handler must call getNativeSessionLiveTranscript');
  assert.ok(providerSessionIdIdx >= 0, 'handler must reference providerSessionId');
  assert.ok(liveSnapshotIdx < providerSessionIdIdx, 'live snapshot must be checked before providerSessionId JSONL fallback');
});

test('getNativeSessionLiveTranscript returns live transcript only for running sessions; completed Pi sessions use getPiSessionCompletedSnapshot bridge', async () => {
  const source = await readRepoFile('backend/native-agent-runtime.ts');
  const fnBlock = source.match(/export function getNativeSessionLiveTranscript[\s\S]*?^\}/m)?.[0] || '';
  assert.ok(fnBlock, 'getNativeSessionLiveTranscript must exist');
  // The function must guard on session.status and only return for running sessions.
  assert.match(
    fnBlock,
    /session\.status/,
    'getNativeSessionLiveTranscript must check session.status',
  );
  // The function must no longer reference lastCompletedLiveMessages;
  // that bridge is now in getPiSessionCompletedSnapshot.
  assert.doesNotMatch(
    fnBlock,
    /lastCompletedLiveMessages/,
    'getNativeSessionLiveTranscript must NOT reference lastCompletedLiveMessages (moved to getPiSessionCompletedSnapshot)',
  );
  // getPiSessionCompletedSnapshot is the new bridge for completed Pi sessions.
  assert.match(
    source,
    /export function getPiSessionCompletedSnapshot/,
    'getPiSessionCompletedSnapshot must exist as the snapshot bridge for completed Pi sessions',
  );
  assert.match(
    source,
    /export function clearPiSessionSnapshot/,
    'clearPiSessionSnapshot must exist to clear the snapshot after successful JSONL read',
  );
  // clearPiSessionSnapshot must set lastCompletedLiveMessages to null.
  assert.match(
    source,
    /lastCompletedLiveMessages = null/,
    'clearPiSessionSnapshot must set lastCompletedLiveMessages to null',
  );
});

test('completed sessions clear liveMessages so reconcile reads provider JSONL', async () => {
  const source = await readRepoFile('backend/native-agent-runtime.ts');
  // Codex finally block
  assert.match(
    source,
    /session\.status = 'completed';\s*\n\s*session\.liveMessages = \[\];/,
    'Codex completion must clear liveMessages',
  );
  // Pi agent_end block
  assert.match(
    source,
    /session\.status = 'completed';\s*\n\s*session\.liveMessages = \[\];/,
    'Pi completion must clear liveMessages',
  );
});

test('live response blocks do not use JSONL reload as the primary render path', async () => {
  const source = await readRepoFile('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
  // Only check the live response block itself (up to its break;), not the complete/error reload paths.
  const codexBlock = source.match(/case 'codex-response': \{[\s\S]*?break;/)?.[0] || '';
  const piBlock = source.match(/case 'pi-response': \{[\s\S]*?break;/)?.[0] || '';

  assert.ok(codexBlock, 'codex-response handler must exist');
  assert.ok(piBlock, 'pi-response handler must exist');
  assert.doesNotMatch(
    codexBlock,
    /reloadCodexSessionMessages/,
    'Codex live assistant events must render from SDK events, not by debounced JSONL reload',
  );
  assert.doesNotMatch(
    piBlock,
    /reloadCodexSessionMessages/,
    'Pi live assistant events must render from SDK events, not by debounced JSONL reload',
  );
});

test('error and abort handlers reconcile provider history after lifecycle ends', async () => {
  const source = await readRepoFile('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');

  const codexErrorBlock = source.match(/case 'codex-error':[\s\S]*?break;/)?.[0] || '';
  const piErrorBlock = source.match(/case 'pi-error':[\s\S]*?break;/)?.[0] || '';
  const sessionAbortedBlock = source.match(/case 'session-aborted':[\s\S]*?break;/)?.[0] || '';

  assert.ok(codexErrorBlock.includes('reloadCodexSessionMessages'), 'codex-error must reload provider history');
  assert.ok(piErrorBlock.includes('reloadCodexSessionMessages'), 'pi-error must reload provider history');
  assert.ok(sessionAbortedBlock.includes('reloadCodexSessionMessages'), 'session-aborted must reload provider history');
});

test('pi-complete uses a delayed retry so JSONL flush lag does not erase manual messages', async () => {
  const source = await readRepoFile('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
  const piCompleteBlock = source.match(/case 'pi-complete':[\s\S]*?break;/)?.[0] || '';

  assert.ok(piCompleteBlock.includes('reloadCodexSessionMessages'), 'pi-complete must reload provider history');
  assert.ok(piCompleteBlock.includes('window.setTimeout'), 'pi-complete must retry after Pi JSONL flush lag');
  assert.ok(
    piCompleteBlock.includes('latestMessage.actualSessionId') && piCompleteBlock.includes('pendingViewSessionRef.current?.sessionId'),
    'pi-complete retry must target the provider id or pending manual session id',
  );
});

test('Pi cN sends resume through the bound provider session id', async () => {
  const serverSource = await readRepoFile('backend/index.ts');
  const piCommandBlock = serverSource.match(/} else if \(data\.type === 'pi-command'\) \{[\s\S]*?Do NOT duplicate error\/accepted sends here\./)?.[0] || '';
  const runtimeSource = await readRepoFile('backend/native-agent-runtime.ts');
  const piEnsureBlock = runtimeSource.match(/if \(provider === 'pi'\) \{[\s\S]*?await ensurePiSession\(session, \{[\s\S]*?\}\);/)?.[0] || '';

  assert.ok(
    piCommandBlock.includes("providerSessionId: piManualRuntime?.providerSessionId || ''"),
    'server pi-command must pass the cN-bound provider session id into native runtime',
  );
  assert.ok(
    piEnsureBlock.includes('sessionId: input.providerSessionId || sessionId'),
    'native Pi runtime must open the provider transcript id instead of the cN route id',
  );
});
