/**
 * PURPOSE: Verify backend text delta batching before WebSocket delivery.
 */
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import test from 'node:test';
import {
  DEFAULT_STREAMING_DELTA_BATCH_MS,
  StreamingDeltaBatcher,
} from '../../backend/streaming-delta-batcher.ts';

/**
 * Return the nested delta text from a batched provider event.
 */
function deltaText(event: Record<string, any>): string {
  return String(event?.data?.delta?.text || '');
}

test('default text delta batch window is one second', () => {
  assert.equal(DEFAULT_STREAMING_DELTA_BATCH_MS, 1000);
});

test('appends multiple text deltas into one in-progress WebSocket item', async () => {
  const events: Array<Record<string, unknown>> = [];
  const batcher = new StreamingDeltaBatcher((event) => events.push(event), 20);

  batcher.enqueue({
    envelopeType: 'pi-response',
    sessionId: 'pi-session-1',
    itemType: 'agent_message',
    itemId: 'message-1',
    text: 'Hel',
  });
  batcher.enqueue({
    envelopeType: 'pi-response',
    sessionId: 'pi-session-1',
    itemType: 'agent_message',
    itemId: 'message-1',
    text: 'lo',
  });

  assert.equal(events.length, 0, 'delta should wait for the batch window');
  await wait(35);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'pi-response');
  assert.equal((events[0].data as any).status, 'in_progress');
  assert.equal(deltaText(events[0] as Record<string, any>), 'Hello');
});

test('replace mode sends the latest cumulative provider text', async () => {
  const events: Array<Record<string, unknown>> = [];
  const batcher = new StreamingDeltaBatcher((event) => events.push(event), 20);

  batcher.enqueue({
    envelopeType: 'codex-response',
    sessionId: 'codex-session-1',
    itemType: 'agent_message',
    itemId: 'message-2',
    text: 'Hel',
    mode: 'replace',
  });
  batcher.enqueue({
    envelopeType: 'codex-response',
    sessionId: 'codex-session-1',
    itemType: 'agent_message',
    itemId: 'message-2',
    text: 'Hello',
    mode: 'replace',
  });

  await wait(35);

  assert.equal(events.length, 1);
  assert.equal(deltaText(events[0] as Record<string, any>), 'Hello');
});

test('flushAll emits pending text before completion or cleanup', () => {
  const events: Array<Record<string, unknown>> = [];
  const batcher = new StreamingDeltaBatcher((event) => events.push(event), 1000);

  batcher.enqueue({
    envelopeType: 'codex-response',
    sessionId: 'codex-session-2',
    itemType: 'reasoning',
    itemId: 'thinking-1',
    text: 'reasoning chunk',
  });
  batcher.flushAll();

  assert.equal(events.length, 1);
  assert.equal((events[0].data as any).itemType, 'reasoning');
  assert.equal((events[0].data as any).message.isReasoning, true);
  assert.equal(deltaText(events[0] as Record<string, any>), 'reasoning chunk');
});
