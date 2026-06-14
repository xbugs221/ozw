// @ts-nocheck -- Spec fixture exercises Codex WS event shapes that vary by provider SDK version.
/**
 * Sources: 2026-06-11-98-稳定Codex流式和ToolCall渲染
 *
 * PURPOSE: Verify Codex streaming drafts accumulate as visible live text and
 * completed final assistant content confirms one stable paragraph.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

/**
 * Import the production live reducer and renderable filter.
 */
async function loadNativeTranscriptModule() {
  const mod = await import(pathToFileURL(`${process.cwd()}/frontend/components/chat/utils/nativeRuntimeTranscript.ts`).href);
  assert.equal(typeof mod.reduceNativeRuntimeEvent, 'function');
  assert.equal(typeof mod.filterRenderableMessages, 'function');
  return mod;
}

/**
 * Flatten user-visible text from frontend chat message content.
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

test('Codex streaming deltas accumulate visibly until completed final text is stable', async () => {
  const { reduceNativeRuntimeEvent, filterRenderableMessages } = await loadNativeTranscriptModule();
  let messages = [
    {
      type: 'user',
      content: 'stream this answer',
      turnAnchorKey: 'turn-stream',
      deliveryStatus: 'sent',
    },
  ];

  messages = reduceNativeRuntimeEvent(messages, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'assistant-stream-1',
      status: 'in_progress',
      message: { role: 'assistant' },
      delta: { text: 'The final ' },
    },
  });
  messages = reduceNativeRuntimeEvent(messages, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'assistant-stream-1',
      status: 'in_progress',
      message: { role: 'assistant' },
      delta: { text: 'paragraph stays.' },
    },
  });

  assert.deepEqual(
    filterRenderableMessages(messages).map((message) => visibleText(message.content)),
    ['stream this answer', 'The final paragraph stays.'],
    'unfinished Codex deltas must accumulate in one visible live assistant row',
  );

  messages = reduceNativeRuntimeEvent(messages, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'assistant-stream-1',
      status: 'completed',
      message: { role: 'assistant', content: 'The final paragraph stays.' },
    },
  });

  assert.deepEqual(
    filterRenderableMessages(messages).map((message) => visibleText(message.content)),
    ['stream this answer', 'The final paragraph stays.'],
    'completed Codex event must reveal one stable assistant paragraph',
  );
});
