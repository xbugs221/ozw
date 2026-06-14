// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify real WebSocket status checks for idle co conversations do not replay history.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  openAuthenticatedWebSocket,
  registerTestUser,
  startIsolatedBackendServer,
  stopBackendServerFixture,
} from './helpers/backend-service-fixture.ts';
import { writeFakeWorkflowTools } from './helpers/workflow-tools.ts';

async function writeFakeCoBinary(binDir, coHome) {
  /** Provide only the co doctor contract needed during server startup. */
  const coPath = path.join(binDir, 'co');
  await fs.writeFile(coPath, [
    '#!/bin/sh',
    'if [ "$1" = "doctor" ] && [ "$2" = "--json" ]; then',
    `  printf '%s\\n' '{"ok":true,"contract":"co-request-v1","version":"test","home":"${coHome}","providers":{"codex":true,"pi":true}}'`,
    '  exit 0',
    'fi',
    'exit 1',
  ].join('\n'), { mode: 0o755 });
}

async function writeIdleConversation(coHome) {
  /** Build the idle c51 fixture with historical events that must not replay. */
  await fs.mkdir(path.join(coHome, 'conversations', 'c51'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'turns', 'turn_history'), { recursive: true });
  await fs.writeFile(path.join(coHome, 'conversations', 'c51', 'state.json'), JSON.stringify({
    contract: 'co-conversation-v1',
    conversation_id: 'c51',
    project_path: '/tmp/ozw-project',
    provider: 'codex',
    provider_session_id: 'provider_c51',
    active_turn_id: '',
    status: 'idle',
    turns: ['turn_history'],
  }));
  await fs.writeFile(path.join(coHome, 'turns', 'turn_history', 'events.jsonl'), `${JSON.stringify({
    type: 'codex-response',
    provider: 'codex',
    conversation_id: 'c51',
    turn_id: 'turn_history',
    seq: 0,
    data: { type: 'item', itemType: 'agent_message', message: { content: 'CO_QUEUE_1_OK' } },
  })}\n`);
}

test('idle check-session-status sends only session-status over the real WebSocket', async () => {
  /** Scenario: Opening idle c51 must not push old agent_message events again. */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-idle-ws-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  await fs.mkdir(binDir, { recursive: true });
  await writeFakeCoBinary(binDir, coHome);
  await writeFakeWorkflowTools(binDir);
  await writeIdleConversation(coHome);
  let fixture;

  try {
    fixture = await startIsolatedBackendServer({
      databasePath,
      healthTimeoutMs: 10_000,
      env: {
        CCFLOW_CO_HOME: coHome,
        PATH: `${binDir}:${process.env.PATH || ''}`,
      },
    });
    const registerPayload = await registerTestUser(fixture, { username: 'tester', password: 'password' });

    const received = [];
    const ws = await openAuthenticatedWebSocket(fixture, registerPayload.token);
    ws.on('message', (message) => {
      received.push(JSON.parse(message.toString()));
    });
    ws.send(JSON.stringify({ type: 'check-session-status', sessionId: 'c51', ozwSessionId: 'c51', provider: 'codex' }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    ws.close();

    assert.equal(received.some((message) => (
      message.type === 'codex-response'
      && message.data?.itemType === 'agent_message'
      && message.data?.message?.content === 'CO_QUEUE_1_OK'
    )), false);
    assert.equal(received.filter((message) => message.type === 'session-status').length, 1);
    assert.equal(received.find((message) => message.type === 'session-status')?.isProcessing, false);
    assert.equal(received.find((message) => message.type === 'session-status')?.ozwSessionId, 'c51');
    assert.equal(received.find((message) => message.type === 'session-status')?.turnStartedAt || '', '');
  } finally {
    await stopBackendServerFixture(fixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
