// @ts-nocheck -- Runtime fixtures deliberately use compact provider payloads.
/**
 * PURPOSE: Verify indexed Codex and Pi transcript paths bypass recursive HOME
 * discovery while preserving the existing message read contract.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getCodexSessionMessages,
  getPiSessionMessages,
} from '../../backend/domains/projects/provider-transcript-read-model.ts';

/** Run a transcript assertion with an empty HOME and a file outside provider roots. */
async function withIndexedTranscript(
  fileName: string,
  records: unknown[],
  assertion: (filePath: string) => Promise<void>,
): Promise<void> {
  /** Separating the indexed file from HOME makes accidental discovery impossible. */
  const originalHome = process.env.HOME;
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-indexed-transcript-'));
  const emptyHome = path.join(fixtureRoot, 'home');
  const filePath = path.join(fixtureRoot, fileName);
  await fs.mkdir(emptyHome);
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  process.env.HOME = emptyHome;
  try {
    await assertion(filePath);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
}

test('Codex message reader consumes an indexed path outside global discovery roots', async () => {
  await withIndexedTranscript('indexed-codex.jsonl', [{
    type: 'response_item',
    timestamp: '2026-08-24T00:00:00.000Z',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'indexed Codex message' }],
    },
  }], async (filePath) => {
    const result = await getCodexSessionMessages('not-discoverable', null, 0, null, filePath);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].message.content, 'indexed Codex message');
  });
});

test('Pi message reader consumes an indexed path outside global discovery roots', async () => {
  await withIndexedTranscript('indexed-pi.jsonl', [{
    type: 'message',
    timestamp: '2026-08-24T00:00:00.000Z',
    message: { role: 'assistant', content: 'indexed Pi message' },
  }], async (filePath) => {
    const result = await getPiSessionMessages('not-discoverable', null, 0, null, filePath);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].message.content, 'indexed Pi message');
  });
});

test('an invalid indexed path falls back to legacy Codex discovery', async () => {
  /** PURPOSE: Stale index rows must not make an otherwise discoverable session disappear. */
  const originalHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-stale-index-fallback-'));
  const sessionId = 'fallback-codex-session';
  const sessionDir = path.join(tempHome, '.codex', 'sessions', '2026', '08', '24');
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(sessionDir, `${sessionId}.jsonl`), `${JSON.stringify({
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'fallback Codex message' }],
    },
  })}\n`);
  process.env.HOME = tempHome;
  try {
    const result = await getCodexSessionMessages(
      sessionId,
      null,
      0,
      null,
      path.join(tempHome, 'stale-index-path.jsonl'),
    );
    assert.equal(result.messages[0].message.content, 'fallback Codex message');
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});
