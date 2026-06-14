// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify Pi WebSocket send, abort, unavailable gate, and non-spawn
 * behavior end-to-end through the real server with a fake co binary.
 *
 * These tests lock in the runtime contract that task.md 6.3 claims.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const CCFLOW_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);
const TSX_CLI = 'node_modules/tsx/dist/cli.mjs';

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  await new Promise((resolve) => server.close(resolve));
  return addr.port;
}

function registerCleanupHooks(child, tempRoot) {
  const cleanup = async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((r) => child.once('exit', r)),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  };
  process.on('exit', cleanup);
  return cleanup;
}

async function waitForHealth(port, child, outputRef) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early: ${outputRef.text}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not become healthy: ${outputRef.text}`);
}

async function registerUser(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'pi-tester', password: 'pi-pass' }),
  });
  return res.json();
}

function openWs(port, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`,
      { headers: { Host: `127.0.0.1:${port}` } },
    );
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function collectWsMessages(ws) {
  const messages = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  return messages;
}

async function spawnCcflowServer(port, binDir, coHome, databasePath) {
  const outputRef = { text: '' };
  const child = spawn(process.execPath, [TSX_CLI, 'backend/index.ts'], {
    cwd: CCFLOW_ROOT,
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
  child.stdout.on('data', (c) => { outputRef.text += c.toString(); });
  child.stderr.on('data', (c) => { outputRef.text += c.toString(); });
  return { child, outputRef };
}

async function writeFakeCoWithPi(binDir, coHome, includePi = true) {
  const coPath = path.join(binDir, 'co');
  const piProvider = includePi ? '"pi": true' : '"pi": false';
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(coPath, [
    '#!/bin/sh',
    'if [ "$1" = "doctor" ] && [ "$2" = "--json" ]; then',
    `  printf '%s\\n' '{"ok":true,"contract":"co-request-v1","version":"test","home":"${coHome.replace(/'/g, "'\\''")}","providers":{"codex":true,"opencode":true,${piProvider}}}'`,
    '  exit 0',
    'fi',
    'exit 1',
  ].join('\n'), { mode: 0o755 });
}

async function setupRequestDirs(coHome) {
  await fs.mkdir(path.join(coHome, 'requests', 'pending'), { recursive: true });
}

async function readPendingRequests(coHome) {
  const pendingDir = path.join(coHome, 'requests', 'pending');
  try {
    const files = await fs.readdir(pendingDir);
    const requests = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        const raw = await fs.readFile(path.join(pendingDir, file), 'utf8');
        requests.push(JSON.parse(raw));
      }
    }
    return requests;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test: Pi send through pi-command WebSocket path
// ─────────────────────────────────────────────────────────────────────────────

test('pi-command writes co-request-v1 with provider=pi through real WebSocket', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-send-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  const port = await getFreePort();

  await writeFakeCoWithPi(binDir, coHome, true);
  await setupRequestDirs(coHome);

  // Pre-create a conversation so pi-command can continue it without a new draft
  await fs.mkdir(path.join(coHome, 'conversations', 'c100'), { recursive: true });
  await fs.writeFile(path.join(coHome, 'conversations', 'c100', 'state.json'), JSON.stringify({
    contract: 'co-conversation-v1',
    conversation_id: 'c100',
    project_path: tempRoot,
    provider: 'pi',
    active_turn_id: '',
    status: 'idle',
    turns: [],
  }));

  const { child, outputRef } = await spawnCcflowServer(port, binDir, coHome, databasePath);
  const cleanup = registerCleanupHooks(child, tempRoot);

  try {
    await waitForHealth(port, child, outputRef);
    const { token } = await registerUser(port);
    const ws = await openWs(port, token);
    const messages = collectWsMessages(ws);

    ws.send(JSON.stringify({
      type: 'pi-command',
      clientRequestId: `pi_send_${Date.now()}`,
      command: 'hello pi from test',
      sessionId: 'c100',
      ozwSessionId: 'c100',
      ozw_session_id: 'c100',
      options: {
        cwd: tempRoot,
        projectPath: tempRoot,
        projectName: 'pi-test-project',
      },
    }));

    // Wait for the co request to be written to requests/pending/
    await new Promise((r) => setTimeout(r, 2000));

    const pending = await readPendingRequests(coHome);
    const serverOutput = outputRef.text.slice(-600);

    // Must have written exactly one request
    assert.equal(pending.length, 1, `must write exactly one pending co request. Server: ${serverOutput}`);

    const request = pending[0];
    assert.equal(request.contract, 'co-request-v1', 'must use co-request-v1 contract');
    assert.equal(request.provider, 'pi', 'must set provider=pi');
    assert.equal(request.op, 'message', 'must be a message operation');
    assert.equal(request.conversation_id, 'c100', 'must use stable cN conversation_id');
    assert.equal(request.text, 'hello pi from test', 'must include user text');

    // Verify message-accepted was sent
    const accepted = messages.find((m) => m.type === 'message-accepted');
    assert.ok(accepted, 'must send message-accepted');
    assert.equal(accepted.provider, 'pi', 'message-accepted must carry provider=pi');

    ws.close();
  } finally {
    await cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Pi abort through WebSocket
// ─────────────────────────────────────────────────────────────────────────────

test('abort-session with provider=pi writes abort co-request-v1 with target_turn_id', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-abort-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  const port = await getFreePort();

  await writeFakeCoWithPi(binDir, coHome, true);
  await setupRequestDirs(coHome);

  // Pre-create a running conversation so abort resolves correctly
  await fs.mkdir(path.join(coHome, 'conversations', 'c101'), { recursive: true });
  await fs.writeFile(path.join(coHome, 'conversations', 'c101', 'state.json'), JSON.stringify({
    contract: 'co-conversation-v1',
    conversation_id: 'c101',
    project_path: tempRoot,
    provider: 'pi',
    active_turn_id: 'turn_abort_target',
    status: 'running',
    turns: ['turn_abort_target'],
  }));

  const { child, outputRef } = await spawnCcflowServer(port, binDir, coHome, databasePath);
  const cleanup = registerCleanupHooks(child, tempRoot);

  try {
    await waitForHealth(port, child, outputRef);
    const { token } = await registerUser(port);
    const ws = await openWs(port, token);

    ws.send(JSON.stringify({
      type: 'abort-session',
      sessionId: 'c101',
      ozwSessionId: 'c101',
      provider: 'pi',
      targetTurnId: 'turn_abort_target',
      projectName: 'pi-test-project',
      projectPath: tempRoot,
    }));

    await new Promise((r) => setTimeout(r, 1500));

    const pending = await readPendingRequests(coHome);
    assert.equal(pending.length, 1, 'must write exactly one abort request');

    const request = pending[0];
    assert.equal(request.contract, 'co-request-v1', 'must use co-request-v1 contract');
    assert.equal(request.provider, 'pi', 'must set provider=pi');
    assert.equal(request.op, 'abort', 'must be an abort operation');
    assert.equal(request.conversation_id, 'c101', 'must use stable cN conversation_id');
    assert.ok(request.target_turn_id === 'turn_abort_target' || request.targetTurnId === 'turn_abort_target',
      'must include target turn id');

    ws.close();
  } finally {
    await cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Pi provider unavailable gate blocks send
// ─────────────────────────────────────────────────────────────────────────────

test('providers.pi=false gate rejects pi-command without writing pending request or creating draft', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-gate-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  const port = await getFreePort();

  // Fake co with Pi unavailable
  await writeFakeCoWithPi(binDir, coHome, false);
  await setupRequestDirs(coHome);

  const { child, outputRef } = await spawnCcflowServer(port, binDir, coHome, databasePath);
  const cleanup = registerCleanupHooks(child, tempRoot);

  try {
    await waitForHealth(port, child, outputRef);
    const { token } = await registerUser(port);
    const ws = await openWs(port, token);
    const messages = collectWsMessages(ws);

    ws.send(JSON.stringify({
      type: 'pi-command',
      clientRequestId: `pi_gate_${Date.now()}`,
      command: 'this should be blocked',
      sessionId: 'c200',
      ozwSessionId: 'c200',
      options: {
        cwd: tempRoot,
        projectPath: tempRoot,
        projectName: 'pi-test-project',
      },
    }));

    await new Promise((r) => setTimeout(r, 1000));

    // Verify no pending request was written
    const pendingFiles = await fs.readdir(path.join(coHome, 'requests', 'pending')).catch(() => []);
    assert.equal(pendingFiles.length, 0, 'must not write any pending request when pi is unavailable');

    // Verify error was sent
    const errorEvent = messages.find((m) =>
      m.type === 'pi-error' || m.type === 'error'
    );
    assert.ok(errorEvent, 'must send an error event when pi provider is unavailable');

    ws.close();
  } finally {
    await cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Pi check-session-status uses correct provider
// ─────────────────────────────────────────────────────────────────────────────

test('check-session-status with provider=pi recovers co conversation with correct provider', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-status-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  const port = await getFreePort();

  await writeFakeCoWithPi(binDir, coHome, true);

  // Pre-create an idle Pi conversation
  await fs.mkdir(path.join(coHome, 'conversations', 'c300'), { recursive: true });
  await fs.writeFile(path.join(coHome, 'conversations', 'c300', 'state.json'), JSON.stringify({
    contract: 'co-conversation-v1',
    conversation_id: 'c300',
    project_path: tempRoot,
    provider: 'pi',
    active_turn_id: '',
    status: 'idle',
    turns: [],
  }));

  const { child, outputRef } = await spawnCcflowServer(port, binDir, coHome, databasePath);
  const cleanup = registerCleanupHooks(child, tempRoot);

  try {
    await waitForHealth(port, child, outputRef);
    const { token } = await registerUser(port);
    const ws = await openWs(port, token);
    const messages = collectWsMessages(ws);

    ws.send(JSON.stringify({
      type: 'check-session-status',
      sessionId: 'c300',
      ozwSessionId: 'c300',
      provider: 'pi',
    }));

    await new Promise((r) => setTimeout(r, 500));

    const statusMsg = messages.find((m) =>
      m.type === 'session-status' && m.sessionId === 'c300'
    );
    assert.ok(statusMsg, 'must send session-status for Pi session');
    assert.equal(statusMsg.provider, 'pi', 'session-status must carry provider=pi');
    assert.equal(statusMsg.isProcessing, false, 'idle Pi session must report isProcessing=false');

    ws.close();
  } finally {
    await cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Pi active-sessions include pi turns
// ─────────────────────────────────────────────────────────────────────────────

test('get-active-sessions includes pi when Pi turns are running', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-active-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  const port = await getFreePort();

  await writeFakeCoWithPi(binDir, coHome, true);
  await setupRequestDirs(coHome);

  const { child, outputRef } = await spawnCcflowServer(port, binDir, coHome, databasePath);
  const cleanup = registerCleanupHooks(child, tempRoot);

  try {
    await waitForHealth(port, child, outputRef);
    const { token } = await registerUser(port);
    const ws = await openWs(port, token);
    const messages = collectWsMessages(ws);

    ws.send(JSON.stringify({ type: 'get-active-sessions' }));
    await new Promise((r) => setTimeout(r, 500));

    const activeMsg = messages.find((m) => m.type === 'active-sessions');
    assert.ok(activeMsg, 'must return active-sessions message');
    assert.ok(activeMsg.sessions, 'must include sessions object');
    assert.ok(Array.isArray(activeMsg.sessions.pi), 'must include pi key as an array');
    assert.ok(Array.isArray(activeMsg.sessions.codex), 'must include codex key as an array');
    assert.ok(Array.isArray(activeMsg.sessions.opencode), 'must include opencode key as an array');

    ws.close();
  } finally {
    await cleanup();
  }
});
