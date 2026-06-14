/**
 * PURPOSE: Capture the business contract that Pi realtime messages and
 * refresh-loaded persisted messages render through the same chat UI semantics.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const REPO_ROOT = process.cwd();

type ChatMessageLike = {
  type?: string;
  content?: unknown;
  displayText?: unknown;
  provider?: string;
  source?: string;
  messageKey?: string;
  isThinking?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: { content?: unknown; isError?: boolean } | null;
  toolCallId?: unknown;
  exitCode?: unknown;
};

type NativeTranscriptModule = {
  reduceNativeRuntimeEvent: (messages: ChatMessageLike[], event: Record<string, unknown>) => ChatMessageLike[];
};

type MessageTransformsModule = {
  convertSessionMessages: (rawMessages: unknown[]) => ChatMessageLike[];
};

/**
 * Load the live transcript reducer from the real frontend source.
 */
async function loadNativeTranscriptModule(): Promise<NativeTranscriptModule> {
  const modulePath = path.join(REPO_ROOT, 'frontend/components/chat/utils/nativeRuntimeTranscript.ts');
  const mod = await import(pathToFileURL(modulePath).href) as Partial<NativeTranscriptModule>;
  assert.equal(typeof mod.reduceNativeRuntimeEvent, 'function', 'nativeRuntimeTranscript.ts must export reduceNativeRuntimeEvent');
  return mod as NativeTranscriptModule;
}

/**
 * Load the persisted transcript converter from the real frontend source.
 */
async function loadMessageTransformsModule(): Promise<MessageTransformsModule> {
  const modulePath = path.join(REPO_ROOT, 'frontend/components/chat/utils/messageTransforms.ts');
  const mod = await import(pathToFileURL(modulePath).href) as Partial<MessageTransformsModule>;
  assert.equal(typeof mod.convertSessionMessages, 'function', 'messageTransforms.ts must export convertSessionMessages');
  return mod as MessageTransformsModule;
}

/**
 * Convert mixed content shapes into visible text for contract comparison.
 */
function visibleText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(visibleText).join('');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return visibleText(record.text ?? record.content ?? record.output ?? record.result);
  }
  return String(value);
}

/**
 * Extract only the fields that decide which MessageComponent branch is visible.
 */
function renderContract(message: ChatMessageLike): Record<string, unknown> {
  return {
    type: message.type,
    isThinking: Boolean(message.isThinking),
    isToolUse: Boolean(message.isToolUse),
    content: visibleText(message.content),
    displayText: visibleText(message.displayText),
    toolName: message.toolName || '',
    toolInput: visibleText(message.toolInput),
    toolResult: visibleText(message.toolResult?.content),
  };
}

test('Pi realtime reasoning and persisted thinking share the same render contract', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const { convertSessionMessages } = await loadMessageTransformsModule();

  const liveMessages = reduceNativeRuntimeEvent([], {
    type: 'pi-response',
    sessionId: 'pi-render-parity',
    data: {
      type: 'item',
      itemType: 'reasoning',
      itemId: 'thinking-1',
      message: { role: 'assistant', content: 'Need to inspect the failing renderer.' },
    },
  });
  const persistedMessages = convertSessionMessages([
    {
      type: 'thinking',
      provider: 'pi',
      messageKey: 'thinking-1',
      timestamp: '2026-05-29T00:00:00.000Z',
      message: { role: 'assistant', content: 'Need to inspect the failing renderer.' },
    },
  ]);

  assert.equal(liveMessages.length, 1);
  assert.equal(persistedMessages.length, 1);
  assert.deepEqual(renderContract(liveMessages[0]), renderContract(persistedMessages[0]));
  assert.equal(liveMessages[0].type, 'assistant', 'realtime thinking must not use the stale reasoning type');
  assert.equal(liveMessages[0].isThinking, true, 'realtime thinking must use the same isThinking flag as refresh-loaded messages');
});

test('Pi realtime tool events and persisted tool records share one non-duplicating render contract', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const { convertSessionMessages } = await loadMessageTransformsModule();

  const afterToolCall = reduceNativeRuntimeEvent([], {
    type: 'pi-response',
    sessionId: 'pi-render-parity',
    data: {
      type: 'item',
      itemType: 'tool_call',
      itemId: 'tool-1',
      tool: 'read_file',
      arguments: { path: 'frontend/components/chat/view/subcomponents/MessageComponent.tsx' },
      status: 'running',
    },
  });
  const liveMessages = reduceNativeRuntimeEvent(afterToolCall, {
    type: 'pi-response',
    sessionId: 'pi-render-parity',
    data: {
      type: 'item',
      itemType: 'tool_result',
      itemId: 'tool-1',
      tool: 'read_file',
      result: 'MessageComponent renders the duplicated tool shell.',
      status: 'completed',
    },
  });
  const persistedMessages = convertSessionMessages([
    {
      type: 'tool_use',
      provider: 'pi',
      messageKey: 'tool-1',
      timestamp: '2026-05-29T00:00:00.000Z',
      toolName: 'read_file',
      toolCallId: 'tool-1',
      toolInput: { path: 'frontend/components/chat/view/subcomponents/MessageComponent.tsx' },
    },
    {
      type: 'tool_result',
      provider: 'pi',
      messageKey: 'tool-1-result',
      timestamp: '2026-05-29T00:00:01.000Z',
      toolCallId: 'tool-1',
      output: 'MessageComponent renders the duplicated tool shell.',
    },
  ]);

  assert.equal(liveMessages.length, 1);
  assert.equal(persistedMessages.length, 1);
  assert.deepEqual(renderContract(liveMessages[0]), renderContract(persistedMessages[0]));
  assert.equal(liveMessages[0].type, 'assistant', 'realtime tool messages must not use the stale tool type');
  assert.equal(visibleText(liveMessages[0].content), '', 'tool messages must not carry duplicate visible body content outside ToolRenderer');
  assert.equal(visibleText(liveMessages[0].displayText), '', 'tool messages must not carry duplicate display text outside ToolRenderer');
});

test('Codex persisted update JSON and realtime update wrapper share the tool render contract', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const { convertSessionMessages } = await loadMessageTransformsModule();
  const updatePayload = {
    type: 'update',
    item: {
      type: 'functionCall',
      id: 'call-plan-refresh-1',
      name: 'update_plan',
      arguments: {
        explanation: '刷新后不要显示 JSON 原文',
        plan: [{ step: '渲染 update_plan 工具卡', status: 'completed' }],
      },
    },
  };

  const liveMessages = reduceNativeRuntimeEvent([], {
    type: 'codex-response',
    sessionId: 'codex-render-parity',
    data: {
      type: 'item',
      itemType: 'update',
      item: updatePayload.item,
    },
  });
  const persistedMessages = convertSessionMessages([
    {
      type: 'assistant',
      provider: 'codex',
      messageKey: 'codex-update-json',
      timestamp: '2026-05-29T00:00:00.000Z',
      message: {
        role: 'assistant',
        content: JSON.stringify(updatePayload),
      },
    },
  ]);

  assert.equal(liveMessages.length, 1);
  assert.equal(persistedMessages.length, 1);
  assert.deepEqual(renderContract(liveMessages[0]), renderContract(persistedMessages[0]));
  assert.equal(persistedMessages[0].isToolUse, true, 'refresh-loaded update JSON must render as a tool card');
  assert.equal(persistedMessages[0].content, '', 'refresh-loaded update JSON must not render as assistant text');
});

test('MessageComponent has no visible stale tool shell or duplicate markdown body for isToolUse messages', async () => {
  const source = await readFile(
    path.join(REPO_ROOT, 'frontend/components/chat/view/subcomponents/MessageComponent.tsx'),
    'utf8',
  );
  const toolBranch = source.match(/message\.isToolUse\s*\?\s*\([\s\S]*?\)\s*:\s*message\.isInteractivePrompt/s)?.[0] || '';

  assert.ok(toolBranch.includes('<ToolRenderer'), 'isToolUse branch must render through ToolRenderer');
  assert.ok(!source.includes("message.type === 'tool'"), 'MessageComponent must not keep the old visible tool type shell');
  assert.ok(!toolBranch.includes('String(message.displayText'), 'isToolUse branch must not render duplicate displayText Markdown before ToolRenderer');
  assert.ok(!toolBranch.includes('String(message.content'), 'isToolUse branch must not render duplicate content Markdown before ToolRenderer');
  assert.ok(!toolBranch.includes('\uD83D\uDD27'), 'isToolUse branch must not show the stale tool emoji');
});

test('command_execution with output but no exitCode does not leak a second live-output pre outside ToolRenderer', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();

  const liveMessages = reduceNativeRuntimeEvent([], {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'command_execution',
      itemId: 'cmd-dup',
      command: 'pwd',
      output: '/tmp/project',
    },
  });

  assert.equal(liveMessages.length, 1);
  assert.equal(liveMessages[0].isToolUse, true, 'command_execution must be treated as a tool use');
  assert.equal(liveMessages[0].toolName, 'Bash', 'command_execution must map to Bash tool name');
  assert.equal(visibleText(liveMessages[0].toolResult), '/tmp/project', 'running output must live in toolResult so ToolRenderer can display it');
  assert.equal(liveMessages[0].exitCode, null, 'exitCode must be null while command is still running');
  assert.equal(visibleText(liveMessages[0].content), '', 'no duplicate visible body content outside ToolRenderer');

  const source = await readFile(
    path.join(REPO_ROOT, 'frontend/components/chat/view/subcomponents/MessageComponent.tsx'),
    'utf8',
  );
  assert.ok(!source.includes('data-testid="codex-tool-live-output"'), 'MessageComponent must not render an extra live-output <pre> outside ToolRenderer');
  assert.ok(!source.includes('getCodexLiveOutput'), 'getCodexLiveOutput helper must be removed after converging live output into ToolRenderer');
});
