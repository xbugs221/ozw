/**
 * PURPOSE: Verify that Pi (and Codex) realtime streaming messages produce the
 * same type contract as persisted messages after refresh, so
 * MessageComponent renders them consistently.
 */

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const REPO_ROOT = process.cwd();

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

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
};

type NativeTranscriptModule = {
  reduceNativeRuntimeEvent: (messages: ChatMessageLike[], event: Record<string, unknown>) => ChatMessageLike[];
};

async function loadNativeTranscriptModule(): Promise<NativeTranscriptModule> {
  const modulePath = path.join(REPO_ROOT, 'frontend/components/chat/utils/nativeRuntimeTranscript.ts');
  const mod = await import(pathToFileURL(modulePath).href) as Partial<NativeTranscriptModule>;
  assert.equal(typeof mod.reduceNativeRuntimeEvent, 'function', 'nativeRuntimeTranscript.ts must export reduceNativeRuntimeEvent');
  return mod as NativeTranscriptModule;
}

function extractMessageText(message: ChatMessageLike | undefined): string {
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

function extractThinkingBlock(source: string): string {
  const start = source.indexOf('message.isThinking ?');
  const end = source.indexOf('\n            ) : (', start > 0 ? start : 0);
  return source.slice(Math.max(0, start), end > 0 ? end : source.length);
}

test('Pi reasoning delta returns type assistant with isThinking flag', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const firstDelta = {
    type: 'pi-response',
    sessionId: 'pi-live-session',
    data: {
      type: 'item',
      itemType: 'reasoning',
      itemId: 'pi-reason-1',
      status: 'in_progress',
      delta: { text: 'Let me think' },
      message: { role: 'assistant', isReasoning: true },
    },
  };
  const secondDelta = {
    ...firstDelta,
    data: {
      ...firstDelta.data,
      delta: { text: ' about this step' },
      message: { role: 'assistant', isReasoning: true },
    },
  };

  const afterFirst = reduceNativeRuntimeEvent([], firstDelta);
  const afterSecond = reduceNativeRuntimeEvent(afterFirst, secondDelta);
  const assistantMessages = afterSecond.filter((message) => message.type === 'assistant');

  assert.equal(assistantMessages.length, 1, 'reasoning delta must produce exactly one assistant message');
  assert.equal(assistantMessages[0].isThinking, true, 'reasoning message must have isThinking === true');
  assert.equal(extractMessageText(assistantMessages[0]), 'Let me think about this step');
});

test('Pi tool_call and tool_result return type assistant with isToolUse flag', async () => {
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

  assert.equal(assistantMessages.length, 1, 'tool events must produce exactly one assistant message');
  assert.equal(assistantMessages[0].isToolUse, true, 'tool message must have isToolUse === true');
  assert.equal(assistantMessages[0].toolName, 'read_file');
});

test('Codex reasoning item returns type assistant with isThinking flag', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const event = {
    type: 'codex-response',
    sessionId: 'codex-live-session',
    data: {
      type: 'item',
      itemType: 'reasoning',
      itemId: 'codex-reason-1',
      message: { role: 'assistant', content: 'Analyzing codebase structure...', isReasoning: true },
    },
  };

  const result = reduceNativeRuntimeEvent([], event);
  const assistantMessages = result.filter((message) => message.type === 'assistant');

  assert.equal(assistantMessages.length, 1, 'Codex reasoning item must produce exactly one assistant message');
  assert.equal(assistantMessages[0].isThinking, true, 'Codex reasoning message must have isThinking === true');
});

test('MessageComponent renders isThinking with body-style Markdown chrome', async () => {
  const source = await readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  const isThinkingBranch = source.match(/message\.isThinking\s*\?\s*\(/s)?.[0];
  assert.ok(isThinkingBranch, 'MessageComponent must have a branch keyed on message.isThinking');

  const thinkingBlock = extractThinkingBlock(source);
  assert.match(
    thinkingBlock,
    /className="text-sm text-gray-700 dark:text-gray-300"/,
    'isThinking branch must use the same text size and color as assistant body text',
  );
  assert.doesNotMatch(
    thinkingBlock,
    /<details|<summary|border-l-2|pl-4|italic|text-gray-600 dark:text-gray-400/,
    'isThinking branch must not render the old fold or gray left-rail chrome',
  );
  assert.ok(thinkingBlock.includes('<Markdown'), 'isThinking branch must render content through <Markdown>');
});

test('MessageComponent renders isToolUse with ToolRenderer, no tool icon', async () => {
  const source = await readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  const isToolUseBranch = source.match(/message\.isToolUse\s*\?\s*\(/s)?.[0];
  assert.ok(isToolUseBranch, 'MessageComponent must have a branch keyed on message.isToolUse');

  const toolBlock = source.match(/message\.isToolUse\s*\?\s*\([\s\S]*?\) :\s*message\./s)?.[0] || '';
  assert.ok(toolBlock.includes('ToolRenderer'), 'isToolUse branch must render <ToolRenderer>');
  assert.ok(!toolBlock.includes('\uD83D\uDD27'), 'isToolUse branch must not show the tool emoji icon');
});

test('Realtime assistant type contract avoids stale tool icon and reaches correct render branches', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const source = await readRepoFile('frontend/components/chat/view/subcomponents/MessageComponent.tsx');

  // 1. Verify reducer outputs assistant type for both reasoning and tool
  const reasoningMsg = reduceNativeRuntimeEvent([], {
    type: 'pi-response',
    sessionId: 'pi-branch-session',
    data: {
      type: 'item',
      itemType: 'reasoning',
      itemId: 'reason-1',
      message: { role: 'assistant', content: 'Thinking...' },
    },
  })[0];
  const toolMsg = reduceNativeRuntimeEvent([], {
    type: 'pi-response',
    sessionId: 'pi-branch-session',
    data: {
      type: 'item',
      itemType: 'tool_call',
      itemId: 'tool-1',
      tool: 'read_file',
      status: 'running',
    },
  })[0];

  assert.equal(reasoningMsg.type, 'assistant', 'reasoning must map to assistant type');
  assert.equal(reasoningMsg.isThinking, true, 'reasoning must set isThinking');
  assert.equal(toolMsg.type, 'assistant', 'tool must map to assistant type');
  assert.equal(toolMsg.isToolUse, true, 'tool must set isToolUse');

  // 2. Verify MessageComponent branch ordering: isToolUse before isThinking
  const isToolUseIndex = source.indexOf('message.isToolUse ?');
  const isThinkingIndex = source.indexOf('message.isThinking ?');
  assert.ok(isToolUseIndex > 0, 'MessageComponent must check isToolUse');
  assert.ok(isThinkingIndex > 0, 'MessageComponent must check isThinking');
  assert.ok(isToolUseIndex < isThinkingIndex, 'isToolUse must be evaluated before isThinking');

  // 3. Verify 🔧 icon and type==='tool' guard have been removed (53号提案清理旧外壳)
  assert.ok(!source.includes('\uD83D\uDD27'), 'tool emoji must no longer appear anywhere in MessageComponent');
  assert.ok(!source.includes("message.type === 'tool'"), "MessageComponent must not retain type==='tool' guard");
});
