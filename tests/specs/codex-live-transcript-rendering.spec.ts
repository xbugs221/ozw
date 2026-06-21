// @ts-nocheck -- Spec fixture exercises native runtime event shapes that vary by provider SDK version.
/**
 * Sources: 2026-06-08-88-修复Codex-WS-live文件操作与思考块闪烁
 *
 * PURPOSE: Verify Codex WebSocket live transcript classification keeps file
 * operations as FileChanges cards, preserves ordinary business JSON, and
 * renders reasoning as thinking rows on first display.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

/**
 * Import the production live reducer so the spec covers the real WS-to-chat
 * classification boundary.
 */
async function loadNativeTranscriptModule() {
  const mod = await import(pathToFileURL(`${process.cwd()}/frontend/components/chat/utils/nativeRuntimeTranscript.ts`).href);
  assert.equal(typeof mod.reduceNativeRuntimeEvent, 'function');
  return mod;
}

/**
 * Import the production session merge so live FileChanges and JSONL replay
 * convergence stays covered by the stable spec suite.
 */
async function loadSessionMergeModule() {
  const mod = await import(pathToFileURL(`${process.cwd()}/frontend/components/chat/utils/sessionMessageMerge.ts`).href);
  assert.equal(typeof mod.mergePersistedAndOptimisticMessages, 'function');
  return mod;
}

/**
 * Flatten user-visible text from the message shapes used by frontend chat.
 */
function visibleText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(visibleText).join('');
  if (typeof value === 'object') {
    return visibleText(value.text ?? value.content ?? value.output ?? value.result ?? JSON.stringify(value));
  }
  return String(value);
}

/**
 * Assert the message will render through the FileChanges tool-card branch.
 */
function assertFileChangesCard(message, expectedPath) {
  assert.ok(message, 'file operation must produce one message');
  assert.equal(message.type, 'assistant');
  assert.equal(message.isToolUse, true);
  assert.equal(message.toolName, 'FileChanges');
  assert.match(visibleText(message.toolInput), new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(visibleText(message.content), /"changes"|"kind"|"path"|"diff"/);
}

test('Codex live file_change changes array renders as a FileChanges card', async () => {
  /**
   * Direct file_change payloads are the native Codex file-operation path; they
   * must not leak protocol JSON into assistant text.
   */
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();

  const messages = reduceNativeRuntimeEvent([], {
    type: 'codex-response',
    sessionId: 'codex-live-rendering-spec',
    data: {
      type: 'item',
      itemType: 'file_change',
      itemId: 'spec-file-change',
      changes: [{ kind: 'update', path: 'src/live-update.ts', diff: '@@ -1 +1 @@' }],
      status: 'completed',
    },
  });

  assert.equal(messages.length, 1);
  assertFileChangesCard(messages[0], 'src/live-update.ts');
});

test('Codex live custom apply_patch call renders as a FileChanges card', async () => {
  /**
   * apply_patch can arrive as a custom_tool_call with its patch text in input;
   * that shape must use the same FileChanges card as JSONL replay.
   */
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();

  const messages = reduceNativeRuntimeEvent([], {
    type: 'codex-response',
    sessionId: 'codex-live-rendering-spec',
    data: {
      type: 'item',
      itemType: 'custom_tool_call',
      itemId: 'spec-custom-patch',
      item: {
        type: 'custom_tool_call',
        name: 'apply_patch',
        call_id: 'spec-custom-patch',
        input: [
          '*** Begin Patch',
          '*** Update File: src/live-custom-patch.ts',
          '@@',
          '-old',
          '+new',
          '*** End Patch',
        ].join('\n'),
      },
      status: 'completed',
    },
  });

  assert.equal(messages.length, 1);
  assertFileChangesCard(messages[0], 'src/live-custom-patch.ts');
});

test('Codex split file-operation JSON converts to one FileChanges card', async () => {
  /**
   * Streaming JSON can be incomplete at first. Once complete, the transcript
   * must replace the raw text row with the stable tool-card representation.
   */
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  let messages = [];

  messages = reduceNativeRuntimeEvent(messages, {
    type: 'codex-response',
    sessionId: 'codex-live-rendering-spec',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'spec-split-json',
      status: 'in_progress',
      delta: { text: '{"type":"update",' },
      message: { role: 'assistant' },
    },
  });

  messages = reduceNativeRuntimeEvent(messages, {
    type: 'codex-response',
    sessionId: 'codex-live-rendering-spec',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'spec-split-json',
      status: 'in_progress',
      delta: { text: '"path":"src/split-update.ts"}' },
      message: { role: 'assistant' },
    },
  });

  assert.equal(messages.length, 1);
  assertFileChangesCard(messages[0], 'src/split-update.ts');
});

test('Codex displayText file-operation JSON converts to FileChanges card', async () => {
  /**
   * Some live provider envelopes place the visible text mirror in displayText.
   * The file-operation renderer and filter must share that same envelope chain
   * so bookkeeping JSON is shown as a FileChanges card instead of disappearing.
   */
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();

  const messages = reduceNativeRuntimeEvent([], {
    type: 'codex-response',
    sessionId: 'codex-live-rendering-spec',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'spec-display-text-json',
      message: {
        role: 'assistant',
        content: {
          displayText: JSON.stringify({ kind: 'update', path: 'src/display-text-update.ts' }),
        },
      },
    },
  });

  assert.equal(messages.length, 1);
  assertFileChangesCard(messages[0], 'src/display-text-update.ts');
});

test('Codex business JSON remains assistant text', async () => {
  /**
   * User-requested JSON may contain path-like fields. It remains ordinary
   * assistant content unless it matches a file-operation contract.
   */
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();

  const messages = reduceNativeRuntimeEvent([], {
    type: 'codex-response',
    sessionId: 'codex-live-rendering-spec',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'spec-business-json',
      message: {
        role: 'assistant',
        content: JSON.stringify({ type: 'report', path: 'roadmap.json', content: '业务 JSON 输出必须保留' }),
      },
    },
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].isToolUse, undefined);
  assert.equal(messages[0].isThinking, undefined);
  assert.match(visibleText(messages[0].content), /业务 JSON 输出必须保留/);
});

test('Codex reasoning with same provider item id stays a separate thinking row', async () => {
  /**
   * Reasoning must not reuse and reclassify an existing assistant text row,
   * because that creates a visible style flip in the live transcript.
   */
  const { reduceNativeRuntimeEvent } = await loadNativeTranscriptModule();
  let messages = [];

  messages = reduceNativeRuntimeEvent(messages, {
    type: 'codex-response',
    sessionId: 'codex-live-rendering-spec',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'spec-same-item',
      message: { role: 'assistant', content: '普通正文' },
    },
  });

  messages = reduceNativeRuntimeEvent(messages, {
    type: 'codex-response',
    sessionId: 'codex-live-rendering-spec',
    data: {
      type: 'item',
      itemType: 'reasoning',
      itemId: 'spec-same-item',
      message: { role: 'assistant', content: '思考内容' },
    },
  });

  const assistantTextRows = messages.filter((message) => message.type === 'assistant' && !message.isThinking && !message.isToolUse);
  const thinkingRows = messages.filter((message) => message.isThinking);

  assert.equal(assistantTextRows.length, 1);
  assert.equal(thinkingRows.length, 1);
  assert.match(visibleText(assistantTextRows[0].content), /普通正文/);
  assert.match(visibleText(thinkingRows[0].content), /思考内容/);
  assert.equal(thinkingRows[0].isToolUse, undefined);
});

test('Codex live FileChanges converges with JSONL replay without duplicate cards', async () => {
  /**
   * A live file_change card and the persisted FileChanges replay represent one
   * operation when they share the same tool id, so the final transcript keeps
   * only one card.
   */
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
    sessionId: 'codex-live-rendering-spec',
    data: {
      type: 'item',
      itemType: 'file_change',
      itemId: 'spec-converged-file-change',
      changes: [{ kind: 'update', path: 'src/converged-update.ts' }],
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
        changes: [{ kind: 'edit', path: 'src/converged-update.ts' }],
      },
      toolId: 'spec-converged-file-change',
      toolCallId: 'spec-converged-file-change',
      toolResult: { content: '', isError: false, status: 'completed' },
    },
  ];

  const merged = mergePersistedAndOptimisticMessages(
    persistedMessages,
    liveMessages,
    { sessionId: 'codex-live-rendering-spec' },
  );
  const fileCards = merged.filter((message) => message.isToolUse && message.toolName === 'FileChanges');

  assert.equal(merged.length, 2);
  assert.equal(fileCards.length, 1);
});
