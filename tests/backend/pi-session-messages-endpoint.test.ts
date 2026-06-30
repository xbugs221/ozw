// @ts-nocheck -- Test isolation: strict types deferred.
/**
 * 文件目的：验证 Pi 会话消息 API 能从真实原生 Pi JSONL 会话读取用户和助手消息。
 * 业务场景：用户在页面打开 Pi 会话详情时，后端必须返回可展示的对话历史。
 * 用户风险：如果这里失败，用户会看到空会话、错 Provider 消息或无法复核历史回复。
 * 业务场景：最终答案可能被 Pi 写成 stopReason=stop 的 thinking 项，仍应显示给用户。
 * 用户风险：如果 thinking-only 终答被丢弃，用户会误以为任务没有完成。
 * 业务场景：路由草稿和 Provider session 绑定依赖项目配置与原生会话文件共同成立。
 * 失败含义：失败通常指向真实读模型、项目路径解析或 Provider 会话解析合同退化。
 *
 * PURPOSE: Endpoint-level integration test for the session messages API
 * with provider=pi.  Imports the REAL handleGetSessionMessages from
 * backend/session-messages-handler.ts so the test verifies the ACTUAL
 * production handler, not a copy.
 *
 * Updated for native Pi SDK: no co conversation fallback; all reads go
 * through native Pi JSONL session files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

import { handleGetSessionMessages, mergeAndDedupMessages } from '../../backend/session-messages-handler.ts';
import { seedRunningCodexSessionForTest, seedRunningPiSessionForTest } from '../../backend/native-agent-runtime.js';
import {
  clearProviderActiveTurnOverlay,
  recordProviderActiveTurnRuntimeEvent,
  recordProviderActiveTurnUser,
} from '../../backend/domains/provider-runtime/active-turn-store.ts';
import {
  clearProjectDirectoryCache,
  createManualSessionDraft,
  finalizeManualSessionRoute,
  extractProjectDirectory,
} from '../../backend/projects.ts';

/**
 * Minimal mock Express response object for capturing handler output.
 */
function createMockRes() {
  let _status = 200;
  let _json = null;
  return {
    status(code) { _status = code; return this; },
    json(data) { _json = data; return this; },
    getStatus() { return _status; },
    getJson() { return _json; },
  };
}

/**
 * Set up co conversation fixtures under a temporary co home.
 */
async function writeCoFixture(coHome, conversationId, provider, providerSessionId, turns = []) {
  const convDir = path.join(coHome, 'conversations', conversationId);
  await fs.mkdir(convDir, { recursive: true });
  const turnDirNames = turns.map((t) => `turn_req-${t.turn_id}`);
  await fs.writeFile(path.join(convDir, 'state.json'), JSON.stringify({
    conversation_id: conversationId, provider, provider_session_id: providerSessionId, turns: turnDirNames,
  }, null, 2));

  const doneDir = path.join(coHome, 'requests', 'done');
  await fs.mkdir(doneDir, { recursive: true });

  for (const turn of turns) {
    const requestId = `req-${turn.turn_id}`;
    await fs.writeFile(path.join(doneDir, `${requestId}.json`), JSON.stringify({
      request_id: requestId, conversation_id: conversationId,
      text: turn.user_text || '', created_at: turn.created_at || new Date().toISOString(),
    }));
    const turnDir = path.join(coHome, 'turns', `turn_${requestId}`);
    await fs.mkdir(turnDir, { recursive: true });
    await fs.writeFile(path.join(turnDir, 'request.json'), JSON.stringify({ request_id: requestId, conversation_id: conversationId }));
    const lines = (turn.events || []).map((e) => JSON.stringify(e)).join('\n');
    await fs.writeFile(path.join(turnDir, 'events.jsonl'), lines + '\n');
  }
}

/**
 * Write a native Pi JSONL transcript matching Pi Coding Agent's on-disk format.
 */
async function writePiNativeSession(homeDir, sessionId, projectPath) {
  const sessionDir = path.join(homeDir, '.pi', 'agent', 'sessions', 'fixture-project');
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, `2026-05-24T00-38-42-703Z_${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: 'session',
        id: sessionId,
        timestamp: '2026-05-24T00:38:42.703Z',
        cwd: projectPath,
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-user-1',
        timestamp: '2026-05-24T00:38:43.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Pi native workflow user message' }],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-assistant-1',
        parentId: 'pi-user-1',
        timestamp: '2026-05-24T00:38:44.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Pi native thought' },
            { type: 'text', text: 'Pi native workflow reply' },
          ],
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

/**
 * Write a native Codex JSONL transcript matching the app-server replay shape.
 */
async function writeCodexNativeSession(homeDir, sessionId, projectPath) {
  const sessionDir = path.join(homeDir, '.codex', 'sessions', '2026', '06', '06');
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-06-06T10:00:00.000Z',
        payload: {
          id: sessionId,
          cwd: projectPath,
          model: 'gpt-5-codex',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-06-06T10:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Codex native workflow user message',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-06-06T10:00:02.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Codex native workflow reply' }],
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

/**
 * Write a Pi session where the final answer is persisted as a single thinking
 * item with stopReason=stop, matching DeepSeek/Pi transcripts seen in c102.
 */
async function writePiFinalThinkingOnlySession(homeDir, sessionId, projectPath) {
  const sessionDir = path.join(homeDir, '.pi', 'agent', 'sessions', 'fixture-project');
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, `2026-06-03T12-15-14-030Z_${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: 'session',
        id: sessionId,
        timestamp: '2026-06-03T12:15:14.030Z',
        cwd: projectPath,
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-user-final-thinking',
        timestamp: '2026-06-03T12:15:15.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '创建一个新的提案' }],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-assistant-final-thinking',
        parentId: 'pi-user-final-thinking',
        timestamp: '2026-06-03T12:29:22.738Z',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: [
            {
              type: 'thinking',
              thinking: '提案已创建并提交成功。以下是提案概要：\n\n## 提案 #67：修复 Codex 新会话思考深度选择无效',
              thinkingSignature: 'reasoning_content',
            },
          ],
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

/**
 * Write project config at the XDG state path.
 */
async function writeProjectConfig(homeDir, projectName, projectPath) {
  const stateRoot = process.env.XDG_STATE_HOME || path.join(homeDir, '.local', 'state');
  const cfgDir = path.join(stateRoot, 'ozw');
  await fs.mkdir(cfgDir, { recursive: true });
  const cfgPath = path.join(cfgDir, 'conf.json');
  let config = {};
  try { config = JSON.parse(await fs.readFile(cfgPath, 'utf8')); } catch {}
  config[projectName] = { originalPath: projectPath };
  await fs.writeFile(cfgPath, JSON.stringify(config, null, 2));
}

/**
 * Seed a disposable active-turn overlay that mirrors rows already covered by
 * persisted provider history plus one empty pending thinking row.
 */
function seedCoveredActiveTurnOverlay(provider, routeSessionId, projectPath, userText, assistantText) {
  recordProviderActiveTurnUser({
    provider,
    sessionId: routeSessionId,
    projectPath,
    clientRequestId: `${provider}-covered-client`,
    turnAnchorKey: `${provider}-covered-anchor`,
    userText,
  });
  recordProviderActiveTurnRuntimeEvent({
    provider,
    sessionId: routeSessionId,
    projectPath,
    event: {
      type: 'item',
      itemType: 'thinking',
      itemId: `${provider}-empty-thinking`,
      message: { role: 'assistant', content: '' },
    },
  });
  recordProviderActiveTurnRuntimeEvent({
    provider,
    sessionId: routeSessionId,
    projectPath,
    event: {
      type: 'item',
      itemType: 'agent_message',
      itemId: `${provider}-covered-assistant`,
      message: { role: 'assistant', content: assistantText },
    },
  });
}

test('handleGetSessionMessages with provider=pi returns Pi messages from native Pi session', async () => {
  const tempHome = path.join(os.tmpdir(), `ozw-ep-real-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'ozw', 'co');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    const projectPath = path.join(tempHome, 'projects', 'ep-real-project');
    await fs.mkdir(projectPath, { recursive: true });
    await writePiNativeSession(tempHome, 'pi-session-real', projectPath);
    await writeProjectConfig(tempHome, 'ep-real-project', projectPath);
    clearProjectDirectoryCache();

    // 业务场景：直接调用真实生产 handler，保护前端详情页实际依赖的 API 合同。
    // 失败含义：如果状态码或消息结构不对，用户在 Pi 会话页会读不到历史内容。
    const req = {
      params: { projectName: 'ep-real-project', sessionId: 'pi-session-real' },
      query: { provider: 'pi' },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200, `Expected 200, got ${res.getStatus()}`);
    const body = res.getJson();
    assert.ok(Array.isArray(body.messages), 'messages should be an array');
    assert.ok(body.messages.length >= 2, `Expected >= 2 messages, got ${body.messages.length}`);

    const userMsg = body.messages.find((m) => m.type === 'user');
    assert.ok(userMsg, 'Should have user message');
    assert.ok(
      userMsg.message.content.includes('Pi native workflow user message'),
      'Should include Pi native user message',
    );

    const asstMsg = body.messages.find((m) => m.type === 'assistant');
    assert.ok(asstMsg, 'Should have assistant message');
    assert.ok(
      asstMsg.message.content.includes('Pi native workflow reply'),
      'Should include Pi native assistant message',
    );
  } finally {
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('handleGetSessionMessages renders Pi stopReason=stop thinking-only final answer as assistant text', async () => {
  const tempHome = path.join(os.tmpdir(), `ozw-ep-pi-final-thinking-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'ozw', 'co');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    const projectPath = path.join(tempHome, 'projects', 'ep-pi-final-thinking');
    await fs.mkdir(projectPath, { recursive: true });
    await writePiFinalThinkingOnlySession(tempHome, 'pi-session-final-thinking', projectPath);
    await writeProjectConfig(tempHome, 'ep-pi-final-thinking', projectPath);
    clearProjectDirectoryCache();

    const req = {
      params: { projectName: 'ep-pi-final-thinking', sessionId: 'pi-session-final-thinking' },
      query: { provider: 'pi' },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200);
    const body = res.getJson();
    assert.ok(
      body.messages.some((message) => message.type === 'assistant' && message.message?.content.includes('提案已创建并提交成功')),
      'Pi final answer persisted as a thinking item with stopReason=stop must render as assistant text',
    );
    assert.ok(
      !body.messages.some((message) => message.type === 'thinking' && message.message?.content.includes('提案已创建并提交成功')),
      'Pi final answer must not remain hidden in a thinking block',
    );
  } finally {
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('handleGetSessionMessages with provider=pi + no matching co conversation reads native Pi JSONL', async () => {
  const tempHome = path.join(os.tmpdir(), `ozw-ep-real-empty-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'ozw', 'co');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    // Write only a Codex conversation (wrong provider)
    await writeCoFixture(coHome, 'conv-codex-real', 'codex', 'pi-session-missing', []);

    const projectPath = path.join(tempHome, 'projects', 'ep-real-empty');
    await fs.mkdir(projectPath, { recursive: true });
    await writeProjectConfig(tempHome, 'ep-real-empty', projectPath);
    await writePiNativeSession(tempHome, 'pi-session-missing', projectPath);
    clearProjectDirectoryCache();

    const req = {
      params: { projectName: 'ep-real-empty', sessionId: 'pi-session-missing' },
      query: { provider: 'pi' },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200);
    const body = res.getJson();
    assert.ok(Array.isArray(body.messages), 'messages should be an array');
    assert.ok(
      body.messages.some((message) => message.type === 'user' && message.message?.content === 'Pi native workflow user message'),
      'Should render the native Pi user message when co history is absent',
    );
    assert.ok(
      body.messages.some((message) => message.type === 'assistant' && message.message?.content === 'Pi native workflow reply'),
      'Should render the native Pi assistant message when co history is absent',
    );
  } finally {
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('handleGetSessionMessages with provider=pi skips provider guessing and returns native Pi messages', async () => {
  const tempHome = path.join(os.tmpdir(), `ozw-ep-real-noguess-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'ozw', 'co');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    const projectPath = path.join(tempHome, 'projects', 'ep-noguess');
    await fs.mkdir(projectPath, { recursive: true });
    await writePiNativeSession(tempHome, 'pi-session-noguess', projectPath);
    await writeProjectConfig(tempHome, 'ep-noguess', projectPath);
    clearProjectDirectoryCache();

    const req = {
      params: { projectName: 'ep-noguess', sessionId: 'pi-session-noguess' },
      query: { provider: 'pi' },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200);
    const body = res.getJson();
    assert.ok(body.messages.length >= 2);
    const userMsg = body.messages.find((m) => m.type === 'user');
    assert.ok(userMsg, 'Should have user message');
    assert.ok(
      userMsg.message.content.includes('Pi native'),
      'Must return Pi native messages',
    );
  } finally {
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('handleGetSessionMessages keeps finalized Pi cN manual route durable after refresh', async () => {
  const tempHome = path.join(os.tmpdir(), `ozw-ep-pi-cn-refresh-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'ozw', 'co');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    const projectName = 'ep-pi-cn-refresh';
    const projectPath = path.join(tempHome, 'projects', projectName);
    await fs.mkdir(projectPath, { recursive: true });
    await writeProjectConfig(tempHome, projectName, projectPath);
    const draft = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi 手动刷新会话');
    await writePiNativeSession(tempHome, 'pi-provider-cn-refresh', projectPath);
    await finalizeManualSessionRoute(projectName, draft.id, 'pi-provider-cn-refresh', 'pi', projectPath);
    clearProjectDirectoryCache();

    const req = {
      params: { projectName, sessionId: draft.id },
      query: { provider: 'pi', projectPath },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200);
    const body = res.getJson();
    assert.ok(Array.isArray(body.messages), 'messages should be an array');
    assert.ok(
      body.messages.some((message) => message.type === 'user' && message.message?.content.includes('Pi native workflow user message')),
      'refreshing the cN route must read the bound Pi provider user message',
    );
    assert.ok(
      body.messages.some((message) => message.type === 'assistant' && message.message?.content.includes('Pi native workflow reply')),
      'refreshing the cN route must read the bound Pi provider assistant message',
    );
  } finally {
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('cN route session without draft runtime returns empty messages (no co fallback)', async () => {
  // cN route sessions (c51, c123, etc.) no longer read co conversation data.
  // When no manual draft runtime is bound (no pendingProviderSessionId),
  // the handler must return empty messages — it must NOT fall through to
  // co conversation lookup.
  const tempHome = path.join(os.tmpdir(), `ozw-ep-cn-codex-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'ozw', 'co');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    // Write a native Codex session for the project so provider detection
    // would find it if we fell through — but cN route must NOT fall through.
    const projectPath = path.join(tempHome, 'projects', 'ep-cn-project');
    await fs.mkdir(projectPath, { recursive: true });
    await writeProjectConfig(tempHome, 'ep-cn-project', projectPath);
    clearProjectDirectoryCache();

    // No manual draft runtimeContext for c51 — simulates the scenario where
    // getManualSessionDraftRuntime returns null.  The handler must return
    // empty messages because no provider session has been bound yet.
    const req = {
      params: { projectName: 'ep-cn-project', sessionId: 'c51' },
      query: { provider: 'codex' },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200, `Expected 200, got ${res.getStatus()}`);
    const body = res.getJson();
    assert.ok(Array.isArray(body.messages), 'messages should be an array');
    assert.equal(
      body.messages.length, 0,
      `Expected 0 messages for unbound cN session, got ${body.messages.length}`,
    );
  } finally {
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

/**
 * Proposal 67 — verify that a running Pi cN session with both JSONL history
 * and live transcript returns merged-jsonl+live from the real handler.
 *
 * This is the FIRST test that actually exercises the merged-jsonl+live
 * orchestration branch in handleGetSessionMessages (lines 159-173 in
 * session-messages-handler.ts).  Previous tests only covered helper functions
 * or non-cN JSONL-only paths.
 */
test('running Pi cN session with JSONL + live transcript returns merged-jsonl+live', async () => {
  const tempHome = path.join(os.tmpdir(), `ozw-ep-pi-merged-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'ozw', 'co');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;

  try {
    const projectName = 'ep-pi-merged-running';
    const projectPath = path.join(tempHome, 'projects', projectName);
    await fs.mkdir(projectPath, { recursive: true });
    await writeProjectConfig(tempHome, projectName, projectPath);

    // 1. Write JSONL history (a completed turn: user + assistant thinking)
    const providerSid = 'pi-provider-merged-running';
    await writePiNativeSession(tempHome, providerSid, projectPath);

    // 2. Create and finalize a cN manual route bound to the Pi provider session
    const draft = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi merge accept');
    await finalizeManualSessionRoute(projectName, draft.id, providerSid, 'pi', projectPath);

    // 3. Seed a running Pi session with live snapshot messages in the
    //    in-memory native runtime store so getNativeSessionLiveTranscript
    //    returns non-null, non-empty messages.
    seedRunningPiSessionForTest(draft.id, projectPath, [
      {
        type: 'assistant',
        content: 'Live thinking — still streaming...',
        provider: 'pi',
        source: 'pi-live',
        messageKey: 'pi:thinking-1',
        timestamp: '2026-06-03T13:01:00.000Z',
        isThinking: true,
      },
      {
        type: 'assistant',
        content: '',
        provider: 'pi',
        source: 'pi-live',
        messageKey: 'pi:toolu_live_abc',
        timestamp: '2026-06-03T13:01:02.000Z',
        toolName: 'Bash',
        toolInput: { command: 'ls -la' },
        toolCallId: 'toolu_live_abc',
        isToolUse: true,
      },
    ]);

    clearProjectDirectoryCache();

    // 4. Call the REAL handler — this must exercise the merged-jsonl+live branch
    const req = {
      params: { projectName, sessionId: draft.id },
      query: { provider: 'pi', projectPath },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    // 5. Assertions
    assert.equal(res.getStatus(), 200, `Expected 200, got ${res.getStatus()}`);
    const body = res.getJson();

    // Source must be merged-jsonl+live — this is the key assertion
    assert.equal(
      body.source,
      'merged-jsonl+live',
      `Expected source=merged-jsonl+live, got source=${body.source}. The handler merge branch was NOT exercised.`,
    );

    // JSONL history messages must be present
    const jsonlUser = body.messages.find((m) => m.type === 'user');
    assert.ok(jsonlUser, 'JSONL user message must be present in merged result');
    assert.ok(
      jsonlUser.message?.content?.includes('Pi native workflow user message'),
      'JSONL user message must contain expected content',
    );

    const jsonlAsst = body.messages.find((m) => m.type === 'assistant');
    assert.ok(jsonlAsst, 'JSONL assistant message must be present in merged result');
    assert.ok(
      jsonlAsst.message?.content?.includes('Pi native workflow reply'),
      'JSONL assistant message must contain expected content',
    );

    // Live snapshot messages must be present AND normalized to JSONL shape
    const liveThinking = body.messages.find(
      (m) => m.type === 'thinking' && m.message?.content?.includes('Live thinking'),
    );
    assert.ok(liveThinking, 'Live thinking message must be present (normalized to JSONL shape)');

    const liveTool = body.messages.find(
      (m) => m.type === 'tool_use' && m.toolName === 'Bash' && m.toolCallId === 'toolu_live_abc',
    );
    assert.ok(liveTool, 'Live tool_use message must be present (normalized to JSONL shape)');

    // Total messages: >= 4 (user + assistant + thinking + tool), no duplicates
    assert.ok(
      body.messages.length >= 4,
      `Expected >= 4 merged messages, got ${body.messages.length}`,
    );

    const keys = body.messages.map((m) => m.messageKey).filter(Boolean);
    const uniqueKeys = new Set(keys);
    assert.equal(
      keys.length,
      uniqueKeys.size,
      `MessageKey duplicates detected: ${keys.length} keys, ${uniqueKeys.size} unique`,
    );
  } finally {
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('running Codex cN session with JSONL + live transcript returns merged-jsonl+live', async () => {
  const tempHome = path.join(os.tmpdir(), `ozw-ep-codex-merged-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'ozw', 'co');
  const xdgStateHome = path.join(tempHome, '.local', 'state');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;
  const prevXdgStateHome = process.env.XDG_STATE_HOME;

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;
  process.env.XDG_STATE_HOME = xdgStateHome;

  try {
    const projectName = 'ep-codex-merged-running';
    const projectPath = path.join(tempHome, 'projects', projectName);
    await fs.mkdir(projectPath, { recursive: true });
    await writeProjectConfig(tempHome, projectName, projectPath);

    const providerSid = 'codex-provider-merged-running';
    await writeCodexNativeSession(tempHome, providerSid, projectPath);

    const draft = await createManualSessionDraft(projectName, projectPath, 'codex', 'Codex merge accept');
    await finalizeManualSessionRoute(projectName, draft.id, providerSid, 'codex', projectPath);

    seedRunningCodexSessionForTest(draft.id, projectPath, [
      {
        type: 'assistant',
        content: 'Codex live reasoning still streaming...',
        provider: 'codex',
        source: 'codex-live',
        messageKey: 'codex:thinking-live-1',
        timestamp: '2026-06-06T10:00:03.000Z',
        isThinking: true,
      },
      {
        type: 'assistant',
        content: '',
        provider: 'codex',
        source: 'codex-live',
        messageKey: 'codex:tool-live-1',
        timestamp: '2026-06-06T10:00:04.000Z',
        toolName: 'shell_command',
        toolInput: { command: 'pwd' },
        toolCallId: 'codex_tool_live_1',
        isToolUse: true,
      },
    ]);

    clearProjectDirectoryCache();

    const req = {
      params: { projectName, sessionId: draft.id },
      query: { provider: 'codex', projectPath },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200, `Expected 200, got ${res.getStatus()}`);
    const body = res.getJson();
    assert.equal(
      body.source,
      'merged-jsonl+live',
      `Expected source=merged-jsonl+live, got source=${body.source}. Codex running refresh must not return live-only history.`,
    );

    assert.ok(
      body.messages.some((message) =>
        message.type === 'user' && message.message?.content?.includes('Codex native workflow user message')),
      'Codex JSONL user message must survive running cN refresh',
    );
    assert.ok(
      body.messages.some((message) =>
        message.type === 'assistant' && message.message?.content?.includes('Codex native workflow reply')),
      'Codex JSONL assistant message must survive running cN refresh',
    );
    assert.ok(
      body.messages.some((message) =>
        message.type === 'thinking' && message.message?.content?.includes('Codex live reasoning')),
      'Codex live thinking message must be merged into the response',
    );
    assert.ok(
      body.messages.some((message) =>
        message.type === 'tool_use' && message.toolCallId === 'codex_tool_live_1'),
      'Codex live tool message must be merged into the response',
    );

    const keys = body.messages.map((message) => message.messageKey).filter(Boolean);
    assert.equal(keys.length, new Set(keys).size, 'Merged Codex response must not duplicate message keys');
  } finally {
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    if (prevXdgStateHome !== undefined) process.env.XDG_STATE_HOME = prevXdgStateHome; else delete process.env.XDG_STATE_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('unbound Codex cN draft does not read unrelated provider session with same cN id', async () => {
  const tempHome = path.join(os.tmpdir(), `ozw-ep-codex-draft-empty-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'ozw', 'co');
  const xdgStateHome = path.join(tempHome, '.local', 'state');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;
  const prevXdgStateHome = process.env.XDG_STATE_HOME;

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;
  process.env.XDG_STATE_HOME = xdgStateHome;

  try {
    const projectName = 'ep-codex-draft-empty';
    const projectPath = path.join(tempHome, 'projects', projectName);
    const unrelatedProjectPath = path.join(tempHome, 'projects', 'unrelated-codex-history');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(unrelatedProjectPath, { recursive: true });
    await writeProjectConfig(tempHome, projectName, projectPath);

    const draft = await createManualSessionDraft(projectName, projectPath, 'codex', 'Codex empty draft');
    await writeCodexNativeSession(tempHome, draft.id, unrelatedProjectPath);
    clearProjectDirectoryCache();

    const req = {
      params: { projectName, sessionId: draft.id },
      query: { provider: 'codex', projectPath },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200);
    const body = res.getJson();
    assert.deepEqual(body.messages, []);
    assert.equal(body.total, 0);
    assert.equal(body.hasMore, false);
  } finally {
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    if (prevXdgStateHome !== undefined) process.env.XDG_STATE_HOME = prevXdgStateHome; else delete process.env.XDG_STATE_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('Codex cN afterLine refresh returns persisted tail without repeating active-turn overlay', async () => {
  const tempHome = path.join(os.tmpdir(), `ozw-ep-codex-afterline-overlay-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'ozw', 'co');
  const xdgStateHome = path.join(tempHome, '.local', 'state');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;
  const prevXdgStateHome = process.env.XDG_STATE_HOME;
  let routeSessionId = '';
  let projectPath = '';

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;
  process.env.XDG_STATE_HOME = xdgStateHome;

  try {
    const projectName = 'ep-codex-afterline-overlay';
    projectPath = path.join(tempHome, 'projects', projectName);
    await fs.mkdir(projectPath, { recursive: true });
    await writeProjectConfig(tempHome, projectName, projectPath);

    const providerSid = 'codex-provider-afterline-overlay';
    await writeCodexNativeSession(tempHome, providerSid, projectPath);

    const draft = await createManualSessionDraft(projectName, projectPath, 'codex', 'Codex afterLine overlay');
    routeSessionId = draft.id;
    await finalizeManualSessionRoute(projectName, routeSessionId, providerSid, 'codex', projectPath);
    seedCoveredActiveTurnOverlay(
      'codex',
      routeSessionId,
      projectPath,
      'Codex native workflow user message',
      'Codex native workflow reply',
    );
    clearProjectDirectoryCache();

    const req = {
      params: { projectName, sessionId: routeSessionId },
      query: { provider: 'codex', projectPath, afterLine: '2' },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200);
    const body = res.getJson();
    assert.notEqual(
      body.source,
      'history+active-turn-overlay',
      'Codex afterLine refresh must keep pure tail semantics instead of replaying active-turn overlay',
    );
    assert.deepEqual(
      body.messages.map((message) => message.messageKey),
      ['codex:codex-provider-afterline-overlay:line:3:msg:0'],
      'Codex afterLine refresh should return only the new persisted JSONL row',
    );
    assert.equal(
      body.messages.some((message) => message.clientRequestId === 'codex-covered-client'),
      false,
      'Codex afterLine refresh must not repeat the optimistic active-turn user',
    );
    assert.equal(
      body.messages.some((message) => message.type === 'thinking' && !message.message?.content),
      false,
      'Codex afterLine refresh must not return empty active-turn thinking rows',
    );
  } finally {
    if (routeSessionId) clearProviderActiveTurnOverlay('codex', routeSessionId, projectPath);
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    if (prevXdgStateHome !== undefined) process.env.XDG_STATE_HOME = prevXdgStateHome; else delete process.env.XDG_STATE_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('Pi cN afterLine refresh returns persisted tail without repeating active-turn overlay', async () => {
  const tempHome = path.join(os.tmpdir(), `ozw-ep-pi-afterline-overlay-${Date.now()}`);
  const coHome = path.join(tempHome, '.local', 'state', 'ozw', 'co');
  const xdgStateHome = path.join(tempHome, '.local', 'state');
  const prevHome = process.env.HOME;
  const prevCoHome = process.env.CCFLOW_CO_HOME;
  const prevXdgStateHome = process.env.XDG_STATE_HOME;
  let routeSessionId = '';
  let projectPath = '';

  process.env.HOME = tempHome;
  process.env.CCFLOW_CO_HOME = coHome;
  process.env.XDG_STATE_HOME = xdgStateHome;

  try {
    const projectName = 'ep-pi-afterline-overlay';
    projectPath = path.join(tempHome, 'projects', projectName);
    await fs.mkdir(projectPath, { recursive: true });
    await writeProjectConfig(tempHome, projectName, projectPath);

    const providerSid = 'pi-provider-afterline-overlay';
    await writePiNativeSession(tempHome, providerSid, projectPath);

    const draft = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi afterLine overlay');
    routeSessionId = draft.id;
    await finalizeManualSessionRoute(projectName, routeSessionId, providerSid, 'pi', projectPath);
    seedCoveredActiveTurnOverlay(
      'pi',
      routeSessionId,
      projectPath,
      'Pi native workflow user message',
      'Pi native workflow reply',
    );
    clearProjectDirectoryCache();

    const req = {
      params: { projectName, sessionId: routeSessionId },
      query: { provider: 'pi', projectPath, afterLine: '2' },
    };
    const res = createMockRes();
    await handleGetSessionMessages(req, res);

    assert.equal(res.getStatus(), 200);
    const body = res.getJson();
    assert.notEqual(
      body.source,
      'history+active-turn-overlay',
      'Pi afterLine refresh must keep pure tail semantics instead of replaying active-turn overlay',
    );
    assert.deepEqual(
      body.messages.map((message) => message.messageKey),
      [
        'pi:pi-provider-afterline-overlay:line:3:thinking:0',
        'pi:pi-provider-afterline-overlay:line:3:msg:1',
      ],
      'Pi afterLine refresh should return only the new persisted JSONL rows',
    );
    assert.equal(
      body.messages.some((message) => message.clientRequestId === 'pi-covered-client'),
      false,
      'Pi afterLine refresh must not repeat the optimistic active-turn user',
    );
    assert.equal(
      body.messages.some((message) => message.type === 'thinking' && !message.message?.content),
      false,
      'Pi afterLine refresh must not return empty active-turn thinking rows',
    );
  } finally {
    if (routeSessionId) clearProviderActiveTurnOverlay('pi', routeSessionId, projectPath);
    if (prevHome) process.env.HOME = prevHome; else delete process.env.HOME;
    if (prevCoHome !== undefined) process.env.CCFLOW_CO_HOME = prevCoHome; else delete process.env.CCFLOW_CO_HOME;
    if (prevXdgStateHome !== undefined) process.env.XDG_STATE_HOME = prevXdgStateHome; else delete process.env.XDG_STATE_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test('raw active-turn merge inserts follow-up user after the anchored prior turn', () => {
  const merged = mergeAndDedupMessages(
    [
      {
        type: 'message',
        messageKey: 'codex:c68:line:1',
        timestamp: '2026-06-03T10:00:00.000Z',
        message: { role: 'user', content: '上一轮用户消息' },
      },
      {
        type: 'assistant',
        messageKey: 'codex:c68:line:2',
        timestamp: '2026-06-03T10:00:05.000Z',
        message: { role: 'assistant', content: '上一轮 Codex 回复' },
      },
    ],
    [
      {
        type: 'user',
        content: '这一轮新需求',
        provider: 'codex',
        messageKey: 'optimistic:chatreq-c68-2',
        clientRequestId: 'chatreq-c68-2',
        turnAnchorKey: 'codex:c68:line:1',
        timestamp: '2026-06-03T10:01:00.000Z',
      },
      {
        type: 'assistant',
        content: '这一轮 Codex 正在处理',
        provider: 'codex',
        source: 'codex-live',
        messageKey: 'codex-live:c68-2',
        turnAnchorKey: 'codex:c68:line:1',
        timestamp: '2026-06-03T10:01:10.000Z',
      },
    ],
  );

  assert.deepEqual(
    merged.map((message) => `${message.message?.role || message.type}:${message.message?.content || message.content}`),
    [
      'user:上一轮用户消息',
      'assistant:上一轮 Codex 回复',
      'user:这一轮新需求',
      'assistant:这一轮 Codex 正在处理',
    ],
  );
});
