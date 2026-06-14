// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: 验证 co conversation_id 解析逻辑：当浏览器只提供 provider session id 时，
 * 后端必须从项目配置或 co conversation state 反查 cN route，否则拒绝发送且不写 pending request。
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

async function setupProjectConfig(projectPath, routeIndex, providerSessionId, provider = 'codex') {
  const ozwDir = path.join(projectPath, '.ozw');
  await fs.mkdir(ozwDir, { recursive: true });
  const conf = {
    chat: {
      [String(routeIndex)]: {
        sessionId: providerSessionId,
        provider,
        title: 'Test Session',
      },
    },
  };
  await fs.writeFile(path.join(ozwDir, 'conf.json'), JSON.stringify(conf, null, 2));
}

async function setupCoConversationState(coHome, conversationId, providerSessionId) {
  const convDir = path.join(coHome, 'conversations', conversationId);
  await fs.mkdir(convDir, { recursive: true });
  await fs.writeFile(path.join(convDir, 'state.json'), JSON.stringify({
    contract: 'co-conversation-v1',
    conversation_id: conversationId,
    project_path: '/tmp/ozw-project',
    provider: 'codex',
    provider_session_id: providerSessionId,
    active_turn_id: '',
    status: 'idle',
    turns: [],
  }));
}

async function setupCoRequests(coHome) {
  await fs.mkdir(path.join(coHome, 'requests', 'pending'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'requests', 'done'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'requests', 'running'), { recursive: true });
}

function listPendingRequests(coHome) {
  try {
    return fs.readdir(path.join(coHome, 'requests', 'pending'));
  } catch {
    return [];
  }
}

async function readFirstPendingRequest(coHome) {
  const pendingDir = path.join(coHome, 'requests', 'pending');
  const entries = await fs.readdir(pendingDir);
  const jsonFile = entries.find((e) => e.endsWith('.json'));
  if (!jsonFile) {
    return null;
  }
  return JSON.parse(await fs.readFile(path.join(pendingDir, jsonFile), 'utf8'));
}

async function registerAndConnect(port) {
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
  return { ws, received, token: registerPayload.token };
}

// ==========================================================================
// Test 1: provider session id 反查 project config → cN 成功续发
// ==========================================================================
test('browser sends provider session id only, project config maps to cN', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-route-config-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  const projectPath = path.join(tempRoot, 'project');
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(projectPath, { recursive: true });
  await writeFakeCoBinary(binDir, coHome);
  await setupProjectConfig(projectPath, 51, 'provider_c51');
  await setupCoRequests(coHome);

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
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    await waitForHealth(port, child, () => output);
    const { ws, received } = await registerAndConnect(port);

    // 只提供 provider session id，不提供 ozwSessionId
    ws.send(JSON.stringify({
      type: 'codex-command',
      clientRequestId: 'req_test_1',
      command: 'continue the work',
      sessionId: 'provider_c51',
      options: {
        projectPath,
        projectName: 'test-project',
        sessionId: 'provider_c51',
        model: 'gpt-5',
      },
    }));

    // 等待消息处理完成
    await new Promise((resolve) => setTimeout(resolve, 500));
    ws.close();

    // 验证 message-accepted 带 c51
    const accepted = received.find((msg) => msg.type === 'message-accepted');
    assert.ok(accepted, 'must receive message-accepted');
    assert.equal(accepted.ozwSessionId, 'c51', 'ozwSessionId must be c51');

    // 验证 pending request 的 conversation_id 是 c51
    const pending = await readFirstPendingRequest(coHome);
    assert.ok(pending, 'must have a pending request');
    assert.equal(pending.conversation_id, 'c51', 'pending request conversation_id must be c51');
    assert.notEqual(pending.conversation_id, 'provider_c51', 'must not be provider session id');
  } finally {
    await stopServer(child);
  }
});

// ==========================================================================
// Test 2: provider session id 反查 co state → cN 成功续发
// ==========================================================================
test('browser sends provider session id only, co state maps to cN', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-route-costate-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  const projectPath = path.join(tempRoot, 'project');
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(projectPath, { recursive: true });
  await writeFakeCoBinary(binDir, coHome);
  // co state maps provider_c51 → c51
  await setupCoConversationState(coHome, 'c51', 'provider_c51');
  await setupCoRequests(coHome);

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
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    await waitForHealth(port, child, () => output);
    const { ws, received } = await registerAndConnect(port);

    ws.send(JSON.stringify({
      type: 'codex-command',
      clientRequestId: 'req_test_2',
      command: 'continue chatting',
      sessionId: 'provider_c51',
      options: {
        projectPath,
        projectName: 'test-project',
        sessionId: 'provider_c51',
        model: 'gpt-5',
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 500));
    ws.close();

    const accepted = received.find((msg) => msg.type === 'message-accepted');
    assert.ok(accepted, 'must receive message-accepted');
    assert.equal(accepted.ozwSessionId, 'c51', 'ozwSessionId must be c51 from co state');

    const pending = await readFirstPendingRequest(coHome);
    assert.ok(pending, 'must have a pending request');
    assert.equal(pending.conversation_id, 'c51', 'pending request conversation_id must be c51');
  } finally {
    await stopServer(child);
  }
});

// ==========================================================================
// Test 3: 无法反查 route 时拒绝发送且不写 pending request
// ==========================================================================
test('unknown provider session id is rejected, no pending request written', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-route-reject-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  const projectPath = path.join(tempRoot, 'project');
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(projectPath, { recursive: true });
  await writeFakeCoBinary(binDir, coHome);
  await setupCoRequests(coHome);

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
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    await waitForHealth(port, child, () => output);
    const { ws, received } = await registerAndConnect(port);

    // 发送一个完全未知的 session id
    ws.send(JSON.stringify({
      type: 'codex-command',
      clientRequestId: 'req_test_3',
      command: 'hello',
      sessionId: 'unknown_session_xyz',
      options: {
        projectPath,
        projectName: 'test-project',
        sessionId: 'unknown_session_xyz',
        model: 'gpt-5',
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 500));
    ws.close();

    // 应该收到错误
    const errorMsg = received.find((msg) => msg.type === 'codex-error');
    assert.ok(errorMsg, 'must receive codex-error');
    assert.ok(errorMsg.error, 'error must include a message');
    assert.ok(errorMsg.error.includes('Cannot determine'), 'error must mention route');

    // pending 目录下不应该有新 request（除了可能有的目录结构本身）
    const pendingEntries = await listPendingRequests(coHome);
    const requestFiles = pendingEntries.filter((e) => e.endsWith('.json'));
    assert.equal(requestFiles.length, 0, 'no pending request should be written');
  } finally {
    await stopServer(child);
  }
});

// ==========================================================================
// Test 4: abort request 使用 cN conversation_id
// ==========================================================================
test('abort resolves route from project config when only provider session id given', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-route-abort-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  const projectPath = path.join(tempRoot, 'project');
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(projectPath, { recursive: true });
  await writeFakeCoBinary(binDir, coHome);
  await setupProjectConfig(projectPath, 52, 'provider_c52');
  await setupCoRequests(coHome);

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
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    await waitForHealth(port, child, () => output);
    const { ws } = await registerAndConnect(port);

    ws.send(JSON.stringify({
      type: 'abort-session',
      clientRequestId: 'abort_test_4',
      sessionId: 'provider_c52',
      projectPath,
      projectName: 'test-project',
      provider: 'codex',
      targetTurnId: 'turn_active',
      options: {
        projectPath,
        projectName: 'test-project',
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 500));
    ws.close();

    // 验证 pending abort request 的 conversation_id 是 c52
    const pendingDir = path.join(coHome, 'requests', 'pending');
    const entries = await fs.readdir(pendingDir);
    const jsonFile = entries.find((e) => e.endsWith('.json'));
    assert.ok(jsonFile, 'must have a pending abort request');
    const pending = JSON.parse(await fs.readFile(path.join(pendingDir, jsonFile), 'utf8'));
    assert.equal(pending.conversation_id, 'c52', 'abort conversation_id must be c52');
    assert.equal(pending.op, 'abort', 'must be an abort operation');
  } finally {
    await stopServer(child);
  }
});

// ==========================================================================
// Test 5: OpenCode provider 同样的路由解析逻辑
// ==========================================================================
test('opencode uses same route resolution logic as codex', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-route-opencode-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  const projectPath = path.join(tempRoot, 'project');
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(projectPath, { recursive: true });
  await writeFakeCoBinary(binDir, coHome);
  await setupProjectConfig(projectPath, 99, 'provider_oc99', 'opencode');
  await setupCoRequests(coHome);

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
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    await waitForHealth(port, child, () => output);
    const { ws, received } = await registerAndConnect(port);

    ws.send(JSON.stringify({
      type: 'opencode-command',
      clientRequestId: 'req_oc_test',
      command: 'analyze code',
      sessionId: 'provider_oc99',
      options: {
        projectPath,
        projectName: 'test-project',
        sessionId: 'provider_oc99',
        model: 'claude-sonnet-4',
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 500));
    ws.close();

    const accepted = received.find((msg) => msg.type === 'message-accepted');
    assert.ok(accepted, 'must receive message-accepted for opencode');
    assert.equal(accepted.ozwSessionId, 'c99', 'ozwSessionId must be c99 for opencode');

    const pending = await readFirstPendingRequest(coHome);
    assert.ok(pending, 'must have a pending request for opencode');
    assert.equal(pending.conversation_id, 'c99', 'opencode pending request conversation_id must be c99');
    assert.equal(pending.provider, 'opencode', 'must be opencode provider');
  } finally {
    await stopServer(child);
  }
});

// ==========================================================================
// Test 6: 显式 ozwSessionId 优先于其他 fallback
// ==========================================================================
test('explicit ozwSessionId overrides provider session id', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-route-explicit-'));
  const coHome = path.join(tempRoot, 'co');
  const binDir = path.join(tempRoot, 'bin');
  const databasePath = path.join(tempRoot, 'auth.db');
  const projectPath = path.join(tempRoot, 'project');
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(projectPath, { recursive: true });
  await writeFakeCoBinary(binDir, coHome);
  // 项目配置指向 c51，但显式 ozwSessionId 应该是 c77
  await setupProjectConfig(projectPath, 51, 'provider_c51');
  await setupCoRequests(coHome);

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
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    await waitForHealth(port, child, () => output);
    const { ws } = await registerAndConnect(port);

    // 同时提供 ozwSessionId=c77 和 sessionId=provider_c51
    ws.send(JSON.stringify({
      type: 'codex-command',
      clientRequestId: 'req_explicit',
      command: 'hello',
      sessionId: 'provider_c51',
      ozwSessionId: 'c77',
      options: {
        projectPath,
        projectName: 'test-project',
        sessionId: 'provider_c51',
        ozwSessionId: 'c77',
        model: 'gpt-5',
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 500));
    ws.close();

    const pending = await readFirstPendingRequest(coHome);
    assert.ok(pending, 'must have a pending request');
    assert.equal(pending.conversation_id, 'c77', 'explicit ozwSessionId must take priority');
  } finally {
    await stopServer(child);
  }
});
