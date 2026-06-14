// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify real WebSocket status checks for idle co conversations do not replay history.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { writeFakeWorkflowTools } from './helpers/workflow-tools.ts';

const TSX_CLI = 'node_modules/tsx/dist/cli.mjs';

async function getFreePort() {
  /** Reserve a loopback port for the short-lived ozw server fixture. */
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

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

async function waitForHealth(port, child, getOutput) {
  /** Wait until the spawned server accepts HTTP requests or exits. */
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early: ${getOutput()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the short deadline expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy: ${getOutput()}`);
}

async function stopServer(child) {
  /** Stop the child server without leaving the test port occupied. */
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
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
  const port = await getFreePort();
  let output = '';
  const child = spawn(process.execPath, [TSX_CLI, 'backend/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_PATH: databasePath,
      CCFLOW_CO_HOME: coHome,
      SESSION_PATH_SCAN_INTERVAL_MS: '0',
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    await waitForHealth(port, child, () => output);
    const registerResponse = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'tester', password: 'password' }),
    });
    const registerPayload = await registerResponse.json();
    assert.equal(registerResponse.ok, true, JSON.stringify(registerPayload));

    const received = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(registerPayload.token)}`, {
      headers: { Host: `127.0.0.1:${port}` },
    });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
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
    await stopServer(child);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
