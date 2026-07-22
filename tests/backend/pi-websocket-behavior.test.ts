// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify Pi and Codex WebSocket send, abort, provider gate, and
 * native session-status behavior end-to-end through the real server.
 *
 * Updated for native SDK: no longer checks co-request-v1 file writes.
 * These tests verify the WebSocket event contract for native runtime.
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

const CCFLOW_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../..',
);
function collectWsMessages(ws) {
  const messages = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  return messages;
}

async function spawnCcflowServer(binDir, coHome, databasePath) {
  /** Start ozw with fake workflow CLIs so Pi tests do not depend on host PATH. */
  await writeFakeWorkflowTools(binDir);
  return startIsolatedBackendServer({
    cwd: CCFLOW_ROOT,
    databasePath,
    env: {
      CCFLOW_CO_HOME: coHome,
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
  });
}

async function writeFakeCoWithPi(binDir, coHome, includePi = true) {
  const coPath = path.join(binDir, 'co');
  const piProvider = includePi ? '"pi": true' : '"pi": false';
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(coPath, [
    '#!/bin/sh',
    'if [ "$1" = "doctor" ] && [ "$2" = "--json" ]; then',
    `  printf '%s\\n' '{"ok":true,"contract":"co-request-v1","version":"test","home":"${coHome.replace(/'/g, "'\\''")}","providers":{"codex":true,${piProvider}}}'`,
    '  exit 0',
    'fi',
    'exit 1',
  ].join('\n'), { mode: 0o755 });
}

async function setupRequestDirs(coHome) {
  await fs.mkdir(path.join(coHome, 'requests', 'pending'), { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test: Pi send through pi-command WebSocket path (native runtime)
// ─────────────────────────────────────────────────────────────────────────────

test('pi-command redirects users to the tmux TUI without co writes', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-send-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');

  await writeFakeCoWithPi(binDir, coHome, true);
  await setupRequestDirs(coHome);

  let fixture;

  try {
    fixture = await spawnCcflowServer(binDir, coHome, databasePath);
    const { token } = await registerTestUser(fixture, { username: 'pi-tester', password: 'pi-pass' });
    const ws = await openAuthenticatedWebSocket(fixture, token);
    const messages = collectWsMessages(ws);

    // Use non-cN session ID to avoid triggering cN draft creation
    const testSessionId = `test-pi-${Date.now()}`;
    ws.send(JSON.stringify({
      type: 'pi-command',
      clientRequestId: `pi_send_${Date.now()}`,
      command: 'hello pi from test',
      sessionId: testSessionId,
      ozwSessionId: '',
      options: {
        cwd: tempRoot,
        projectPath: tempRoot,
        projectName: 'pi-test-project',
      },
    }));

    // Wait for the protocol-level TUI response.
    await new Promise((r) => setTimeout(r, 500));

    // Verify no co-request-v1 pending requests were written
    const pendingDir = path.join(coHome, 'requests', 'pending');
    let pendingFiles = [];
    try {
      pendingFiles = await fs.readdir(pendingDir);
    } catch {}
    assert.equal(pendingFiles.length, 0,
      `must not write any co-request-v1 pending requests (native runtime, not co). Server: ${fixture.output.text.slice(-400)}`);

    const tuiRedirect = messages.find((message) => message.type === 'pi-error');
    assert.equal(tuiRedirect?.error, 'Pi 仅支持 tmux TUI');
    assert.equal(messages.some((message) => message.type === 'message-accepted'), false);

    ws.close();
  } finally {
    await stopBackendServerFixture(fixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Pi abort through WebSocket (native runtime) — starts a session first;
// if the environment accepts it, abort succeeds, otherwise rejection is explicit.
// ─────────────────────────────────────────────────────────────────────────────

test('abort-session with provider=pi handles accepted and rejected native starts', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-abort-2-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');

  await writeFakeCoWithPi(binDir, coHome, true);
  await setupRequestDirs(coHome);

  let fixture;

  try {
    fixture = await spawnCcflowServer(binDir, coHome, databasePath);
    const { token } = await registerTestUser(fixture, { username: 'pi-tester', password: 'pi-pass' });
    const ws = await openAuthenticatedWebSocket(fixture, token);
    const messages = collectWsMessages(ws);

    // 1. Start a running Pi session first
    const testSessionId = `test-pi-abort-${Date.now()}`;
    ws.send(JSON.stringify({
      type: 'pi-command',
      clientRequestId: `pi_abort_start_${Date.now()}`,
      command: 'test command for abort',
      sessionId: testSessionId,
      ozwSessionId: '',
      options: {
        cwd: tempRoot,
        projectPath: tempRoot,
        projectName: 'pi-test-project',
      },
    }));

    // Wait for the session to start and enter running state
    await new Promise((r) => setTimeout(r, 3000));

    const acceptedBefore = messages.find((m) => m.type === 'message-accepted');
    if (!acceptedBefore) {
      const rejected = messages.find((m) => m.type === 'message-rejected' || m.type === 'pi-error' || m.type === 'error');
      assert.ok(rejected,
        `must reject or error explicitly when Pi runtime cannot start. Got: ${messages.map(m => m.type).join(',')}`);
      const pendingDir = path.join(coHome, 'requests', 'pending');
      const pendingFiles = await fs.readdir(pendingDir).catch(() => []);
      assert.equal(pendingFiles.length, 0, 'must not fall back to co request files when native Pi start is rejected');
      ws.close();
      return;
    }

    // 2. Now abort the running session
    ws.send(JSON.stringify({
      type: 'abort-session',
      sessionId: testSessionId,
      ozwSessionId: testSessionId,
      provider: 'pi',
      projectName: 'pi-test-project',
      projectPath: tempRoot,
    }));

    await new Promise((r) => setTimeout(r, 1500));

    // 3. Verify session-aborted with success=true
    const abortedEvent = messages.find((m) => m.type === 'session-aborted');
    assert.ok(abortedEvent, 'must send session-aborted event');
    assert.equal(abortedEvent.provider, 'pi', 'session-aborted must carry provider=pi');
    assert.equal(abortedEvent.success, true,
      `abort of running Pi session must succeed. Got success=${abortedEvent.success}`);

    ws.close();
  } finally {
    await stopBackendServerFixture(fixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Pi abort through WebSocket (no running session)
// ─────────────────────────────────────────────────────────────────────────────

test('abort-session with provider=pi sends session-aborted via WebSocket', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-abort-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');

  await writeFakeCoWithPi(binDir, coHome, true);
  await setupRequestDirs(coHome);

  let fixture;

  try {
    fixture = await spawnCcflowServer(binDir, coHome, databasePath);
    const { token } = await registerTestUser(fixture, { username: 'pi-tester', password: 'pi-pass' });
    const ws = await openAuthenticatedWebSocket(fixture, token);
    const messages = collectWsMessages(ws);

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

    // Verify no co-request-v1 abort request was written
    const pendingDir = path.join(coHome, 'requests', 'pending');
    let pendingFiles = [];
    try {
      pendingFiles = await fs.readdir(pendingDir);
    } catch {}
    assert.equal(pendingFiles.length, 0,
      `must not write any co-request-v1 abort request (native runtime). Server: ${fixture.output.text.slice(-400)}`);

    // Check session-aborted event via WebSocket
    const abortedEvent = messages.find((m) => m.type === 'session-aborted');
    assert.ok(abortedEvent, 'must send session-aborted event');
    assert.equal(abortedEvent.provider, 'pi', 'session-aborted must carry provider=pi');

    ws.close();
  } finally {
    await stopBackendServerFixture(fixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Pi provider unavailable (server handles missing SDK gracefully)
// ─────────────────────────────────────────────────────────────────────────────

test('providers.pi=false gate does not crash server (native runtime)', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-gate-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');

  // Fake co with Pi unavailable (co providers.pi=false)
  await writeFakeCoWithPi(binDir, coHome, false);
  await setupRequestDirs(coHome);

  let fixture;

  try {
    fixture = await spawnCcflowServer(binDir, coHome, databasePath);
    const { token } = await registerTestUser(fixture, { username: 'pi-tester', password: 'pi-pass' });
    const ws = await openAuthenticatedWebSocket(fixture, token);
    const messages = collectWsMessages(ws);

    ws.send(JSON.stringify({
      type: 'pi-command',
      clientRequestId: `pi_gate_${Date.now()}`,
      command: 'this should be handled natively',
      sessionId: `test-pi-gate-${Date.now()}`,
      ozwSessionId: '',
      options: {
        cwd: tempRoot,
        projectPath: tempRoot,
        projectName: 'pi-test-project',
      },
    }));

    await new Promise((r) => setTimeout(r, 3000));

    // Verify no co-style pending request was written
    const pendingDir = path.join(coHome, 'requests', 'pending');
    let pendingFiles = [];
    try {
      pendingFiles = await fs.readdir(pendingDir);
    } catch {}
    assert.equal(pendingFiles.length, 0, 'must not write any pending request');

    // With native runtime, the co gate is no longer checked.
    // The server should either process the request via Pi SDK or handle any error gracefully.
    // At minimum, we should not see the old co-request-v1 file writes.
    const hasError = messages.some((m) => m.type === 'pi-error' || m.type === 'error');
    const hasAccepted = messages.some((m) => m.type === 'message-accepted');
    const hasStatus = messages.some((m) => m.type === 'session-status');
    assert.ok(hasError || hasAccepted || hasStatus,
      `Server must respond to pi-command without co writes. Got: ${JSON.stringify(messages.map(m => m.type))}`);

    ws.close();
  } finally {
    await stopBackendServerFixture(fixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: check-session-status uses native runtime status
// ─────────────────────────────────────────────────────────────────────────────

test('check-session-status returns isProcessing from native runtime', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-status-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');

  await writeFakeCoWithPi(binDir, coHome, true);

  let fixture;

  try {
    fixture = await spawnCcflowServer(binDir, coHome, databasePath);
    const { token } = await registerTestUser(fixture, { username: 'pi-tester', password: 'pi-pass' });
    const ws = await openAuthenticatedWebSocket(fixture, token);
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
    assert.ok(statusMsg, 'must send session-status');
    assert.equal(statusMsg.provider, 'pi', 'session-status must carry provider=pi');
    assert.equal(statusMsg.isProcessing, false, 'unstarted session must report isProcessing=false');
    assert.equal(statusMsg.turnStartedAt || '', '', 'idle session-status must not restore a stale turnStartedAt');

    ws.close();
  } finally {
    await stopBackendServerFixture(fixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: check-session-status reports correct isProcessing for unknown sessions
// ─────────────────────────────────────────────────────────────────────────────

test('check-session-status for unknown session returns isProcessing=false', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-terminal-status-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');

  await writeFakeCoWithPi(binDir, coHome, true);

  let fixture;

  try {
    fixture = await spawnCcflowServer(binDir, coHome, databasePath);
    const { token } = await registerTestUser(fixture, { username: 'pi-tester', password: 'pi-pass' });
    const ws = await openAuthenticatedWebSocket(fixture, token);
    const messages = collectWsMessages(ws);

    ws.send(JSON.stringify({
      type: 'check-session-status',
      sessionId: 'c400',
      ozwSessionId: 'c400',
      provider: 'pi',
    }));

    await new Promise((r) => setTimeout(r, 500));

    const statusMsg = messages.find((m) =>
      m.type === 'session-status' && m.sessionId === 'c400'
    );
    assert.ok(statusMsg, 'must send session-status');
    assert.equal(statusMsg.provider, 'pi');
    assert.equal(statusMsg.isProcessing, false,
      'unknown session must report isProcessing=false');

    ws.close();
  } finally {
    await stopBackendServerFixture(fixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test: Active sessions returns correct structure
// ─────────────────────────────────────────────────────────────────────────────

test('get-active-sessions returns pi and codex arrays from native runtime', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-active-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');

  await writeFakeCoWithPi(binDir, coHome, true);
  await setupRequestDirs(coHome);

  let fixture;

  try {
    fixture = await spawnCcflowServer(binDir, coHome, databasePath);
    const { token } = await registerTestUser(fixture, { username: 'pi-tester', password: 'pi-pass' });
    const ws = await openAuthenticatedWebSocket(fixture, token);
    const messages = collectWsMessages(ws);

    ws.send(JSON.stringify({ type: 'get-active-sessions' }));
    await new Promise((r) => setTimeout(r, 500));

    const activeMsg = messages.find((m) => m.type === 'active-sessions');
    assert.ok(activeMsg, 'must return active-sessions message');
    assert.ok(activeMsg.sessions, 'must include sessions object');
    assert.ok(Array.isArray(activeMsg.sessions.pi), 'must include pi key as an array');
    assert.ok(Array.isArray(activeMsg.sessions.codex), 'must include codex key as an array');

    ws.close();
  } finally {
    await stopBackendServerFixture(fixture);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
