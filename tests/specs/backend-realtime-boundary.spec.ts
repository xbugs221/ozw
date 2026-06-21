/**
 * Sources: 2026-06-17-20-后端realtime协议与provider-runtime分层
 *
 * 文件目的：稳定验证后端聊天 realtime 协议和 provider runtime 已拆成可审查边界。
 * 业务场景：manual cN 会话、follow-up/steer、abort 和私有投递不能继续藏在单个巨型 handler 中。
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_PATH = path.join(REPO_ROOT, 'test-results/backend-realtime-boundary/source-audit.json');

const REQUIRED_BOUNDARY_MODULES = [
  {
    path: 'backend/server/realtime/chat-message-schema.ts',
    markers: ['codex-command', 'pi-command', 'abort-session', 'subscribe-session'],
  },
  {
    path: 'backend/server/realtime/chat-command-runtime.ts',
    markers: ['sendNativeMessage', 'abortNativeSession', 'sessionSubscriptionRegistry'],
  },
  {
    path: 'backend/domains/provider-runtime/provider-event-mappers.ts',
    markers: ['transformPiEvent', 'transformCodex', 'RuntimeEvent'],
  },
  {
    path: 'backend/domains/provider-runtime/runtime-session-store.ts',
    markers: ['findRuntimeSession', 'getNativeSessionStatus', 'abortNativeSession'],
    exportedFunctions: ['findRuntimeSession', 'getNativeSessionStatus', 'abortNativeSession'],
  },
];

/**
 * Read one repository file for source assertions.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Count lines in a source file using a stable newline split.
 */
function countLines(source: string): number {
  return source.split(/\r?\n/).length;
}

/**
 * Return module source when it exists.
 */
async function readOptionalModule(relativePath: string): Promise<{ exists: boolean; source: string }> {
  try {
    await stat(path.join(REPO_ROOT, relativePath));
    return { exists: true, source: await readRepoFile(relativePath) };
  } catch {
    return { exists: false, source: '' };
  }
}

/**
 * Persist boundary evidence for execution review.
 */
async function writeEvidence(snapshot: unknown): Promise<void> {
  await mkdir(path.dirname(EVIDENCE_PATH), { recursive: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

test('backend realtime protocol and provider runtime use focused boundaries', async () => {
  const chatWebSocket = await readRepoFile('backend/server/chat-websocket.ts');
  const chatCommandDispatcher = await readRepoFile('backend/server/realtime/chat-command-runtime.ts');
  const runtimeRouter = await readRepoFile('backend/domains/provider-runtime/runtime-router.ts');
  const moduleSnapshots = [];

  for (const module of REQUIRED_BOUNDARY_MODULES) {
    const { exists, source } = await readOptionalModule(module.path);
    moduleSnapshots.push({
      path: module.path,
      exists,
      lineCount: source ? countLines(source) : 0,
      markersFound: module.markers.filter((marker) => source.includes(marker)),
      exportedFunctionsFound: (module as { exportedFunctions?: string[] }).exportedFunctions?.filter((functionName) => (
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${functionName}\\b`).test(source)
      )) || [],
      hasMarkerOnlyContract: /ContractMarkers|marker-only|Marker-only/i.test(source),
      hasPurposeComment: /PURPOSE|文件目的|职责|协议|runtime/i.test(source),
    });
  }

  const snapshot = {
    chatWebSocketLineCount: countLines(chatWebSocket),
    chatCommandDispatcherLineCount: countLines(chatCommandDispatcher),
    runtimeRouterLineCount: countLines(runtimeRouter),
    chatWebSocketDirectRuntimeCalls: (chatWebSocket.match(/\bsendNativeMessage\(|\babortNativeSession\(/g) || []).length,
    chatWebSocketCommandBranchCount: (chatWebSocket.match(/data\.type\s*===\s*['"]/g) || []).length,
    chatWebSocketRegistersMessageHandler: /ws\.on\(['"]message['"]/.test(chatWebSocket),
    chatWebSocketCallsDispatcher: /createChatCommandDispatcher/.test(chatWebSocket) && /dispatchChatCommand/.test(chatWebSocket),
    chatCommandDispatcherRuntimeCalls: (chatCommandDispatcher.match(/\bsendNativeMessage\(|\babortNativeSession\(|\bgetNativeSessionStatus\(|\bgetActiveNativeSessions\(/g) || []).length,
    chatCommandDispatcherCommandBranchCount: (chatCommandDispatcher.match(/data\.type\s*===\s*['"]/g) || []).length,
    runtimeRouterDefinesPiMapper: /function\s+transformPiEvent/.test(runtimeRouter),
    runtimeRouterDefinesSessionLookup: /function\s+findRuntimeSession/.test(runtimeRouter),
    runtimeRouterDefinesFakeRuntime: /function\s+runFakePiTurn/.test(runtimeRouter),
    modules: moduleSnapshots,
  };

  await writeEvidence(snapshot);

  for (const module of moduleSnapshots) {
    const expected = REQUIRED_BOUNDARY_MODULES.find((entry) => entry.path === module.path)!;
    assert.equal(module.exists, true, `${module.path} 必须存在`);
    assert.equal(module.hasPurposeComment, true, `${module.path} 必须说明业务职责`);
    assert.deepEqual(module.markersFound.sort(), expected.markers.sort(), `${module.path} 必须承载对应协议/runtime 标记`);
    if ('exportedFunctions' in expected) {
      const expectedExports = (expected as { exportedFunctions: string[] }).exportedFunctions;
      assert.deepEqual(module.exportedFunctionsFound.sort(), expectedExports.sort(), `${module.path} 必须导出真实函数，不能只用字符串标记`);
      assert.equal(module.hasMarkerOnlyContract, false, `${module.path} 不得使用 marker-only 契约常量满足验收`);
    }
  }

  assert.ok(snapshot.chatWebSocketLineCount <= 420, `chat-websocket.ts 应收敛为连接边界，当前 ${snapshot.chatWebSocketLineCount} 行`);
  assert.equal(snapshot.chatWebSocketRegistersMessageHandler, true, 'chat-websocket.ts 必须是真正注册 message handler 的可执行入口');
  assert.equal(snapshot.chatWebSocketCallsDispatcher, true, 'chat-websocket.ts 必须调用 realtime dispatcher 边界');
  assert.equal(snapshot.chatWebSocketDirectRuntimeCalls, 0, 'chat-websocket.ts 不应直接承载 send/abort runtime 调用主体');
  assert.equal(snapshot.chatWebSocketCommandBranchCount, 0, 'chat-websocket.ts 不应继续包含 data.type 命令分支');
  assert.ok(snapshot.chatCommandDispatcherRuntimeCalls >= 4, 'chat-command-dispatcher.ts 必须承载 runtime command 调用');
  assert.ok(snapshot.chatCommandDispatcherCommandBranchCount >= 6, 'chat-command-dispatcher.ts 必须承载协议命令分发');
  assert.ok(snapshot.runtimeRouterLineCount <= 760, `runtime-router.ts 应收敛为 provider runtime facade，当前 ${snapshot.runtimeRouterLineCount} 行`);
  assert.equal(snapshot.runtimeRouterDefinesPiMapper, false, 'Pi 事件转换应迁入 provider-event-mappers.ts');
  assert.equal(snapshot.runtimeRouterDefinesSessionLookup, false, 'runtime session lookup 应迁入 runtime-session-store.ts');
  assert.equal(snapshot.runtimeRouterDefinesFakeRuntime, false, 'fake runtime 应迁出 runtime-router.ts');
});
