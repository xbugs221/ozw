// @ts-nocheck -- Historical steer-runtime acceptance uses loose mock transports; proposal 4 keeps behavior coverage while the shared app-server mock type is extracted separately.
/**
 * PURPOSE: Verify Codex manual chat uses the app-server steer protocol for
 * running user input instead of queueing it behind the active turn.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * Build a text input payload matching Codex app-server v2 UserInput.
 */
function textInput(text) {
  return [{ type: 'text', text, text_elements: [] }];
}

test('Codex running manual input sends turn/steer with the active turn precondition', async () => {
  const { createCodexAppServerRuntimeForTest } = await import('../../backend/codex-app-server-runtime.ts');

  const requests = [];
  const notifications = [];
  const writerMessages = [];

  const transport = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === 'thread/start') {
        return {
          thread: { id: 'thread_steer_contract' },
          model: 'gpt-5-codex',
          modelProvider: 'openai',
          serviceTier: null,
          cwd: '/tmp/ozw-fixture',
          instructionSources: [],
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
          sandbox: { mode: 'workspace-write' },
          reasoningEffort: null,
        };
      }
      if (method === 'turn/start') {
        return {
          turn: {
            id: 'turn_initial',
            items: [],
            itemsView: 'full',
            status: 'inProgress',
            error: null,
            startedAt: 1,
            completedAt: null,
            durationMs: null,
          },
        };
      }
      if (method === 'turn/steer') {
        return { turnId: 'turn_initial' };
      }
      throw new Error(`Unexpected request ${method}`);
    },
    onNotification(handler) {
      notifications.push(handler);
    },
  };

  const runtime = createCodexAppServerRuntimeForTest({
    transport,
    writer: { send: (message) => writerMessages.push(message) },
    projectPath: '/tmp/ozw-fixture',
  });

  await runtime.sendMessage({
    ozwSessionId: 'c1',
    text: 'first long running request',
    runningBehavior: undefined,
    model: 'gpt-5-codex',
    reasoningEffort: 'medium',
    permissionMode: 'bypassPermissions',
    clientRequestId: 'req_first',
  });

  assert.deepEqual(
    requests.map((request) => request.method),
    ['thread/start', 'turn/start'],
    'first Codex manual message must create/resume a thread and start a turn',
  );

  assert.equal(notifications.length, 1, 'runtime must subscribe to app-server notifications');
  notifications[0]({
    method: 'turn/started',
    params: {
      threadId: 'thread_steer_contract',
      turn: {
        id: 'turn_initial',
        items: [],
        itemsView: 'full',
        status: 'inProgress',
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null,
      },
    },
  });

  await runtime.sendMessage({
    ozwSessionId: 'c1',
    text: 'steer this active turn now',
    runningBehavior: 'steer',
    model: 'gpt-5-codex',
    reasoningEffort: 'medium',
    permissionMode: 'bypassPermissions',
    clientRequestId: 'req_steer',
  });

  const steerRequest = requests.find((request) => request.method === 'turn/steer');
  assert.ok(steerRequest, 'running Codex input must use turn/steer');
  assert.equal(steerRequest.params.threadId, 'thread_steer_contract');
  assert.equal(steerRequest.params.expectedTurnId, 'turn_initial');
  assert.deepEqual(steerRequest.params.input, textInput('steer this active turn now'));
  assert.ok(
    !requests.some((request) => request.method === 'queue'),
    'Codex running input must not be hidden behind a local queue',
  );
  assert.ok(
    writerMessages.some((message) => message.type === 'message-accepted' && message.clientRequestId === 'req_steer'),
    'accepted steer input must acknowledge the specific optimistic user message',
  );
});

test('Codex steer rejects visible user input when no active turn id is known', async () => {
  const { createCodexAppServerRuntimeForTest } = await import('../../backend/codex-app-server-runtime.ts');
  const writerMessages = [];
  const runtime = createCodexAppServerRuntimeForTest({
    transport: {
      async request(method) {
        throw new Error(`No app-server request expected for ${method}`);
      },
      onNotification() {},
    },
    writer: { send: (message) => writerMessages.push(message) },
    projectPath: '/tmp/ozw-fixture',
  });

  runtime.__setSessionStateForTest({
    ozwSessionId: 'c2',
    providerThreadId: 'thread_without_turn',
    status: 'running',
    activeTurnId: null,
  });

  await runtime.sendMessage({
    ozwSessionId: 'c2',
    text: 'cannot safely steer without an active turn',
    runningBehavior: 'steer',
    clientRequestId: 'req_missing_turn',
  });

  assert.ok(
    writerMessages.some((message) => (
      message.type === 'steer-rejected'
      && message.clientRequestId === 'req_missing_turn'
      && String(message.error || '').includes('active turn')
    )),
    'missing active turn must reject the optimistic steer instead of silently queueing it',
  );
});
