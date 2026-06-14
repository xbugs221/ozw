// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Validate provider-specific usage remaining adapters and fallback behavior.
 * This suite ensures Codex parsing and unsupported-provider handling stay stable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  clearUsageRemainingCache,
  getCodexUsageRemaining,
  getUsageRemaining,
} from '../../backend/usage-remaining.ts';

let homeIsolationQueue = Promise.resolve();

/**
 * Execute test logic under an isolated HOME directory.
 */
async function withTemporaryHome(testBody) {
  const run = async () => {
    const originalHome = process.env.HOME;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-usage-test-'));

    process.env.HOME = tempHome;
    clearUsageRemainingCache();

    try {
      await testBody(tempHome);
    } finally {
      clearUsageRemainingCache();

      if (originalHome) {
        process.env.HOME = originalHome;
      } else {
        delete process.env.HOME;
      }

      await fs.rm(tempHome, { recursive: true, force: true });
    }
  };

  const runPromise = homeIsolationQueue.then(run, run);
  homeIsolationQueue = runPromise.catch(() => {});
  return runPromise;
}

/**
 * Write minimal Codex config and session JSONL fixtures with rate-limit payload.
 */
async function createCodexUsageFixture(homeDir, rateLimitsPayload, options = {}) {
  const {
    usePayloadRateLimits = false,
    sessionFileName = 'codex-session.jsonl',
  } = options;
  const codexDir = path.join(homeDir, '.codex');
  const sessionsDir = path.join(codexDir, 'sessions', '2026', '03', '05');

  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    path.join(codexDir, 'config.toml'),
    [
      '[tui]',
      'status_line = ["current-dir", "five-hour-limit", "weekly-limit", "used-tokens"]',
      '',
    ].join('\n'),
    'utf8'
  );

  await fs.writeFile(
    path.join(sessionsDir, sessionFileName),
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-03-05T09:00:00.000Z',
        payload: {
          id: 'codex-session',
          cwd: '/tmp/demo',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-03-05T09:10:00.000Z',
        payload: usePayloadRateLimits
          ? {
            type: 'token_count',
            info: {
              total_token_usage: {
                input_tokens: 1,
              },
            },
            rate_limits: rateLimitsPayload,
          }
          : {
            type: 'token_count',
            info: {
              rate_limits: rateLimitsPayload,
            },
          },
      }),
    ].join('\n') + '\n',
    'utf8'
  );
}

test('getCodexUsageRemaining converts primary/secondary used_percent to remaining values', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    await createCodexUsageFixture(tempHome, {
      primary: { used_percent: 65 },
      secondary: { used_percent: 55.5 },
    }, { usePayloadRateLimits: true });

    const usage = await getCodexUsageRemaining({ homeDir: tempHome });

    assert.equal(usage.status, 'ok');
    assert.equal(usage.provider, 'codex');
    assert.equal(usage.fiveHourRemaining.value, 35);
    assert.equal(usage.sevenDayRemaining.value, 44.5);
    assert.equal(usage.source, 'codex-rate-limits');
  });
});

test('getCodexUsageRemaining falls back to older session when newest file has no rate limits', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    await createCodexUsageFixture(
      tempHome,
      {
        primary: { used_percent: 25 },
        secondary: { used_percent: 40 },
      },
      {
        usePayloadRateLimits: true,
        sessionFileName: 'older-session.jsonl',
      }
    );

    const sessionsDir = path.join(tempHome, '.codex', 'sessions', '2026', '03', '05');
    const latestFilePath = path.join(sessionsDir, 'latest-session.jsonl');
    await fs.writeFile(
      latestFilePath,
      [
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-03-05T12:00:00.000Z',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: {
                input_tokens: 123,
              },
            },
            rate_limits: null,
          },
        }),
      ].join('\n') + '\n',
      'utf8'
    );
    await fs.utimes(latestFilePath, new Date('2026-03-05T12:00:00.000Z'), new Date('2026-03-05T12:00:00.000Z'));

    const usage = await getCodexUsageRemaining({ homeDir: tempHome });

    assert.equal(usage.status, 'ok');
    assert.equal(usage.fiveHourRemaining.value, 75);
    assert.equal(usage.sevenDayRemaining.value, 60);
  });
});

test('getUsageRemaining returns unavailable payload for missing data and unsupported providers', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const claudeUsage = await getUsageRemaining('claude', { homeDir: tempHome, cacheTtlMs: 0 });
    assert.equal(claudeUsage.provider, 'claude');
    assert.equal(claudeUsage.status, 'unavailable');
    assert.equal(claudeUsage.source, 'claude-usage');
    assert.equal(claudeUsage.reason, 'provider-unsupported');

    await fs.mkdir(path.join(tempHome, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(tempHome, '.codex', 'config.toml'),
      ['[tui]', 'status_line = ["current-dir", "used-tokens"]', ''].join('\n'),
      'utf8'
    );

    const codexUsage = await getUsageRemaining('codex', { homeDir: tempHome, cacheTtlMs: 0 });
    assert.equal(codexUsage.status, 'unavailable');
    assert.equal(codexUsage.reason, 'session-file-not-found');

    const opencodeUsage = await getUsageRemaining('opencode', { homeDir: tempHome, cacheTtlMs: 0 });
    assert.equal(opencodeUsage.provider, 'opencode');
    assert.equal(opencodeUsage.status, 'unavailable');
    assert.equal(opencodeUsage.reason, 'provider-unsupported');
  });
});
