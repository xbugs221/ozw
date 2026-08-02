/**
 * PURPOSE: Verify backend text delta batching before WebSocket delivery.
 */
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import test from 'node:test';
import {
  DEFAULT_STREAMING_DELTA_BATCH_MS,
  DEFAULT_STREAMING_FIRST_BATCH_MS,
  StreamingDeltaBatcher,
} from '../../backend/streaming-delta-batcher.ts';

/**
 * Return the nested delta text from a batched provider event.
 */
function deltaText(event: Record<string, any>): string {
  return String(event?.data?.delta?.text || '');
}

test('default cadence keeps the first visible batch below 100ms', async () => {
  let resolveFirstEvent: ((timestamp: number) => void) | null = null;
  const firstEvent = new Promise<number>((resolve) => {
    resolveFirstEvent = resolve;
  });
  const startedAt = performance.now();
  const batcher = new StreamingDeltaBatcher(() => resolveFirstEvent?.(performance.now()));

  assert.equal(DEFAULT_STREAMING_FIRST_BATCH_MS, 60);
  assert.ok(DEFAULT_STREAMING_FIRST_BATCH_MS < 100, 'configured first batch target must stay below 100ms');
  assert.equal(DEFAULT_STREAMING_DELTA_BATCH_MS, 200);
  batcher.enqueue({
    envelopeType: 'pi-response',
    sessionId: 'first-frame-session',
    itemType: 'agent_message',
    itemId: 'first-frame-message',
    text: 'visible',
  });
  const arrivedAt = await Promise.race([
    firstEvent,
    wait(DEFAULT_STREAMING_FIRST_BATCH_MS + 150).then(() => {
      throw new Error('first frame timer did not emit within its scheduling tolerance');
    }),
  ]);

  assert.ok(
    arrivedAt - startedAt <= DEFAULT_STREAMING_FIRST_BATCH_MS + 100,
    `first frame exceeded scheduling tolerance: ${arrivedAt - startedAt}ms`,
  );
  batcher.dispose();
});

test('appends multiple text deltas into one in-progress WebSocket item', async () => {
  const events: Array<Record<string, unknown>> = [];
  const batcher = new StreamingDeltaBatcher((event) => events.push(event), 20, 10);

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
  const batcher = new StreamingDeltaBatcher((event) => events.push(event), 20, 10);

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

test('sustained high-frequency deltas stay within a small frame budget', async () => {
  const events: Array<Record<string, unknown>> = [];
  let resolveFirstEvent: (() => void) | null = null;
  const firstEvent = new Promise<void>((resolve) => {
    resolveFirstEvent = resolve;
  });
  const batcher = new StreamingDeltaBatcher((event) => {
    events.push(event);
    if (events.length === 1) {
      resolveFirstEvent?.();
    }
  });
  const chunks = ['first'];

  batcher.enqueue({
    envelopeType: 'pi-response',
    sessionId: 'pi-sustained',
    itemType: 'agent_message',
    itemId: 'message-sustained',
    text: chunks[0],
  });
  await Promise.race([
    firstEvent,
    wait(DEFAULT_STREAMING_FIRST_BATCH_MS + 150).then(() => {
      throw new Error('sustained stream did not emit its first frame within scheduling tolerance');
    }),
  ]);
  assert.equal(events.length, 1, 'first visible frame should arrive before sustained batching');

  for (let index = 1; index <= 40; index += 1) {
    const chunk = `-${index}`;
    chunks.push(chunk);
    batcher.enqueue({
      envelopeType: 'pi-response',
      sessionId: 'pi-sustained',
      itemType: 'agent_message',
      itemId: 'message-sustained',
      text: chunk,
    });
    await wait(10);
  }
  await wait(230);

  assert.ok(events.length <= 3, `41 deltas produced ${events.length} WebSocket frames`);
  assert.equal(events.map((event) => deltaText(event as Record<string, any>)).join(''), chunks.join(''));
  batcher.dispose();
});

test('completion flushes tail text once and resets the next turn to first-frame cadence', async () => {
  const events: Array<Record<string, unknown>> = [];
  const batcher = new StreamingDeltaBatcher((event) => events.push(event));
  const input = {
    envelopeType: 'codex-response' as const,
    sessionId: 'codex-completion',
    itemType: 'agent_message' as const,
    itemId: 'message-completion',
  };

  batcher.enqueue({ ...input, text: 'tail-' });
  batcher.enqueue({ ...input, text: 'text' });
  batcher.flushSession(input.sessionId);
  assert.equal(events.length, 1);
  assert.equal(deltaText(events[0] as Record<string, any>), 'tail-text');

  batcher.enqueue({ ...input, text: 'next-turn' });
  await wait(90);
  assert.equal(events.length, 2, 'completed session should not retain the slower sustained cadence');
  assert.equal(deltaText(events[1] as Record<string, any>), 'next-turn');
  await wait(220);
  assert.equal(events.length, 2, 'cleared completion timer must not emit a duplicate frame');
  batcher.dispose();
});

test('dispose flushes pending text once and cancels delayed delivery', async () => {
  const events: Array<Record<string, unknown>> = [];
  const batcher = new StreamingDeltaBatcher((event) => events.push(event));
  batcher.enqueue({
    envelopeType: 'pi-response',
    sessionId: 'pi-dispose',
    itemType: 'reasoning',
    itemId: 'reasoning-dispose',
    text: 'pending-on-dispose',
  });

  batcher.dispose();
  assert.equal(events.length, 1);
  assert.equal(deltaText(events[0] as Record<string, any>), 'pending-on-dispose');
  await wait(90);
  assert.equal(events.length, 1);
});
