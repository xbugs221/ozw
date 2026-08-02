/**
 * PURPOSE: Verify the shared backend fixture shuts down without retaining its
 * force-kill timer when a child exits during listener registration.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { stopBackendServerFixture } from './helpers/backend-service-fixture.ts';

test('fixture shutdown closes the pre-listener exit race without waiting for force-kill', async () => {
  /** Simulate a child that exits between the initial state read and listener installation. */
  const child = new EventEmitter() as EventEmitter & {
    readonly exitCode: number | null;
    readonly signalCode: NodeJS.Signals | null;
    kill: (signal?: NodeJS.Signals) => boolean;
  };
  let exitCodeReads = 0;
  let killCalls = 0;
  Object.defineProperties(child, {
    exitCode: {
      get: () => (exitCodeReads++ === 0 ? null : 0),
    },
    signalCode: {
      get: () => null,
    },
  });
  child.kill = () => {
    killCalls += 1;
    return true;
  };

  const startedAt = performance.now();
  await stopBackendServerFixture({ child });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(killCalls, 0, 'an already-exited child must not receive SIGTERM');
  assert.ok(elapsedMs < 100, `shutdown must finish immediately, received ${elapsedMs.toFixed(2)} ms`);
  assert.equal(child.listenerCount('exit'), 0, 'the completed shutdown must remove its exit listener');
});
