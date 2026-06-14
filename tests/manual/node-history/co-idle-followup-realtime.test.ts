// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: 验证 conversation idle 后发送第 2 条消息，ozw observer 能发现新 turn 并广播事件。
 * 场景：第 1 轮完成后 conversation 进入 idle，第 2 条消息写入后 co 创建新 turn，observer 必须 attach tail。
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
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function writeFakeCoBinary(binDir, coHome) {
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

async function writeIdleConversation(coHome) {
  // c51 conversation，第 1 轮已完成，当前 idle
  await fs.mkdir(path.join(coHome, 'conversations', 'c51'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'turns', 'turn_1'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'requests', 'done'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'requests', 'pending'), { recursive: true });

  await fs.writeFile(path.join(coHome, 'conversations', 'c51', 'state.json'), JSON.stringify({
    contract: 'co-conversation-v1',
    conversation_id: 'c51',
    project_path: '/tmp/ozw-project',
    provider: 'codex',
    provider_session_id: 'provider_c51',
    active_turn_id: '',
    status: 'idle',
    turns: ['turn_1'],
  }));

  await fs.writeFile(path.join(coHome, 'requests', 'done', 'req_1.json'), JSON.stringify({
    request_id: 'req_1',
    conversation_id: 'c51',
    turn_id: 'turn_1',
    created_at: '2026-05-10T10:00:00.000Z',
    text: 'first message',
  }));
  await fs.writeFile(path.join(coHome, 'turns', 'turn_1', 'events.jsonl'), `${JSON.stringify({
    type: 'codex-response',
    provider: 'codex',
    conversation_id: 'c51',
    turn_id: 'turn_1',
    seq: 0,
    data: { type: 'item', itemType: 'agent_message', message: { content: 'First response' } },
  })}\n${JSON.stringify({
    type: 'codex-complete',
    provider: 'codex',
    conversation_id: 'c51',
    turn_id: 'turn_1',
    seq: 1,
  })}\n`);

  // 第 2 条消息的 pending request（已写入但 co 还没处理）
  await fs.writeFile(path.join(coHome, 'requests', 'pending', 'req_2.json'), JSON.stringify({
    request_id: 'req_2',
    conversation_id: 'c51',
    created_at: '2026-05-10T10:01:00.000Z',
    text: 'second message',
  }));
}

async function simulateCoCreatingNewTurn(coHome) {
  // 模拟 co 创建新 turn
  await fs.mkdir(path.join(coHome, 'turns', 'turn_2'), { recursive: true });
  await fs.writeFile(path.join(coHome, 'conversations', 'c51', 'state.json'), JSON.stringify({
    contract: 'co-conversation-v1',
    conversation_id: 'c51',
    project_path: '/tmp/ozw-project',
    provider: 'codex',
    provider_session_id: 'provider_c51',
    active_turn_id: 'turn_2',
    status: 'running',
    turns: ['turn_1', 'turn_2'],
  }));
  await fs.writeFile(path.join(coHome, 'turns', 'turn_2', 'events.jsonl'), `${JSON.stringify({
    type: 'codex-response',
    provider: 'codex',
    conversation_id: 'c51',
    turn_id: 'turn_2',
    seq: 0,
    data: { type: 'item', itemType: 'agent_message', message: { content: 'Second response' } },
  })}\n`);
}

async function waitForHealth(port, child, getOutput) {
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
      // Retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy: ${getOutput()}`);
}

async function stopServer(child) {
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

test('observer discovers new turn after idle and broadcasts follow-up response', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-idle-followup-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  await fs.mkdir(binDir, { recursive: true });
  await writeFakeCoBinary(binDir, coHome);
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

    // 发送第 2 条消息（此时 conversation 还是 idle）
    ws.send(JSON.stringify({
      type: 'codex-command',
      clientRequestId: 'req_2_test',
      command: 'second message',
      sessionId: null,
      ozwSessionId: 'c51',
      options: {
        projectPath: '/tmp/ozw-project',
        projectName: 'test-project',
        sessionId: null,
        ozwSessionId: 'c51',
        clientRequestId: 'req_2_test',
      },
    }));

    // 等待一小段时间，然后模拟 co 创建新 turn
    await new Promise((resolve) => setTimeout(resolve, 500));
    await simulateCoCreatingNewTurn(coHome);

    // 等待 observer 发现新 turn
    await new Promise((resolve) => setTimeout(resolve, 1500));
    ws.close();

    // 验证第 2 轮响应事件被广播
    const secondTurnEvents = received.filter((msg) => (
      msg.type === 'codex-response'
      && msg.data?.itemType === 'agent_message'
      && msg.data?.message?.content === 'Second response'
    ));
    assert.equal(secondTurnEvents.length >= 1, true, 'must broadcast second turn response after idle');

    const secondEvent = secondTurnEvents[0];
    assert.equal(secondEvent.ozwSessionId, 'c51', 'must include ozwSessionId');
    assert.equal(secondEvent.ozw_session_id, 'c51', 'must include ozw_session_id');
    assert.equal(secondEvent.turnId, 'turn_2', 'must include turnId');
    assert.equal(secondEvent.turn_id, 'turn_2', 'must include turn_id');

    // 验证第 1 轮响应没有被重复广播
    const firstTurnEvents = received.filter((msg) => (
      msg.type === 'codex-response'
      && msg.data?.itemType === 'agent_message'
      && msg.data?.message?.content === 'First response'
    ));
    assert.equal(firstTurnEvents.length, 0, 'must not replay first turn events from idle');

    // 验证 session-status 被发送
    const statusEvents = received.filter((msg) => msg.type === 'session-status' && msg.turnId === 'turn_2');
    assert.equal(statusEvents.length >= 1, true, 'must send session-status for new active turn after idle');
  } finally {
    await stopServer(child);
  }
});
