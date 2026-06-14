// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Validate session context token usage parsing and remaining-percent
 * normalization for Codex session payloads.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildSessionTokenUsagePayload,
  getCodexSessionTokenUsage,
} from '../../backend/session-token-usage.ts';

/**
 * Run each test inside an isolated HOME tree so provider fixtures stay local.
 */
async function withTemporaryHome(testBody) {
  const originalHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-session-token-usage-'));

  process.env.HOME = tempHome;
  try {
    await testBody(tempHome);
  } finally {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    await fs.rm(tempHome, { recursive: true, force: true });
  }
}

/**
 * Write a minimal Codex session fixture with token_count info.
 */
async function createCodexSessionFixture(homeDir) {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '04', '10');
  const sessionFile = path.join(sessionsDir, 'rollout-demo-codex-session.jsonl');

  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    sessionFile,
    [
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-10T08:47:26.760Z',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 246408,
              cached_input_tokens: 207360,
              output_tokens: 1509,
              reasoning_output_tokens: 155,
              total_tokens: 247917,
            },
            last_token_usage: {
              input_tokens: 60518,
              cached_input_tokens: 60416,
              output_tokens: 154,
              reasoning_output_tokens: 41,
              total_tokens: 61798,
            },
            model_context_window: 258400,
          },
        },
      }),
    ].join('\n') + '\n',
    'utf8'
  );
}

test('buildSessionTokenUsagePayload derives remaining and percentages', () => {
  const payload = buildSessionTokenUsagePayload({
    used: 25,
    total: 100,
    source: 'unit-test',
  });

  assert.equal(payload.remaining, 75);
  assert.equal(payload.usedPercent, 25);
  assert.equal(payload.remainingPercent, 75);
});

test('getCodexSessionTokenUsage returns remainingPercent from token_count info', async () => {
  await withTemporaryHome(async (tempHome) => {
    await createCodexSessionFixture(tempHome);
    const usage = await getCodexSessionTokenUsage('codex-session', { homeDir: tempHome });

    assert.ok(usage);
    assert.equal(usage.used, 61798);
    assert.equal(usage.total, 258400);
    assert.equal(usage.remaining, 196602);
    assert.equal(usage.remainingPercent, 80);
    assert.equal(usage.breakdown.cumulativeTotal, 247917);
  });
});
