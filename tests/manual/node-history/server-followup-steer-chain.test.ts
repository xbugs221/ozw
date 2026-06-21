// @ts-nocheck -- Proposal acceptance test: execution phase owns final strictness.
/**
 * PURPOSE: Verify Pi manual chat follow-up and steer messages cross the real
 * ozw WebSocket and native runtime boundaries instead of depending on the
 * removed co request-file protocol.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);
const TSX_CLI = 'node_modules/tsx/dist/cli.mjs';
const RUNTIME_EVIDENCE_PATH = path.join(REPO_ROOT, 'test-results', 'pi-session-58', 'native-runtime-events.log');

before(async () => {
  /**
   * Start each full server regression run with a clean combined evidence log.
   */
  await fs.rm(RUNTIME_EVIDENCE_PATH, { force: true }).catch(() => {});
});

async function getFreePort() {
  /**
   * Reserve and release one local TCP port for the temporary ozw server.
   */
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  await new Promise((resolve) => server.close(resolve));
  return addr.port;
}

async function writeFakeCoBinary(binDir, coHome) {
  /**
   * Create a minimal co executable that validates provider availability but
   * leaves request processing under test control.
   */
  await fs.mkdir(binDir, { recursive: true });
  const coPath = path.join(binDir, 'co');
  const payload = JSON.stringify({
    ok: true,
    contract: 'co-request-v1',
    version: 'proposal-test',
    home: coHome,
    providers: { codex: true, pi: true },
  });
  await fs.writeFile(coPath, [
    '#!/bin/sh',
    'if [ "$1" = "doctor" ] && [ "$2" = "--json" ]; then',
    `  printf '%s\\n' '${payload.replace(/'/g, "'\\''")}'`,
    '  exit 0',
    'fi',
    'exit 1',
  ].join('\n'), { mode: 0o755 });
}

async function spawnServer({ port, binDir, coHome, databasePath, homeDir }) {
  /**
   * Start the real server entrypoint with isolated auth db, co home, and
   * provider HOME so fake Pi transcripts cannot leak into the developer account.
   */
  const outputRef = { text: '' };
  const child = spawn(process.execPath, [TSX_CLI, 'backend/index.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      HOME: homeDir,
      USERPROFILE: homeDir,
      XDG_STATE_HOME: path.join(homeDir, '.local', 'state'),
      DATABASE_PATH: databasePath,
      CCFLOW_CO_HOME: coHome,
      CCFLOW_FAKE_RUNNER: '1',
      OZW_FAKE_PI_RUNTIME: '1',
      SESSION_PATH_SCAN_INTERVAL_MS: '0',
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { outputRef.text += chunk.toString(); });
  child.stderr.on('data', (chunk) => { outputRef.text += chunk.toString(); });
  return { child, outputRef };
}

async function waitForHealth(port, child, outputRef) {
  /**
   * Wait for the real HTTP server to accept requests before opening WebSocket.
   */
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early: ${outputRef.text}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy: ${outputRef.text}`);
}

async function stopServer(child) {
  /**
   * Stop the temporary server without leaking a listener into later tests.
   */
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function registerUser(port, username) {
  /**
   * Register a real local auth user so WebSocket authentication stays enabled.
   */
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'proposal-pass' }),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  return payload.token;
}

async function createManualPiDraft(port, token, { projectName, projectPath, label }) {
  /**
   * Create the same persisted cN manual route draft that the browser provider
   * picker creates before the first Pi message.
   */
  const response = await fetch(`http://127.0.0.1:${port}/api/projects/${encodeURIComponent(projectName)}/manual-sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ provider: 'pi', label, projectPath }),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  assert.ok(payload.session?.id, 'manual session draft must return a route id');
  return payload.session;
}

function openWs(port, token) {
  /**
   * Open the same chat WebSocket endpoint used by the browser app.
   */
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`, {
      headers: { Host: `127.0.0.1:${port}` },
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function collectMessages(ws) {
  /**
   * Capture JSON WebSocket messages for assertions in protocol order.
   */
  const messages = [];
  ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  return messages;
}

async function waitForMessage(messages, predicate, timeoutMs = 8000) {
  /**
   * Poll captured WebSocket messages until the expected business event appears.
   */
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matched = messages.find(predicate);
    if (matched) return matched;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for WebSocket message. Received: ${JSON.stringify(messages)}`);
}

async function readPendingRequests(coHome) {
  /**
   * Read real co pending request files written by ozw.
   */
  const pendingDir = path.join(coHome, 'requests', 'pending');
  const files = await fs.readdir(pendingDir).catch(() => []);
  const requests = [];
  for (const fileName of files) {
    if (fileName.endsWith('.json')) {
      requests.push(JSON.parse(await fs.readFile(path.join(pendingDir, fileName), 'utf8')));
    }
  }
  return requests;
}

async function waitForPendingRequest(coHome, predicate) {
  /**
   * Wait for one ozw send to materialize as a request-file protocol record.
   */
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const requests = await readPendingRequests(coHome);
    const matched = requests.find(predicate);
    if (matched) return matched;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for pending co request: ${JSON.stringify(await readPendingRequests(coHome))}`);
}

async function writeConversationState(coHome, state) {
  /**
   * Persist one co conversation state record as the daemon would.
   */
  const statePath = path.join(coHome, 'conversations', state.conversation_id, 'state.json');
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function writeTurnState(coHome, turnId, state) {
  /**
   * Persist one co turn state record as the daemon would.
   */
  const statePath = path.join(coHome, 'turns', turnId, 'state.json');
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function appendTurnEvent(coHome, turnId, event) {
  /**
   * Append a complete JSONL event so ozw's tailer can broadcast it.
   */
  const eventPath = path.join(coHome, 'turns', turnId, 'events.jsonl');
  await fs.mkdir(path.dirname(eventPath), { recursive: true });
  await fs.appendFile(eventPath, `${JSON.stringify(event)}\n`, 'utf8');
}

async function createCompletedConversation(coHome, { provider, conversationId, projectPath, firstTurnId }) {
  /**
   * Seed a completed first turn so the next send is a true idle follow-up.
   */
  await writeTurnState(coHome, firstTurnId, {
    contract: 'co-turn-v1',
    turn_id: firstTurnId,
    conversation_id: conversationId,
    provider,
    status: 'completed',
  });
  await appendTurnEvent(coHome, firstTurnId, {
    type: `${provider}-response`,
    provider,
    conversation_id: conversationId,
    turn_id: firstTurnId,
    seq: 0,
    data: { type: 'item', itemType: 'agent_message', message: { content: `${provider} first response` } },
  });
  await writeConversationState(coHome, {
    contract: 'co-conversation-v1',
    conversation_id: conversationId,
    project_path: projectPath,
    provider,
    provider_session_id: `provider_${conversationId}`,
    active_turn_id: '',
    status: 'completed',
    turns: [firstTurnId],
  });
}

async function createRunningConversation(coHome, { provider, conversationId, projectPath, turnId }) {
  /**
   * Seed a running active turn so the next send must be a steer.
   */
  await writeTurnState(coHome, turnId, {
    contract: 'co-turn-v1',
    turn_id: turnId,
    conversation_id: conversationId,
    provider,
    status: 'running',
  });
  await writeConversationState(coHome, {
    contract: 'co-conversation-v1',
    conversation_id: conversationId,
    project_path: projectPath,
    provider,
    provider_session_id: `provider_${conversationId}`,
    active_turn_id: turnId,
    status: 'running',
    turns: [turnId],
  });
}

async function withServer(testName, callback) {
  /**
   * Build an isolated server fixture for one provider chain scenario.
   */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `ozw-45-${testName}-`));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const homeDir = path.join(tempRoot, 'home');
  const databasePath = path.join(tempRoot, 'auth.db');
  const port = await getFreePort();
  await fs.mkdir(homeDir, { recursive: true });
  await writeFakeCoBinary(binDir, coHome);
  const { child, outputRef } = await spawnServer({ port, binDir, coHome, databasePath, homeDir });
  try {
    await waitForHealth(port, child, outputRef);
    const token = await registerUser(port, `tester-${testName}`);
    const ws = await openWs(port, token);
    const messages = collectMessages(ws);
    await callback({ tempRoot, coHome, port, token, ws, messages });
    ws.close();
  } finally {
    await stopServer(child);
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeRuntimeEvidence(scenario, messages) {
  /**
   * Append each server scenario to the native runtime event stream required by
   * change 58 acceptance so follow-up and steer evidence cannot overwrite each
   * other.
   */
  await fs.mkdir(path.dirname(RUNTIME_EVIDENCE_PATH), { recursive: true });
  await fs.appendFile(
    RUNTIME_EVIDENCE_PATH,
    messages.map((message) => JSON.stringify({ scenario, ...message })).join('\n') + '\n',
    'utf8',
  );
}

for (const provider of ['pi']) {
  test(`${provider} idle follow-up discovers new turn and broadcasts response`, async () => {
    await withServer(`${provider}-followup`, async ({ tempRoot, coHome, port, token, ws, messages }) => {
      const projectPath = path.join(tempRoot, 'project');
      const projectName = `${provider}-project`;
      await fs.mkdir(projectPath, { recursive: true });
      const draft = await createManualPiDraft(port, token, {
        projectName,
        projectPath,
        label: 'Pi native follow-up regression',
      });
      const conversationId = draft.id;

      const commandType = 'pi-command';
      ws.send(JSON.stringify({
        type: commandType,
        clientRequestId: `${provider}_first_req`,
        command: `${provider} first message`,
        sessionId: conversationId,
        ozwSessionId: conversationId,
        ozw_session_id: conversationId,
        options: {
          projectPath,
          cwd: projectPath,
          projectName,
          sessionId: conversationId,
          ozwSessionId: conversationId,
          clientRequestId: `${provider}_first_req`,
        },
      }));
      const firstComplete = await waitForMessage(messages, (message) => (
        message.type === `${provider}-complete`
        && message.ozwSessionId === conversationId
      ), 12000);
      assert.ok(firstComplete.actualSessionId, 'first native turn must expose provider session id');

      ws.send(JSON.stringify({
        type: commandType,
        clientRequestId: `${provider}_followup_req`,
        command: `${provider} second message`,
        sessionId: conversationId,
        ozwSessionId: conversationId,
        ozw_session_id: conversationId,
        options: {
          projectPath,
          cwd: projectPath,
          projectName,
          sessionId: conversationId,
          ozwSessionId: conversationId,
          clientRequestId: `${provider}_followup_req`,
        },
      }));

      const accepted = await waitForMessage(messages, (message) => (
        message.type === 'message-accepted'
        && message.provider === provider
        && message.clientRequestId === `${provider}_followup_req`
      ));
      assert.equal(accepted.ozwSessionId, conversationId);

      const response = await waitForMessage(messages, (message) => (
        message.type === `${provider}-response`
        && message.data?.message?.content === `fake pi response: ${provider} second message`
      ), 12000);
      assert.equal(response.ozwSessionId, conversationId);
      assert.equal(response.sessionId, firstComplete.actualSessionId);

      const pendingFiles = await fs.readdir(path.join(coHome, 'requests', 'pending')).catch(() => []);
      assert.equal(pendingFiles.length, 0, 'native Pi follow-up must not write co pending requests');
      await writeRuntimeEvidence('pi-followup', messages);
    });
  });

  test(`${provider} running steer targets active turn and forwards result`, async () => {
    await withServer(`${provider}-steer`, async ({ tempRoot, coHome, port, token, ws, messages }) => {
      const projectPath = path.join(tempRoot, 'project');
      const projectName = `${provider}-project`;
      await fs.mkdir(projectPath, { recursive: true });
      const draft = await createManualPiDraft(port, token, {
        projectName,
        projectPath,
        label: 'Pi native steer regression',
      });
      const conversationId = draft.id;

      const commandType = 'pi-command';
      ws.send(JSON.stringify({
        type: commandType,
        clientRequestId: `${provider}_start_req`,
        command: `${provider} long running message`,
        sessionId: conversationId,
        ozwSessionId: conversationId,
        ozw_session_id: conversationId,
        options: {
          projectPath,
          cwd: projectPath,
          projectName,
          sessionId: conversationId,
          ozwSessionId: conversationId,
          clientRequestId: `${provider}_start_req`,
        },
      }));
      await waitForMessage(messages, (message) => (
        message.type === 'session-status'
        && message.provider === provider
        && message.isProcessing === true
        && message.ozwSessionId === conversationId
      ));

      ws.send(JSON.stringify({
        type: commandType,
        clientRequestId: `${provider}_steer_req`,
        command: `${provider} steer message`,
        sessionId: conversationId,
        ozwSessionId: conversationId,
        ozw_session_id: conversationId,
        activePolicy: 'steer',
        options: {
          projectPath,
          cwd: projectPath,
          projectName,
          sessionId: conversationId,
          ozwSessionId: conversationId,
          clientRequestId: `${provider}_steer_req`,
          activePolicy: 'steer',
        },
      }));

      const queueState = await waitForMessage(messages, (message) => (
        message.type === 'session-queue-state'
        && message.provider === provider
        && Array.isArray(message.steering)
        && message.steering.includes(`${provider} steer message`)
      ));
      assert.equal(queueState.ozwSessionId, conversationId);

      const response = await waitForMessage(messages, (message) => (
        message.type === `${provider}-response`
        && message.data?.message?.content === `fake pi response: ${provider} steer message`
      ), 12000);
      assert.equal(response.ozwSessionId, conversationId);

      const pendingFiles = await fs.readdir(path.join(coHome, 'requests', 'pending')).catch(() => []);
      assert.equal(pendingFiles.length, 0, 'native Pi steer must not write co pending requests');
      await writeRuntimeEvidence('pi-steer', messages);
    });
  });
}
