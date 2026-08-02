// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify Pi CLI status and probe performance through one real backend
 * fixture plus focused production-module checks, without exposing credentials.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  authenticateTestClient,
  startIsolatedBackendServer,
  stopBackendServerFixture,
} from './helpers/backend-service-fixture.ts';
import { writeFakeWorkflowTools } from './helpers/workflow-tools.ts';
import {
  checkCliAvailability,
  clearCliAvailabilityCacheForTest,
} from '../../backend/runtime-readiness.ts';

const CCFLOW_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../..',
);

/** Write one executable Pi fixture whose version probe can be delayed or failed. */
async function writeFakePi(binDir, body) {
  /** Keep fake provider behavior explicit so retry and event-loop assertions use real child processes. */
  const piPath = path.join(binDir, 'pi');
  await fs.writeFile(piPath, body, { mode: 0o755 });
  return piPath;
}

/** Request authenticated Pi status from a real isolated backend. */
async function fetchPiStatus(fixture, token) {
  /** Exercise the production route and authentication middleware together. */
  const response = await fetch(`${fixture.baseUrl}/api/cli/pi/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.ok, true);
  return response.json();
}

test('Pi CLI status preserves unavailable, available, and native-provider contracts in one backend fixture', async (t) => {
  /**
   * One server is sufficient because failed probes are deliberately retryable:
   * start without Pi, install the fake executable, then verify the warm route.
   */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-cli-status-'));
  const binDir = path.join(tempRoot, 'bin');
  const coHome = path.join(tempRoot, 'co');
  const databasePath = path.join(tempRoot, 'auth.db');
  await writeFakeWorkflowTools(binDir);
  await fs.mkdir(path.join(coHome, 'requests', 'pending'), { recursive: true });
  await fs.writeFile(path.join(binDir, 'co'), [
    '#!/bin/sh',
    'if [ "$1" = "doctor" ] && [ "$2" = "--json" ]; then',
    `  printf '%s\\n' '{"ok":true,"contract":"co-request-v1","version":"test","home":"${coHome}","providers":{"codex":true,"pi":false}}'`,
    '  exit 0',
    'fi',
    'exit 1',
  ].join('\n'), { mode: 0o755 });

  let fixture;
  try {
    fixture = await startIsolatedBackendServer({
      cwd: CCFLOW_ROOT,
      databasePath,
      env: {
        CCFLOW_CO_HOME: coHome,
        PATH: `${binDir}:/usr/bin:/usr/local/bin`,
      },
    });
    const { token } = await authenticateTestClient(fixture);

    await t.test('returns unavailable when Pi is absent', async () => {
      /** A missing executable must report an actionable error and no false auth state. */
      const data = await fetchPiStatus(fixture, token);
      assert.equal(data.available, false);
      assert.equal(data.commandPath, '');
      assert.equal(data.authenticated, null);
      assert.match(data.error, /not found|path/i);
    });

    await writeFakePi(binDir, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  echo "pi 0.74.0"',
      '  exit 0',
      'fi',
      'exit 0',
    ].join('\n'));

    await t.test('retries after installation and returns version without secrets', async () => {
      /** Failed discovery must not prevent Pi from becoming available in the same server process. */
      const data = await fetchPiStatus(fixture, token);
      assert.equal(data.available, true);
      assert.equal(data.commandPath, path.join(binDir, 'pi'));
      assert.equal(data.version, 'pi 0.74.0');
      assert.equal(data.authenticated, null);
      assert.equal(data.error, null);

      const sensitiveKeys = ['apiKey', 'api_key', 'token', 'secret', 'password', 'key'];
      for (const key of sensitiveKeys) {
        assert.equal(key in data, false, `must not expose ${key}`);
      }
      assert.doesNotMatch(JSON.stringify(data), /sk-/);
    });

    await t.test('does not use the legacy co provider gate or write requests', async () => {
      /** Native Pi availability remains independent of a false legacy co provider flag. */
      const data = await fetchPiStatus(fixture, token);
      assert.equal(data.available, true);
      const pendingFiles = await fs.readdir(path.join(coHome, 'requests', 'pending'));
      assert.equal(pendingFiles.length, 0);
    });
  } finally {
    await stopBackendServerFixture(fixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('Pi version probe stays asynchronous, coalesces concurrency, and caches only success', async (t) => {
  /** Slow fake Pi verifies the production probe path without backend fixture startup noise. */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-probe-'));
  const countPath = path.join(tempRoot, 'count');
  await writeFakePi(tempRoot, [
    '#!/bin/sh',
    `printf x >> '${countPath}'`,
    'sleep 0.15',
    'echo "pi performance test"',
  ].join('\n'));
  const env = { ...process.env, PATH: `${tempRoot}${path.delimiter}${process.env.PATH || ''}` };
  clearCliAvailabilityCacheForTest();

  try {
    let timerFired = false;
    setTimeout(() => { timerFired = true; }, 20);
    const [first, second] = await Promise.all([
      checkCliAvailability('pi', { env, timeoutMs: 1000 }),
      checkCliAvailability('pi', { env, timeoutMs: 1000 }),
    ]);
    assert.equal(timerFired, true, 'Pi probe must not block the Node event loop');
    assert.equal(first.available, true);
    assert.deepEqual(second, first);
    assert.equal((await fs.readFile(countPath, 'utf8')).length, 1, 'concurrent calls must share one process');

    const warmStartedAt = performance.now();
    await checkCliAvailability('pi', { env, timeoutMs: 1000 });
    const warmElapsedMs = performance.now() - warmStartedAt;
    assert.equal((await fs.readFile(countPath, 'utf8')).length, 1, 'warm success must not launch Pi again');
    t.diagnostic(`warm Pi availability lookup: ${warmElapsedMs.toFixed(2)} ms`);
  } finally {
    clearCliAvailabilityCacheForTest();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('failed Pi version probe is retried and can recover at the same path', async () => {
  /** A failed executable must never be retained in the successful probe cache. */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-probe-retry-'));
  const countPath = path.join(tempRoot, 'count');
  const env = { ...process.env, PATH: tempRoot };
  clearCliAvailabilityCacheForTest();

  try {
    await writeFakePi(tempRoot, [
      '#!/bin/sh',
      `printf x >> '${countPath}'`,
      'echo "controlled Pi failure" >&2',
      'exit 9',
    ].join('\n'));
    assert.equal((await checkCliAvailability('pi', { env })).available, false);
    assert.equal((await checkCliAvailability('pi', { env })).available, false);
    assert.equal((await fs.readFile(countPath, 'utf8')).length, 2, 'failed probes must run again');

    await writeFakePi(tempRoot, [
      '#!/bin/sh',
      `printf x >> '${countPath}'`,
      'echo "pi recovered"',
      'exit 0',
    ].join('\n'));
    const recovered = await checkCliAvailability('pi', { env });
    assert.equal(recovered.available, true);
    assert.equal(recovered.version, 'pi recovered');
    assert.equal((await fs.readFile(countPath, 'utf8')).length, 3);
  } finally {
    clearCliAvailabilityCacheForTest();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
