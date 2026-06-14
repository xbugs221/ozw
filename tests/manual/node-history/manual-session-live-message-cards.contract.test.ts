/**
 * PURPOSE: Lock the manual-session live rendering contract for Codex and Pi so
 * streaming assistant/tool cards stay visible before persisted history catches up.
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
  source?: string;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: { content?: unknown; isError?: boolean } | null;
  toolCallId?: unknown;
};

type NativeTranscriptModule = {
  reduceNativeRuntimeEvent: (
    messages: ChatMessageLike[],
    event: Record<string, unknown>,
  ) => ChatMessageLike[];
};

type SessionMergeModule = {
  mergePersistedAndOptimisticMessages: (
    persistedMessages: ChatMessageLike[],
    previousMessages: ChatMessageLike[],
    options?: { preservePreviousMessages?: boolean },
  ) => ChatMessageLike[];
};

/**
 * Read a repository file through the same root used by the project test runner.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Load the real live transcript reducer from frontend source.
 */
async function loadNativeTranscriptModule(): Promise<NativeTranscriptModule> {
  const modulePath = path.join(REPO_ROOT, 'frontend/components/chat/utils/nativeRuntimeTranscript.ts');
  const mod = await import(pathToFileURL(modulePath).href) as Partial<NativeTranscriptModule>;
  assert.equal(typeof mod.reduceNativeRuntimeEvent, 'function');
  return mod as NativeTranscriptModule;
}

/**
 * Load the real persisted/live merge helper from frontend source.
 */
async function loadSessionMergeModule(): Promise<SessionMergeModule> {
  const modulePath = path.join(REPO_ROOT, 'frontend/components/chat/utils/sessionMessageMerge.ts');
  const mod = await import(pathToFileURL(modulePath).href) as Partial<SessionMergeModule>;
  assert.equal(typeof mod.mergePersistedAndOptimisticMessages, 'function');
  return mod as SessionMergeModule;
}

/**
 * Convert nested content payloads into the visible text users inspect.
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

test('Codex and Pi realtime allowlists both accept tool_call and tool_result cards', async () => {
  const source = await readRepoFile('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');

  const codexAllowlist = source.match(/CODEX_LIVE_ITEM_TYPES\s*=\s*\[([^\]]+)\]/)?.[1] || '';
  const piAllowlist = source.match(/PI_LIVE_ITEM_TYPES\s*=\s*\[([^\]]+)\]/)?.[1] || '';

  for (const itemType of ['tool_call', 'tool_result', 'command_execution', 'agent_message']) {
    assert.match(codexAllowlist, new RegExp(`['"]${itemType}['"]`), `Codex realtime allowlist must include ${itemType}`);
    assert.match(piAllowlist, new RegExp(`['"]${itemType}['"]`), `Pi realtime allowlist must include ${itemType}`);
  }
});

test('Codex command output delta keeps the already visible command card input', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();

  const afterStarted = reduceNativeRuntimeEvent([], {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'command_execution',
      itemId: 'cmd-stream-1',
      command: 'pnpm test',
      output: '',
      status: 'running',
    },
  });

  const afterOutputDelta = reduceNativeRuntimeEvent(afterStarted, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'command_execution',
      itemId: 'cmd-stream-1',
      output: '1 test passed',
      status: 'running',
    },
  });

  assert.equal(afterOutputDelta.length, 1, 'same command item must stay in one card');
  assert.equal(afterOutputDelta[0].isToolUse, true, 'command item must remain a tool card');
  assert.match(visibleText(afterOutputDelta[0].toolInput), /pnpm test/, 'output delta must not clear the visible command');
  assert.equal(visibleText(afterOutputDelta[0].toolResult?.content), '1 test passed');
});

test('empty persisted reload preserves live manual-session message cards', async () => {
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  const { mergePersistedAndOptimisticMessages } = await loadSessionMergeModule();

  const liveMessages = reduceNativeRuntimeEvent([], {
    type: 'pi-response',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'pi-live-answer-1',
      message: { role: 'assistant', content: 'Streaming answer before JSONL catches up.' },
    },
  });

  const merged = mergePersistedAndOptimisticMessages([], liveMessages, {
    preservePreviousMessages: true,
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'pi-live');
  assert.equal(visibleText(merged[0].content), 'Streaming answer before JSONL catches up.');
});
