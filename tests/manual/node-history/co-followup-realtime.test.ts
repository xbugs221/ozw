// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify same-conversation co follow-up turns are tailed and broadcast to the cN route.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

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
  /** Provide the co doctor contract used by ozw before accepting chat sends. */
  const coPath = path.join(binDir, 'co');
  await fs.writeFile(coPath, [
    '#!/bin/sh',
    'if [ "$1" = "doctor" ] && [ "$2" = "--json" ]; then',
    `  printf '%s\\n' '{"ok":true,"contract":"co-request-v1","version":"test","home":"${coHome}","providers":{"codex":true,"opencode":true}}'`,
    '  exit 0',
    'fi',
    'exit 1',
  ].join('\n'), { mode: 0o755 });
}

async function writeCompletedFirstTurn(coHome) {
  /** Seed c51 as an existing idle conversation so the next message is a follow-up. */
  await fs.mkdir(path.join(coHome, 'conversations', 'c51'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'turns', 'turn_1'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'requests', 'done'), { recursive: true });
  await fs.writeFile(path.join(coHome, 'conversations', 'c51', 'state.json'), `${JSON.stringify({
    contract: 'co-conversation-v1',
    conversation_id: 'c51',
    project_path: '/tmp/ozw-project',
    provider: 'codex',
    provider_session_id: 'provider_c51',
    active_turn_id: '',
    status: 'idle',
    turns: ['turn_1'],
  }, null, 2)}\n`);
  await fs.writeFile(path.join(coHome, 'requests', 'done', 'req_1.json'), `${JSON.stringify({
    request_id: 'req_1',
    conversation_id: 'c51',
    turn_id: 'turn_1',
    created_at: '2026-05-12T10:00:00.000Z',
    text: 'first',
  }, null, 2)}\n`);
  await fs.writeFile(path.join(coHome, 'turns', 'turn_1', 'events.jsonl'), `${JSON.stringify({
    type: 'codex-response',
    provider: 'codex',
    conversation_id: 'c51',
    turn_id: 'turn_1',
    seq: 0,
    data: { type: 'item', itemType: 'agent_message', message: { content: 'FIRST_DONE' } },
  })}\n`);
}

async function writeRunningFirstTurn(coHome) {
  /** Seed c51 with an active first turn so the next message waits for co queue handoff. */
  await fs.mkdir(path.join(coHome, 'conversations', 'c51'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'turns', 'turn_1'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'requests', 'running'), { recursive: true });
  await fs.writeFile(path.join(coHome, 'conversations', 'c51', 'state.json'), `${JSON.stringify({
    contract: 'co-conversation-v1',
    conversation_id: 'c51',
    project_path: '/tmp/ozw-project',
    provider: 'codex',
    provider_session_id: 'provider_c51',
    active_turn_id: 'turn_1',
    status: 'running',
    turns: ['turn_1'],
  }, null, 2)}\n`);
  await fs.writeFile(path.join(coHome, 'requests', 'running', 'req_1.json'), `${JSON.stringify({
    request_id: 'req_1',
    conversation_id: 'c51',
    turn_id: 'turn_1',
    created_at: '2026-05-12T10:00:00.000Z',
    text: 'first',
  }, null, 2)}\n`);
  await fs.writeFile(path.join(coHome, 'turns', 'turn_1', 'events.jsonl'), `${JSON.stringify({
    type: 'codex-response',
    provider: 'codex',
    conversation_id: 'c51',
    turn_id: 'turn_1',
    seq: 0,
    data: { type: 'item', itemType: 'agent_message', message: { content: 'FIRST_RUNNING' } },
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

async function waitForMessage(received, predicate, timeoutMs = 5000) {
  /** Poll received WebSocket messages until the business event appears. */
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = received.find(predicate);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`timed out waiting for message; received=${JSON.stringify(received)}`);
}

test('second co turn response is broadcast to the same cN route over the real WebSocket', async () => {
  /** Scenario: c51 follow-up send writes a co request, then the new active turn response reaches the browser. */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-followup-ws-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  await fs.mkdir(binDir, { recursive: true });
  await writeFakeCoBinary(binDir, coHome);
  await writeCompletedFirstTurn(coHome);
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
    ws.send(JSON.stringify({
      type: 'codex-command',
      clientRequestId: 'req_2',
      startRequestId: 'req_2',
      command: 'second',
      sessionId: null,
      ozwSessionId: 'c51',
      options: {
        projectPath: '/tmp/ozw-project',
        cwd: '/tmp/ozw-project',
        projectName: 'fixture',
        sessionId: null,
        ozwSessionId: 'c51',
        clientRequestId: 'req_2',
      },
    }));

    await waitForMessage(received, (message) => message.type === 'message-accepted' && message.ozwSessionId === 'c51');
    const pendingRequest = JSON.parse(await fs.readFile(path.join(coHome, 'requests', 'pending', 'req_2.json'), 'utf8'));
    assert.equal(pendingRequest.conversation_id, 'c51');

    await fs.mkdir(path.join(coHome, 'turns', 'turn_2'), { recursive: true });
    await fs.writeFile(path.join(coHome, 'conversations', 'c51', 'state.json'), `${JSON.stringify({
      contract: 'co-conversation-v1',
      conversation_id: 'c51',
      project_path: '/tmp/ozw-project',
      provider: 'codex',
      provider_session_id: 'provider_c51',
      active_turn_id: 'turn_2',
      status: 'running',
      turns: ['turn_1', 'turn_2'],
    }, null, 2)}\n`);
    await fs.writeFile(path.join(coHome, 'turns', 'turn_2', 'events.jsonl'), `${JSON.stringify({
      type: 'codex-response',
      provider: 'codex',
      conversation_id: 'c51',
      turn_id: 'turn_2',
      seq: 0,
      data: { type: 'item', itemType: 'agent_message', message: { content: 'SECOND_REALTIME_OK' } },
    })}\n`);

    const response = await waitForMessage(received, (message) => (
      message.type === 'codex-response'
      && message.data?.itemType === 'agent_message'
      && message.data?.message?.content === 'SECOND_REALTIME_OK'
    ));
    assert.equal(response.ozwSessionId, 'c51');
    assert.equal(response.ozw_session_id, 'c51');
    assert.equal(response.turnId, 'turn_2');
    assert.equal(response.turn_id, 'turn_2');
  } finally {
    await stopServer(child);
  }
});

test('queued follow-up response is broadcast after co switches to the next active turn', async () => {
  /** Scenario: While turn_1 is running, the queued turn_2 response still reaches c51. */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-queued-ws-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  await fs.mkdir(binDir, { recursive: true });
  await writeFakeCoBinary(binDir, coHome);
  await writeRunningFirstTurn(coHome);
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
    ws.send(JSON.stringify({
      type: 'codex-command',
      clientRequestId: 'req_2',
      startRequestId: 'req_2',
      command: 'second queued',
      sessionId: null,
      ozwSessionId: 'c51',
      options: {
        projectPath: '/tmp/ozw-project',
        cwd: '/tmp/ozw-project',
        projectName: 'fixture',
        sessionId: null,
        ozwSessionId: 'c51',
        clientRequestId: 'req_2',
      },
    }));

    await waitForMessage(received, (message) => message.type === 'message-accepted' && message.ozwSessionId === 'c51');
    const pendingRequest = JSON.parse(await fs.readFile(path.join(coHome, 'requests', 'pending', 'req_2.json'), 'utf8'));
    assert.equal(pendingRequest.active_policy, 'queue');
    assert.equal(pendingRequest.conversation_id, 'c51');

    await fs.mkdir(path.join(coHome, 'turns', 'turn_2'), { recursive: true });
    await fs.writeFile(path.join(coHome, 'conversations', 'c51', 'state.json'), `${JSON.stringify({
      contract: 'co-conversation-v1',
      conversation_id: 'c51',
      project_path: '/tmp/ozw-project',
      provider: 'codex',
      provider_session_id: 'provider_c51',
      active_turn_id: 'turn_2',
      status: 'running',
      turns: ['turn_1', 'turn_2'],
    }, null, 2)}\n`);
    await fs.writeFile(path.join(coHome, 'turns', 'turn_2', 'events.jsonl'), `${JSON.stringify({
      type: 'codex-response',
      provider: 'codex',
      conversation_id: 'c51',
      turn_id: 'turn_2',
      seq: 0,
      data: { type: 'item', itemType: 'agent_message', message: { content: 'QUEUED_SECOND_OK' } },
    })}\n`);

    const response = await waitForMessage(received, (message) => (
      message.type === 'codex-response'
      && message.data?.itemType === 'agent_message'
      && message.data?.message?.content === 'QUEUED_SECOND_OK'
    ));
    assert.equal(response.ozwSessionId, 'c51');
    assert.equal(response.ozw_session_id, 'c51');
    assert.equal(response.turnId, 'turn_2');
    assert.equal(response.turn_id, 'turn_2');
  } finally {
    await stopServer(child);
  }
});

test('fast completed follow-up response is broadcast after state returns to idle', async () => {
  /** Scenario: co writes turn_2 events and clears active_turn_id before ozw polls. */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-fast-complete-ws-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  await fs.mkdir(binDir, { recursive: true });
  await writeFakeCoBinary(binDir, coHome);
  await writeCompletedFirstTurn(coHome);
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
    ws.send(JSON.stringify({
      type: 'codex-command',
      clientRequestId: 'req_2',
      startRequestId: 'req_2',
      command: 'second fast',
      sessionId: null,
      ozwSessionId: 'c51',
      options: {
        projectPath: '/tmp/ozw-project',
        cwd: '/tmp/ozw-project',
        projectName: 'fixture',
        sessionId: null,
        ozwSessionId: 'c51',
        clientRequestId: 'req_2',
      },
    }));

    await waitForMessage(received, (message) => message.type === 'message-accepted' && message.ozwSessionId === 'c51');
    await fs.mkdir(path.join(coHome, 'turns', 'turn_2'), { recursive: true });
    await fs.writeFile(path.join(coHome, 'turns', 'turn_2', 'events.jsonl'), `${JSON.stringify({
      type: 'codex-response',
      provider: 'codex',
      conversation_id: 'c51',
      turn_id: 'turn_2',
      seq: 0,
      data: { type: 'item', itemType: 'agent_message', message: { content: 'FAST_SECOND_OK' } },
    })}\n`);
    await fs.writeFile(path.join(coHome, 'conversations', 'c51', 'state.json'), `${JSON.stringify({
      contract: 'co-conversation-v1',
      conversation_id: 'c51',
      project_path: '/tmp/ozw-project',
      provider: 'codex',
      provider_session_id: 'provider_c51',
      active_turn_id: '',
      status: 'idle',
      turns: ['turn_1', 'turn_2'],
    }, null, 2)}\n`);

    const response = await waitForMessage(received, (message) => (
      message.type === 'codex-response'
      && message.data?.itemType === 'agent_message'
      && message.data?.message?.content === 'FAST_SECOND_OK'
    ));
    assert.equal(response.ozwSessionId, 'c51');
    assert.equal(response.ozw_session_id, 'c51');
    assert.equal(response.turnId, 'turn_2');
    assert.equal(response.turn_id, 'turn_2');
    assert.equal(received.some((message) => (
      message.type === 'codex-response'
      && message.data?.message?.content === 'FIRST_DONE'
    )), false);
  } finally {
    await stopServer(child);
  }
});
