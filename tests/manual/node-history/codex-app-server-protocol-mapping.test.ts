// @ts-nocheck -- Historical app-server protocol acceptance keeps broad mocked transports; strict migration is tracked by proposal 4 follow-up after shared transport fixture extraction.
/**
 * PURPOSE: Verify Codex app-server protocol mapping correctness:
 * - production transport ensures a daemon and connects through its stdio proxy
 * - cold start resumes existing provider threads instead of creating new ones
 * - abort and abort-and-send include turnId and fail visibly on interrupt errors
 * - app-server notification types and deltas map to frontend-compatible shapes.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { test } from 'node:test';

test('production transport connects to the independent daemon through proxy', async () => {
  const { buildCodexAppServerCliArgs } = await import(
    '../../../backend/domains/codex-app-server/stdio-transport.ts'
  );
  const runtimeSource = await readFile(
    new URL('../../../backend/domains/codex-app-server/stdio-transport.ts', import.meta.url),
    'utf8',
  );
  const lineTransportSource = await readFile(
    new URL('../../../backend/domains/codex-app-server/json-rpc-line-transport.ts', import.meta.url),
    'utf8',
  );
  const args = buildCodexAppServerCliArgs();
  assert.deepEqual(args.slice(0, 3), ['app-server', 'proxy', '--sock']);
  assert.match(args[3], /app-server-control\.sock$/);
  assert.match(
    runtimeSource,
    /spawnSync\(\s*['"]codex['"][\s\S]*ensureDaemonArgs/,
    'production transport must ensure the independent daemon before connecting',
  );
  assert.match(lineTransportSource, /child\.kill\(['"]SIGTERM['"]\)/, 'closing ozw must only close its proxy');
});

test('app-server runtime maps every Codex manual permission mode to YOLO', async () => {
  const policySource = await readFile(
    new URL('../../../backend/codex-permission-policy.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    policySource,
    /approvalPolicy:\s*'never'/,
    'all Codex app-server manual sessions must auto-approve',
  );
  assert.match(
    policySource,
    /sandboxMode:\s*'danger-full-access'/,
    'all Codex app-server manual sessions must bypass sandboxing',
  );
});

test('production transport initializes app-server before first business request', async () => {
  const runtimeSource = await readFile(
    new URL('../../../backend/domains/codex-app-server/json-rpc-line-transport.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    runtimeSource,
    /function ensureInitialized\(\)[\s\S]*sendRawRequest\(\s*['"]initialize['"]/,
    'production transport must perform the app-server initialize handshake',
  );
  assert.match(
    runtimeSource,
    /async request\([\s\S]*method !== ['"]initialize['"][\s\S]*await ensureInitialized\(\)/,
    'non-initialize requests must wait for initialize before thread/start or turn/start',
  );
  assert.match(
    runtimeSource,
    /clientInfo:[\s\S]*name:\s*['"]ozw['"][\s\S]*capabilities:[\s\S]*experimentalApi:\s*true/,
    'initialize payload must identify ozw and opt into the experimental app-server API',
  );
});

test('transformAppServerItem maps camelCase ThreadItem types to snake_case itemType', async () => {
  const { transformAppServerItem } = await import(
    '../../../backend/codex-app-server-runtime.ts'
  );

  const agentMessage = transformAppServerItem({
    type: 'agentMessage',
    id: 'msg-1',
    text: 'hello',
    phase: null,
    memoryCitation: null,
  });
  assert.equal(agentMessage.itemType, 'agent_message');
  assert.equal(agentMessage.itemId, 'msg-1');

  const commandExecution = transformAppServerItem({
    type: 'commandExecution',
    id: 'cmd-1',
    command: 'ls',
    cwd: '/tmp',
    processId: null,
    source: 'user',
    status: 'completed',
    commandActions: [],
    aggregatedOutput: 'output',
    exitCode: 0,
    durationMs: 100,
  });
  assert.equal(commandExecution.itemType, 'command_execution');
  assert.equal(commandExecution.output, 'output');
  assert.equal(commandExecution.exitCode, 0);

  const fileChange = transformAppServerItem({
    type: 'fileChange',
    id: 'fc-1',
    changes: [],
    status: 'applied',
  });
  assert.equal(fileChange.itemType, 'file_change');

  const mcpToolCall = transformAppServerItem({
    type: 'mcpToolCall',
    id: 'mcp-1',
    server: 's',
    tool: 't',
    status: 'completed',
    arguments: {},
    pluginId: null,
    result: null,
    error: null,
    durationMs: null,
  });
  assert.equal(mcpToolCall.itemType, 'mcp_tool_call');

  const updatePlan = transformAppServerItem({
    type: 'update',
    item: {
      type: 'functionCall',
      id: 'call-plan-1',
      name: 'update_plan',
      arguments: {
        explanation: '实时更新计划',
        plan: [{ step: '修复 Codex WS update 渲染', status: 'in_progress' }],
      },
    },
  });
  assert.equal(updatePlan.itemType, 'function_call');
  assert.equal(updatePlan.itemId, 'call-plan-1');
  assert.equal(updatePlan.item.name, 'update_plan');
  assert.equal(updatePlan.item.call_id, 'call-plan-1');
  assert.deepEqual(updatePlan.item.arguments.plan, [
    { step: '修复 Codex WS update 渲染', status: 'in_progress' },
  ]);

  const updatePlanOutput = transformAppServerItem({
    type: 'functionCallOutput',
    callId: 'call-plan-1',
    output: { ok: true },
  });
  assert.equal(updatePlanOutput.itemType, 'function_call_output');
  assert.equal(updatePlanOutput.item.call_id, 'call-plan-1');
  assert.deepEqual(updatePlanOutput.item.output, { ok: true });
});

test('handleAppServerNotification handles agentMessage delta and commandExecution outputDelta', async () => {
  const { handleAppServerNotification } = await import(
    '../../../backend/codex-app-server-runtime.ts'
  );

  const messages = [];
  const session = {
    ozwSessionId: 'c1',
    providerThreadId: 'thread-1',
    activeTurnId: 'turn-1',
    status: 'running',
    projectPath: '/tmp',
    writer: { send: (msg) => messages.push(msg) },
    liveMessages: [],
  };

  handleAppServerNotification(session, {
    method: 'item/agentMessage/delta',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      delta: 'partial text',
    },
  });
  session.streamingDeltaBatcher.flushAll();

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'codex-response');
  assert.equal(messages[0].data.itemType, 'agent_message');
  assert.equal(messages[0].data.itemId, 'item-1');
  assert.equal(messages[0].data.status, 'in_progress');
  assert.equal(messages[0].data.delta.text, 'partial text');

  handleAppServerNotification(session, {
    method: 'item/commandExecution/outputDelta',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-2',
      delta: 'stdout chunk',
    },
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[1].type, 'codex-response');
  assert.equal(messages[1].data.itemType, 'command_execution');
  assert.equal(messages[1].data.itemId, 'item-2');
  assert.equal(messages[1].data.output, 'stdout chunk');

  handleAppServerNotification(session, {
    method: 'item/updated',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      update: {
        type: 'functionCall',
        id: 'call-plan-1',
        name: 'update_plan',
        arguments: { explanation: '实时计划', plan: [{ step: '渲染工具卡', status: 'pending' }] },
      },
    },
  });

  assert.equal(messages.length, 3);
  assert.equal(messages[2].type, 'codex-response');
  assert.equal(messages[2].data.itemType, 'function_call');
  assert.equal(messages[2].data.item.name, 'update_plan');
});

test('cold start with real providerSessionId resumes thread instead of starting new', async () => {
  const {
    sendCodexAppServerMessage,
    clearCodexAppServerSessionsForTest,
  } = await import('../../../backend/codex-app-server-runtime.ts');

  clearCodexAppServerSessionsForTest();

  const requests = [];
  const transport = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === 'thread/resume') {
        return { thread: { id: params.threadId } };
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread_new' } };
      }
      if (method === 'turn/start') {
        return { turn: { id: 'turn_1' } };
      }
      return {};
    },
    onNotification() {},
    close() {},
  };

  await sendCodexAppServerMessage(
    {
      ozwSessionId: 'c1',
      projectPath: '/tmp',
      text: 'hello',
      providerSessionId: 'thread_existing_123',
      writer: { send: () => {} },
    },
    transport,
  );

  const resumeRequest = requests.find((r) => r.method === 'thread/resume');
  assert.ok(
    resumeRequest,
    'must resume existing thread when providerSessionId is present',
  );
  assert.equal(resumeRequest.params.threadId, 'thread_existing_123');
  assert.ok(
    !requests.some((r) => r.method === 'thread/start'),
    'must not start a new thread when resuming',
  );
});

test('cold start with placeholder cN providerSessionId starts new thread', async () => {
  const {
    sendCodexAppServerMessage,
    clearCodexAppServerSessionsForTest,
  } = await import('../../../backend/codex-app-server-runtime.ts');

  clearCodexAppServerSessionsForTest();

  const requests = [];
  const transport = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === 'thread/start') {
        return { thread: { id: 'thread_new' } };
      }
      if (method === 'turn/start') {
        return { turn: { id: 'turn_1' } };
      }
      return {};
    },
    onNotification() {},
    close() {},
  };

  await sendCodexAppServerMessage(
    {
      ozwSessionId: 'c1',
      projectPath: '/tmp',
      text: 'hello',
      providerSessionId: 'c1',
      writer: { send: () => {} },
    },
    transport,
  );

  assert.ok(
    requests.some((r) => r.method === 'thread/start'),
    'must start new thread when providerSessionId is placeholder cN',
  );
  assert.ok(
    !requests.some((r) => r.method === 'thread/resume'),
    'must not resume when providerSessionId is placeholder cN',
  );
});

test('abort sends turn/interrupt with turnId and fails if interrupt fails', async () => {
  const {
    abortCodexAppServerSession,
    sendCodexAppServerMessage,
    clearCodexAppServerSessionsForTest,
  } = await import('../../../backend/codex-app-server-runtime.ts');

  clearCodexAppServerSessionsForTest();

  const writerMessages = [];
  let shouldFailInterrupt = false;

  const transport = {
    async request(method, params) {
      if (method === 'thread/start') return { thread: { id: 'thread_1' } };
      if (method === 'turn/start') return { turn: { id: 'turn_1' } };
      if (method === 'turn/interrupt') {
        assert.equal(params.turnId, 'turn_1', 'turn/interrupt must include turnId');
        if (shouldFailInterrupt) throw new Error('interrupt rejected');
        return {};
      }
      return {};
    },
    onNotification() {},
    close() {},
  };

  await sendCodexAppServerMessage(
    {
      ozwSessionId: 'c1',
      projectPath: '/tmp',
      text: 'hello',
      writer: { send: (msg) => writerMessages.push(msg) },
    },
    transport,
  );

  // Successful abort
  const result1 = await abortCodexAppServerSession('c1', '/tmp', transport);
  assert.equal(result1, true);
  assert.ok(
    writerMessages.some((m) => m.type === 'session-aborted' && m.success === true),
    'successful abort must broadcast success',
  );

  shouldFailInterrupt = true;
  writerMessages.length = 0;

  // Need a new session to test failed abort
  await sendCodexAppServerMessage(
    {
      ozwSessionId: 'c2',
      projectPath: '/tmp',
      text: 'hello again',
      writer: { send: (msg) => writerMessages.push(msg) },
    },
    transport,
  );

  const result2 = await abortCodexAppServerSession('c2', '/tmp', transport);
  assert.equal(result2, false);
  assert.ok(
    writerMessages.some((m) => m.type === 'codex-error'),
    'failed interrupt must emit codex-error',
  );
  assert.ok(
    !writerMessages.some((m) => m.type === 'session-aborted' && m.success === true),
    'failed abort must not broadcast success=true',
  );
});

test('abort-and-send sends turn/interrupt with turnId and does not start new turn on failure', async () => {
  const {
    sendCodexAppServerMessage,
    clearCodexAppServerSessionsForTest,
  } = await import('../../../backend/codex-app-server-runtime.ts');

  clearCodexAppServerSessionsForTest();

  const requests = [];
  const writerMessages = [];

  const transport = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === 'thread/start') return { thread: { id: 'thread_1' } };
      if (method === 'turn/start') return { turn: { id: 'turn_1' } };
      if (method === 'turn/interrupt') {
        assert.equal(params.turnId, 'turn_1', 'turn/interrupt must include turnId');
        throw new Error('interrupt rejected');
      }
      return {};
    },
    onNotification() {},
    close() {},
  };

  await sendCodexAppServerMessage(
    {
      ozwSessionId: 'c1',
      projectPath: '/tmp',
      text: 'hello',
      writer: { send: (msg) => writerMessages.push(msg) },
    },
    transport,
  );

  // Clear requests from first message
  requests.length = 0;

  const result = await sendCodexAppServerMessage(
    {
      ozwSessionId: 'c1',
      projectPath: '/tmp',
      text: 'hello after abort',
      runningBehavior: 'abort-and-send',
      writer: { send: (msg) => writerMessages.push(msg) },
    },
    transport,
  );

  assert.equal(result.accepted, false, 'must reject when interrupt fails');
  assert.ok(requests.some((r) => r.method === 'turn/interrupt'), 'must call turn/interrupt');
  assert.ok(
    !requests.some((r) => r.method === 'turn/start'),
    'must not start new turn when interrupt fails',
  );
  assert.ok(
    writerMessages.some((m) => m.type === 'codex-error'),
    'must emit codex-error on interrupt failure',
  );
});

test('same session does not register duplicate notification handlers across multiple sends', async () => {
  const {
    sendCodexAppServerMessage,
    clearCodexAppServerSessionsForTest,
  } = await import('../../../backend/codex-app-server-runtime.ts');

  clearCodexAppServerSessionsForTest();

  const writerMessages = [];
  let handlerCount = 0;

  const transport = {
    async request(method) {
      if (method === 'thread/start') return { thread: { id: 'thread_1' } };
      if (method === 'turn/start') return { turn: { id: 'turn_1' } };
      if (method === 'turn/steer') return {};
      return {};
    },
    onNotification(handler) {
      handlerCount += 1;
      // Store the handler so we can invoke it manually later
      this._handler = handler;
    },
    _handler: null,
    close() {},
  };

  await sendCodexAppServerMessage(
    {
      ozwSessionId: 'c1',
      projectPath: '/tmp',
      text: 'hello',
      writer: { send: (msg) => writerMessages.push(msg) },
    },
    transport,
  );

  assert.equal(handlerCount, 1, 'first message must register exactly one notification handler');

  await sendCodexAppServerMessage(
    {
      ozwSessionId: 'c1',
      projectPath: '/tmp',
      text: 'steer this',
      runningBehavior: 'steer',
      writer: { send: (msg) => writerMessages.push(msg) },
    },
    transport,
  );

  assert.equal(handlerCount, 1, 'steer must not register additional notification handler');

  // Simulate a single app-server notification being delivered
  if (transport._handler) {
    transport._handler({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'item-1',
        delta: 'delta text',
      },
    });
  }
  await wait(1100);

  const codexResponses = writerMessages.filter((m) => m.type === 'codex-response');
  assert.equal(
    codexResponses.length,
    1,
    'single app-server notification must produce exactly one codex-response',
  );
});

test('backend/index Codex branch does not unconditionally broadcast message-accepted', async () => {
  const serverIndexSource = await readFile(
    new URL('../../../backend/server/chat-websocket.ts', import.meta.url),
    'utf8',
  );

  // Find the codex-command branch and check that sendMessageAccepted is not
  // called unconditionally after sendNativeMessage.
  const codexBranchMatch = serverIndexSource.match(
    /data\.type === ['"]codex-command['"][\s\S]*?(?=\} else if \(data\.type === ['"]pi-command['"])/,
  );
  assert.ok(codexBranchMatch, 'must find codex-command branch in backend/index.ts');
  const codexBranch = codexBranchMatch[0];

  assert.match(
    codexBranch,
    /const result = await sendNativeMessage/,
    'must await sendNativeMessage result in codex branch',
  );
  assert.doesNotMatch(
    codexBranch,
    /sendMessageAccepted\s*\(\s*codexRuntimeWriter\s*,/,
    'must not unconditionally call sendMessageAccepted after sendNativeMessage in codex branch',
  );
  assert.match(
    codexBranch,
    /Codex accepted\/rejected is handled by the runtime/,
    'must document that Codex runtime handles accepted/rejected events',
  );
});

test('app-server proxy close preserves daemon turns, resets subscriptions, and clears sharedTransport', async () => {
  const sessionManagerSource = await readFile(
    new URL('../../../backend/domains/codex-app-server/session-manager.ts', import.meta.url),
    'utf8',
  );
  const transportSource = await readFile(
    new URL('../../../backend/domains/codex-app-server/json-rpc-line-transport.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    sessionManagerSource,
    /markTransportDisconnected\s*\(/,
    'must define shared proxy disconnect recovery',
  );
  assert.match(
    transportSource,
    /child\.on\('close',[\s\S]{0,300}onFailure/,
    'must call failure handler on child close',
  );
  assert.match(
    transportSource,
    /child\.on\('error',[\s\S]{0,300}onFailure/,
    'must call failure handler on child error',
  );
  assert.match(
    sessionManagerSource,
    /markTransportDisconnected[\s\S]{0,600}codex-connection-lost/,
    'proxy disconnect must be reported separately from a user abort',
  );
  assert.match(
    sessionManagerSource,
    /markTransportDisconnected[\s\S]{0,500}notificationSubscribed\s*=\s*false/,
    'proxy disconnect must allow notification subscription to be restored',
  );
});

test('concurrent session starts do not cross-assign thread/started notifications', async () => {
  const {
    sendCodexAppServerMessage,
    clearCodexAppServerSessionsForTest,
  } = await import('../../../backend/codex-app-server-runtime.ts');

  clearCodexAppServerSessionsForTest();

  const writerMessages = { c1: [], c2: [] };
  const notificationHandlers = [];

  let startCount = 0;
  const transport = {
    async request(method, params) {
      if (method === 'thread/start') {
        startCount += 1;
        const threadId = `thread_${startCount}`;
        // Simulate a broadcast notification from another session's thread
        // arriving BEFORE this request returns (while providerThreadId is
        // still unknown in the old buggy code).
        for (const handler of notificationHandlers) {
          handler({
            method: 'thread/started',
            params: {
              thread: { id: 'thread_malicious' }, // not belonging to either session
            },
          });
        }
        return { thread: { id: threadId } };
      }
      if (method === 'turn/start') {
        return { turn: { id: `turn_${params.threadId}` } };
      }
      return {};
    },
    onNotification(handler) {
      notificationHandlers.push(handler);
    },
    close() {},
  };

  // Launch both sessions concurrently
  await Promise.all([
    sendCodexAppServerMessage(
      {
        ozwSessionId: 'c1',
        projectPath: '/tmp',
        text: 'hello c1',
        writer: { send: (msg) => writerMessages.c1.push(msg) },
      },
      transport,
    ),
    sendCodexAppServerMessage(
      {
        ozwSessionId: 'c2',
        projectPath: '/tmp',
        text: 'hello c2',
        writer: { send: (msg) => writerMessages.c2.push(msg) },
      },
      transport,
    ),
  ]);

  // Neither session should have accepted the malicious thread/started
  const c1Created = writerMessages.c1.filter((m) => m.type === 'session-created');
  const c2Created = writerMessages.c2.filter((m) => m.type === 'session-created');

  assert.equal(c1Created.length, 1, 'c1 must receive exactly one session-created');
  assert.equal(c1Created[0].sessionId, 'thread_1', 'c1 session-created must match its own thread');

  assert.equal(c2Created.length, 1, 'c2 must receive exactly one session-created');
  assert.equal(c2Created[0].sessionId, 'thread_2', 'c2 session-created must match its own thread');
});
