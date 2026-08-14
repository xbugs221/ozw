/**
 * PURPOSE: Prove slow Provider watcher readiness is background work and cannot
 * delay the HTTP listening or health-check contract.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { scheduleProviderWatchersAfterListen } from '../../backend/server/startup-background-work.ts';

/**
 * Advance one complete event-loop turn.
 */
function nextTurn(): Promise<void> {
  /** PURPOSE: Observe work explicitly deferred with setImmediate. */
  return new Promise((resolve) => setImmediate(resolve));
}

test('HTTP listening does not wait for Provider watcher ready', async () => {
  /** An unresolved watcher must start later and leave foreground work responsive. */
  let watcherStarted = false;
  let releaseWatcher: () => void = () => {};
  const watcherReady = new Promise<void>((resolve) => {
    releaseWatcher = resolve;
  });

  scheduleProviderWatchersAfterListen({
    setupProviderWatchers: async () => {
      watcherStarted = true;
      await watcherReady;
    },
    onError: (error) => assert.fail(`unexpected watcher error: ${String(error)}`),
  });

  assert.equal(watcherStarted, false, 'listener callback must finish before watcher setup starts');
  await nextTurn();
  assert.equal(watcherStarted, true, 'watcher setup should begin in the background');

  let foregroundTimerFired = false;
  await new Promise<void>((resolve) => setTimeout(() => {
    foregroundTimerFired = true;
    resolve();
  }, 0));
  assert.equal(foregroundTimerFired, true, 'unresolved watcher readiness must not block foreground work');
  releaseWatcher();
});

test('Provider watcher startup failures are reported without escaping background work', async () => {
  /** Optional realtime setup may fail while the already-listening service remains usable. */
  const expectedError = new Error('slow VPS watcher failed');
  const errors: unknown[] = [];
  scheduleProviderWatchersAfterListen({
    setupProviderWatchers: async () => {
      throw expectedError;
    },
    onError: (error) => errors.push(error),
  });

  await nextTurn();
  await nextTurn();
  assert.deepEqual(errors, [expectedError]);
});

test('server runtime schedules Provider watchers only from the listening callback', async () => {
  /** Keep the production wiring attached to the non-blocking scheduling contract. */
  const runtimeSource = await fs.readFile(
    path.join(process.cwd(), 'backend', 'server', 'server-runtime.impl.ts'),
    'utf8',
  );
  const listenOffset = runtimeSource.indexOf('server.listen(PORT, HOST');
  const scheduleOffset = runtimeSource.indexOf('scheduleProviderWatchersAfterListen({');

  assert.ok(listenOffset >= 0, 'server runtime must expose its listening boundary');
  assert.ok(scheduleOffset > listenOffset, 'Provider watcher setup must be scheduled after listening');
  assert.doesNotMatch(runtimeSource, /await\s+setupProjectsWatcher\s*\(/);
});
