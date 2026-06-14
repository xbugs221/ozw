// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify ozw submits chat operations through the co file protocol instead of local provider runners.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  assertCoHomeDirectory,
  assertCoProviderAvailable,
  buildCoRequest,
  isCoProviderAvailable,
  normalizeCoProviders,
  readCoConversationState,
  runCoDoctor,
  tailCoEvents,
  writeCoRequest,
} from '../../../backend/co-client.ts';

async function makeCoHome() {
  /**
   * Create an isolated co home fixture with the directory shape used by the daemon.
   */
  return fs.mkdtemp(path.join(os.tmpdir(), 'ozw-co-client-'));
}

async function writeFakeCommand(binDir, name, body) {
  /**
   * Create an executable command fixture for doctor protocol tests.
   */
  const filePath = path.join(binDir, name);
  await fs.writeFile(filePath, body, { mode: 0o755 });
  return filePath;
}

test('Codex message writes an atomic co-request-v1 file without UI metadata', async () => {
  const coHome = await makeCoHome();
  const request = buildCoRequest({
    requestId: 'req_codex_1',
    conversationId: 'c12',
    projectPath: '/tmp/project',
    provider: 'codex',
    text: 'implement the change',
    options: {
      model: 'gpt-5.3-codex',
      reasoningEffort: 'low',
      permissionMode: 'default',
    },
    attachments: [{ path: '/tmp/project/a.txt', name: 'a.txt', transientPreviewUrl: 'blob:ui-only' }],
    actor: { userId: 'local', deviceId: 'device_1', windowId: 'window_1' },
  });

  const result = await writeCoRequest(request, { coHome });
  const files = await fs.readdir(path.join(coHome, 'requests', 'pending'));
  const persisted = JSON.parse(await fs.readFile(result.path, 'utf8'));

  assert.deepEqual(files, ['req_codex_1.json']);
  assert.equal(persisted.contract, 'co-request-v1');
  assert.equal(persisted.op, 'message');
  assert.equal(persisted.conversation_id, 'c12');
  assert.equal(persisted.project_path, '/tmp/project');
  assert.equal(persisted.provider, 'codex');
  assert.equal(persisted.text, 'implement the change');
  assert.equal(persisted.options.reasoning_effort, 'low');
  assert.equal(persisted.attachments[0].path, '/tmp/project/a.txt');
  assert.equal(Object.hasOwn(persisted.attachments[0], 'transientPreviewUrl'), false);
  assert.equal(Object.hasOwn(persisted, 'routeIndex'), false);
  assert.equal(Object.hasOwn(persisted, 'summary'), false);
});

test('co home file is rejected before pending request write', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-co-home-file-'));
  const coHome = path.join(tempRoot, 'co');
  await fs.writeFile(coHome, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const request = buildCoRequest({
    requestId: 'req_bad_home',
    conversationId: 'c12',
    projectPath: '/tmp/project',
    provider: 'codex',
    text: 'hello',
  });

  await assert.rejects(
    () => assertCoHomeDirectory(coHome),
    /co home is not a directory/,
  );
  await assert.rejects(
    () => writeCoRequest(request, { coHome }),
    /co home is not a directory/,
  );
});

test('co doctor marks binary-shaped home as unavailable', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-co-doctor-home-'));
  const binDir = path.join(tempRoot, 'bin');
  const coHome = path.join(tempRoot, 'co');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(coHome, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const payload = JSON.stringify({
    ok: true,
    contract: 'co-request-v1',
    version: 'co-test',
    home: coHome,
    providers: { codex: true, opencode: true },
  });
  const fakeCo = await writeFakeCommand(binDir, 'co', [
    '#!/bin/sh',
    'if [ "$1" = "doctor" ] && [ "$2" = "--json" ]; then',
    `  printf '%s\\n' '${payload}'`,
    '  exit 0',
    'fi',
    'exit 1',
  ].join('\n'));

  const status = await runCoDoctor({ command: fakeCo, timeoutMs: 500 });

  assert.equal(status.ok, false);
  assert.equal(status.home, coHome);
  assert.match(status.error, /co home is not a directory/);
});

test('OpenCode running-turn intervention preserves active_policy and target_turn_id', async () => {
  const request = buildCoRequest({
    requestId: 'req_opencode_steer',
    conversationId: 'c12',
    projectPath: '/tmp/project',
    provider: 'opencode',
    text: 'change direction',
    activePolicy: 'abort_and_send',
    targetTurnId: 'turn_active',
  });

  assert.equal(request.provider, 'opencode');
  assert.equal(request.active_policy, 'abort_and_send');
  assert.equal(request.target_turn_id, 'turn_active');
});

test('stop action writes op=abort request with conversation and target turn', async () => {
  const coHome = await makeCoHome();
  const request = buildCoRequest({
    op: 'abort',
    requestId: 'req_abort_1',
    conversationId: 'c12',
    projectPath: '/tmp/project',
    provider: 'codex',
    targetTurnId: 'turn_active',
  });

  await writeCoRequest(request, { coHome });
  const persisted = JSON.parse(await fs.readFile(path.join(coHome, 'requests', 'pending', 'req_abort_1.json'), 'utf8'));

  assert.equal(persisted.op, 'abort');
  assert.equal(persisted.conversation_id, 'c12');
  assert.equal(persisted.target_turn_id, 'turn_active');
  assert.equal(persisted.text, '');
});

test('refresh recovery reads conversation state and tails subsequent events', async () => {
  const coHome = await makeCoHome();
  await fs.mkdir(path.join(coHome, 'conversations', 'c12'), { recursive: true });
  await fs.mkdir(path.join(coHome, 'turns', 'turn_active'), { recursive: true });
  await fs.writeFile(path.join(coHome, 'conversations', 'c12', 'state.json'), JSON.stringify({
    contract: 'co-conversation-v1',
    conversation_id: 'c12',
    project_path: '/tmp/project',
    provider: 'codex',
    active_turn_id: 'turn_active',
    status: 'running',
  }));

  const state = await readCoConversationState('c12', { coHome });
  const events = [];
  const tail = tailCoEvents('turn_active', (event) => events.push(event), { coHome, pollMs: 20 });
  await fs.writeFile(path.join(coHome, 'turns', 'turn_active', 'events.jsonl'), `${JSON.stringify({
    type: 'codex-response',
    provider: 'codex',
    turn_id: 'turn_active',
    conversation_id: 'c12',
    session_id: 'provider_1',
    data: { text: 'continued after refresh' },
  })}\n`);

  await new Promise((resolve) => setTimeout(resolve, 80));
  tail.close();

  assert.equal(state.active_turn_id, 'turn_active');
  assert.equal(events.length, 1);
  assert.equal(events[0].conversation_id, 'c12');
});

test('co doctor failure reports unavailable chat execution without runner fallback', async () => {
  const status = await runCoDoctor({ command: 'ozw-missing-co-binary-for-test', timeoutMs: 50 });

  assert.equal(status.ok, false);
  assert.match(status.error, /ENOENT|not found|spawn/);
});

test('co doctor provider availability is checked per target provider', () => {
  const status = {
    ok: true,
    contract: 'co-request-v1',
    providers: {
      codex: { available: true },
      opencode: { available: false },
    },
  };

  assert.equal(isCoProviderAvailable(status, 'codex'), true);
  assert.equal(isCoProviderAvailable(status, 'opencode'), false);
  assert.equal(isCoProviderAvailable(status, 'claude'), false);
});

test('co doctor boolean provider schema is normalized for OpenCode', () => {
  const normalized = normalizeCoProviders({
    codex: true,
    opencode: true,
  });

  assert.deepEqual(normalized, {
    codex: { available: true },
    opencode: { available: true },
  });
  assert.equal(isCoProviderAvailable({ providers: { opencode: true } }, 'opencode'), true);
});

test('provider unavailable error is raised before callers write request files', () => {
  assert.throws(
    () => assertCoProviderAvailable({ error: 'doctor says no', providers: { opencode: false } }, 'opencode'),
    /co provider "opencode" is unavailable: doctor says no/,
  );
});
