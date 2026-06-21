// @ts-nocheck -- Spec fixture exercises Codex WS event shapes that vary by provider SDK version.
/**
 * Sources: 2026-06-11-97-修复Codex-WS气泡顺序和归属, 2026-06-14-115-隔离多窗口WebSocket消息归属
 *
 * PURPOSE: Verify Codex WebSocket items keep visible rows attached to the
 * intended turn and replayed provider items do not duplicate tool rows.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const WINDOW_OWNERSHIP_EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results', '115-websocket-window-ownership');

/**
 * Import the production live reducer so the spec covers the real WS-to-chat
 * transcript boundary.
 */
async function loadNativeTranscriptModule() {
  const mod = await import(pathToFileURL(`${process.cwd()}/frontend/components/chat/utils/nativeRuntimeTranscript.ts`).href);
  assert.equal(typeof mod.reduceNativeRuntimeEvent, 'function');
  assert.equal(typeof mod.filterRenderableMessages, 'function');
  return mod;
}

/**
 * Read a repository file as UTF-8 text for handler contract checks.
 */
async function readRepoFile(relativePath) {
  return fs.readFile(`${process.cwd()}/${relativePath}`, 'utf8');
}

/**
 * Convert message content into the user-visible text used by business asserts.
 */
function visibleText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(visibleText).join('');
  if (typeof value === 'object') {
    return visibleText(value.text ?? value.content ?? value.output ?? value.result ?? JSON.stringify(value));
  }
  return String(value);
}

/**
 * Create a minimal WebSocket test double for browser-window routing specs.
 */
function createFakeChatWebSocket() {
  const handlers = new Map();

  return {
    readyState: 1,
    sent: [],
    send(payload) {
      /**
       * PURPOSE: Capture outbound server messages so assertions can inspect
       * exactly which browser window received each realtime event.
       */
      this.sent.push(String(payload));
    },
    on(eventName, handler) {
      /**
       * PURPOSE: Register protocol handlers with the same event shape used by
       * ws.WebSocket inside handleChatConnection.
       */
      const existing = handlers.get(eventName) || [];
      existing.push(handler);
      handlers.set(eventName, existing);
    },
    async emitMessage(payload) {
      /**
       * PURPOSE: Simulate one browser protocol message and wait for the backend
       * handler's async runtime work to complete.
       */
      const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
      for (const handler of handlers.get('message') || []) {
        await handler(Buffer.from(serialized));
      }
    },
  };
}

/**
 * Parse all JSON messages captured by a fake chat WebSocket.
 */
function parseWindowMessages(socket) {
  return socket.sent.map((raw) => JSON.parse(raw));
}

/**
 * Wait for async command dispatch side effects in fake WebSocket specs.
 */
async function waitForCondition(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('Codex realtime handlers preserve client request identity across accepted response and complete events', async () => {
  const realtimeSource = await readRepoFile('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
  const websocketSource = await readRepoFile('frontend/contexts/WebSocketContext.tsx');
  const combined = `${realtimeSource}\n${websocketSource}`;

  for (const eventName of ['message-accepted', 'codex-response', 'codex-complete']) {
    assert.match(combined, new RegExp(eventName), `handler must process ${eventName}`);
  }
  assert.match(combined, /clientRequestId|turnId|requestId/, 'Codex realtime path must carry a stable turn identity');
});

test('running Codex command execution stays visible and duplicate WS items are idempotent', async () => {
  const { reduceNativeRuntimeEvent, filterRenderableMessages } = await loadNativeTranscriptModule();
  const previous = [
    {
      type: 'user',
      content: 'turn with tool',
      clientRequestId: 'turn-tool',
      deliveryStatus: 'sent',
      timestamp: '2026-06-10T10:03:00.000Z',
    },
  ];
  const event = {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'command_execution',
      itemId: 'turn-tool-command',
      command: 'printf visible-running-tool',
      output: '',
      status: 'running',
    },
  };

  const once = reduceNativeRuntimeEvent(previous, event);
  const twice = reduceNativeRuntimeEvent(once, event);
  const visible = filterRenderableMessages(twice);
  const toolRows = visible.filter((message) => message.isToolUse && message.toolInput === 'printf visible-running-tool');

  assert.equal(toolRows.length, 1);
  assert.equal(visible.some((message) => visibleText(message.content) === 'turn with tool'), true);
});

test('同一用户多窗口只向 owner 投递 Codex 会话私有 delta', { concurrency: false }, async () => {
  const { handleChatConnection } = await import(pathToFileURL(`${process.cwd()}/backend/server/chat-websocket.ts`).href);
  const { createSessionSubscriptionRegistry } = await import(pathToFileURL(`${process.cwd()}/backend/server/realtime/session-subscription-registry.ts`).href);
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-change-115-project-'));
  const connectedClients = new Set();
  const chatClientUsers = new WeakMap();
  const sessionSubscriptionRegistry = createSessionSubscriptionRegistry();
  const windowA = createFakeChatWebSocket();
  const windowB = createFakeChatWebSocket();

  const deps = {
    connectedClients,
    chatClientUsers,
    broadcastChatEvent(payload, sourceUserId = null) {
      /**
       * PURPOSE: Preserve the same-user broadcast risk so private session
       * routing must bypass this path to pass the business contract.
       */
      const serialized = JSON.stringify(payload);
      connectedClients.forEach((client) => {
        if (client.readyState !== 1) {
          return;
        }
        if (sourceUserId !== null && chatClientUsers.get(client) !== sourceUserId) {
          return;
        }
        client.send(serialized);
      });
    },
    bindManualSessionProvider: async () => undefined,
    finalizeManualSessionRoute: async () => true,
    getManualSessionRouteRuntime: async () => null,
    initManualSessionRoute: async () => ({ started: true }),
    acceptChatRequestId: () => true,
    resolveChatProjectOptions: async (options) => options || {},
    extractProjectDirectory: async () => projectPath,
    resolveCbwSessionStartContext: (data, resolvedOptions) => {
      /**
       * PURPOSE: Resolve the OZW route id from browser command fields so the
       * handler can record the owner scope for the emitting window.
       */
      const candidate = data.ozwSessionId
        || data.ozw_session_id
        || resolvedOptions.ozwSessionId
        || resolvedOptions.ozw_session_id
        || data.sessionId;
      return {
        ozwSessionId: typeof candidate === 'string' ? candidate : '',
        routeInitToken: typeof data.clientRequestId === 'string' ? data.clientRequestId : '',
      };
    },
    resolveCbwRouteSessionIdFromProviderSession: async () => '',
    getSessionModelState: async () => ({}),
    sendNativeMessage: async ({ writer, projectPath: ownedProjectPath }) => {
      /**
       * PURPOSE: Emit through the real handler-provided writer so the spec
       * covers production routing context rather than a hand-built response.
       */
      writer.send({
        type: 'codex-delta',
        sessionId: 'codex-real-window-a',
        providerSessionId: 'codex-real-window-a',
        projectPath: ownedProjectPath,
        provider: 'codex',
        message: {
          role: 'assistant',
          content: '只属于窗口 A 的回复',
        },
      });
      return {
        accepted: true,
        providerSessionId: 'codex-real-window-a',
      };
    },
    sendMessageAccepted: () => undefined,
    abortNativeSession: async () => ({ aborted: true }),
    broadcastSessionModelStateUpdated: () => undefined,
    isCbwRouteSessionId: (sessionId) => typeof sessionId === 'string' && /^c\d+$/.test(sessionId),
    normalizeManualProvider: (provider) => provider === 'pi' ? 'pi' : 'codex',
    getNativeSessionStatus: () => ({ isProcessing: false }),
    getActiveNativeSessions: () => [],
    sessionSubscriptionRegistry,
  };

  handleChatConnection(deps, windowA, { user: { id: 'same-user' } });
  handleChatConnection(deps, windowB, { user: { id: 'same-user' } });

  await windowB.emitMessage({
    type: 'subscribe-session',
    provider: 'codex',
    projectName: 'window-owned-project',
    projectPath,
    sessionId: 'c2',
    ozwSessionId: 'c2',
    options: {
      projectName: 'window-owned-project',
      projectPath,
      cwd: projectPath,
    },
  });

  await windowA.emitMessage({
    type: 'codex-command',
    command: '请只在窗口 A 回复',
    clientRequestId: 'window-a-request-1',
    sessionId: 'c1',
    ozwSessionId: 'c1',
    options: {
      projectName: 'window-owned-project',
      projectPath,
      cwd: projectPath,
      sessionId: 'c1',
      ozwSessionId: 'c1',
    },
  });

  await waitForCondition(() => parseWindowMessages(windowA).some((message) => message.type === 'codex-delta'));
  const messagesForA = parseWindowMessages(windowA);
  const messagesForB = parseWindowMessages(windowB);
  await fs.mkdir(WINDOW_OWNERSHIP_EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(WINDOW_OWNERSHIP_EVIDENCE_DIR, 'runtime-delivery-log.json'),
    `${JSON.stringify({ windowA: messagesForA, windowB: messagesForB }, null, 2)}\n`,
    'utf8',
  );

  const privateDeltaForA = messagesForA.find((message) => message.type === 'codex-delta');
  assert.ok(privateDeltaForA, '窗口 A 必须收到自己发起请求产生的 Codex delta');
  assert.equal(privateDeltaForA?.ozwSessionId, 'c1', '窗口 A 的 delta 必须带 camelCase ozwSessionId');
  assert.equal(privateDeltaForA?.ozw_session_id, 'c1', '窗口 A 的 delta 必须带 snake_case ozw_session_id');
  assert.equal(privateDeltaForA?.provider, 'codex', '窗口 A 的 delta 必须保留 provider 归属');
  assert.equal(privateDeltaForA?.projectPath, projectPath, '窗口 A 的 delta 必须保留 projectPath 归属');
  assert.ok(
    messagesForB.some((message) => message.type === 'session-subscribed' && message.ozwSessionId === 'c2'),
    '窗口 B 必须真实订阅另一个会话 c2，才能覆盖 registry 匹配路径',
  );
  assert.equal(
    messagesForB.some((message) => message.type === 'codex-delta'),
    false,
    '窗口 B 订阅 c2 时不能收到窗口 A 的 c1 会话私有消息',
  );
});

test('Codex websocket command sends uploaded file note to native runtime', { concurrency: false }, async () => {
  /**
   * Business case: chat uploads are useful only if the provider prompt includes
   * the persisted filesystem paths. The WebSocket native runtime branch must
   * pass those paths to sendNativeMessage, not only keep them in the UI bubble.
   */
  const { handleChatConnection } = await import(pathToFileURL(`${process.cwd()}/backend/server/chat-websocket.ts`).href);
  const { createSessionSubscriptionRegistry } = await import(pathToFileURL(`${process.cwd()}/backend/server/realtime/session-subscription-registry.ts`).href);
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-attachment-project-'));
  const connectedClients = new Set();
  const chatClientUsers = new WeakMap();
  const capturedNativeMessages = [];
  const socket = createFakeChatWebSocket();

  const deps = {
    connectedClients,
    chatClientUsers,
    broadcastChatEvent: () => undefined,
    bindManualSessionProvider: async () => undefined,
    finalizeManualSessionRoute: async () => true,
    getManualSessionRouteRuntime: async () => null,
    initManualSessionRoute: async () => ({ started: true }),
    acceptChatRequestId: () => true,
    resolveChatProjectOptions: async (options) => options || {},
    extractProjectDirectory: async () => projectPath,
    resolveCbwSessionStartContext: (data, resolvedOptions) => ({
      ozwSessionId: data.ozwSessionId || resolvedOptions.ozwSessionId || data.sessionId || '',
      routeInitToken: data.clientRequestId || '',
    }),
    resolveCbwRouteSessionIdFromProviderSession: async () => '',
    getSessionModelState: async () => ({}),
    sendNativeMessage: async (input) => {
      capturedNativeMessages.push(input);
      return { accepted: true, providerSessionId: 'codex-upload-provider-session' };
    },
    sendMessageAccepted: () => undefined,
    abortNativeSession: async () => ({ aborted: true }),
    broadcastSessionModelStateUpdated: () => undefined,
    isCbwRouteSessionId: (sessionId) => typeof sessionId === 'string' && /^c\d+$/.test(sessionId),
    normalizeManualProvider: (provider) => provider === 'pi' ? 'pi' : 'codex',
    getNativeSessionStatus: () => ({ isProcessing: false }),
    getActiveNativeSessions: () => [],
    sessionSubscriptionRegistry: createSessionSubscriptionRegistry(),
  };

  handleChatConnection(deps, socket, { user: { id: 'upload-user' } });

  await socket.emitMessage({
    type: 'codex-command',
    command: '请读取上传文件',
    clientRequestId: 'upload-request-1',
    sessionId: 'c9',
    ozwSessionId: 'c9',
    options: {
      projectName: 'attachment-project',
      projectPath,
      cwd: projectPath,
      sessionId: 'c9',
      ozwSessionId: 'c9',
      attachments: [{
        relativePath: 'notes/upload.txt',
        absolutePath: '/tmp/ozw-uploads/upload-user/batch/notes/upload.txt',
        mimeType: 'text/plain',
        size: 42,
      }],
    },
  });

  await waitForCondition(() => capturedNativeMessages.length > 0);
  assert.equal(capturedNativeMessages.length, 1);
  assert.match(capturedNativeMessages[0].text, /请读取上传文件/);
  assert.match(capturedNativeMessages[0].text, /\[User uploaded files for this message\]/);
  assert.match(capturedNativeMessages[0].text, /\/tmp\/ozw-uploads\/upload-user\/batch\/notes\/upload\.txt/);
});
