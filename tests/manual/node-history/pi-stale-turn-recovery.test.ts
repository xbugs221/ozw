// @ts-nocheck -- Proposal acceptance test: stale turn recovery.
/**
 * PURPOSE: Verify isPiTurnTerminal correctly identifies terminal Pi turns
 * from events.jsonl, so recovery logic does not treat dead turns as running
 * and block queued follow-up messages.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { isPiTurnTerminal } from '../../../backend/co-read-model.ts';

async function writeEvents(coHome, turnId, events) {
  const turnDir = path.join(coHome, 'turns', turnId);
  await fs.mkdir(turnDir, { recursive: true });
  await fs.writeFile(
    path.join(turnDir, 'events.jsonl'),
    `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
    'utf8',
  );
}

test('pi-complete followed by pi-response is NOT terminal', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-oz46-recovery-'));
  const previousCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = path.join(tempRoot, 'co');

  try {
    const turnId = 'turn_pi_not_terminal';
    await writeEvents(process.env.CCFLOW_CO_HOME, turnId, [
      { seq: 1, type: 'pi-response', data: { message: { content: 'Hello' } } },
      { seq: 2, type: 'pi-complete', data: { type: 'turn_complete' } },
      { seq: 3, type: 'pi-response', data: { message: { content: 'World' } } },
    ]);

    assert.equal(await isPiTurnTerminal(turnId), false,
      'turn with pi-response after pi-complete should not be terminal');
  } finally {
    if (previousCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = previousCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('pi-complete as last material event IS terminal', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-oz46-terminal-'));
  const previousCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = path.join(tempRoot, 'co');

  try {
    const turnId = 'turn_pi_terminal';
    await writeEvents(process.env.CCFLOW_CO_HOME, turnId, [
      { seq: 1, type: 'pi-response', data: { message: { content: 'Hello' } } },
      { seq: 2, type: 'pi-response', data: { message: { content: ' World' } } },
      { seq: 3, type: 'pi-complete', data: { type: 'turn_complete' } },
    ]);

    assert.equal(await isPiTurnTerminal(turnId), true,
      'turn ending with pi-complete with no subsequent pi-response is terminal');
  } finally {
    if (previousCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = previousCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('session-aborted event IS terminal', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-oz46-aborted-'));
  const previousCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = path.join(tempRoot, 'co');

  try {
    const turnId = 'turn_pi_aborted';
    await writeEvents(process.env.CCFLOW_CO_HOME, turnId, [
      { seq: 1, type: 'pi-response', data: { message: { content: 'Hello' } } },
      { seq: 2, type: 'session-aborted', data: {} },
      { seq: 3, type: 'pi-response', data: { message: { content: 'stale' } } },
    ]);

    assert.equal(await isPiTurnTerminal(turnId), true,
      'turn with session-aborted is immediately terminal');
  } finally {
    if (previousCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = previousCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('missing events.jsonl is NOT terminal', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-oz46-missing-'));
  const previousCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = path.join(tempRoot, 'co');

  try {
    assert.equal(await isPiTurnTerminal('turn_no_events'), false,
      'turn with no events.jsonl is not terminal');
  } finally {
    if (previousCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = previousCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('ongoing pi-response stream is NOT terminal', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-oz46-ongoing-'));
  const previousCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = path.join(tempRoot, 'co');

  try {
    const turnId = 'turn_pi_ongoing';
    await writeEvents(process.env.CCFLOW_CO_HOME, turnId, [
      { seq: 1, type: 'pi-response', data: { message: { content: 'Hello' } } },
      { seq: 2, type: 'pi-response', data: { message: { content: ' World' } } },
    ]);

    assert.equal(await isPiTurnTerminal(turnId), false,
      'ongoing pi-response stream without terminal event is not terminal');
  } finally {
    if (previousCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = previousCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
