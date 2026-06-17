/**
 * 文件目的：验证 server boundary refactor 后 chat scope、command router 和 file helpers 的业务边界。
 * 业务风险：后端边界错误会导致 realtime 事件串用户、文件树暴露沉重目录或权限展示错误。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatClientScopeStore, normalizeChatClientScope } from '../../backend/server/realtime/chat-client-scope-store.ts';
import { buildChatCommandContext, dispatchChatCommand } from '../../backend/server/realtime/chat-command-router.ts';
import { shouldSkipProjectTreeEntry, permissionBitsToRwx, expandWorkspacePath } from '../../backend/server/files/file-route-helpers.ts';

test('chat-client-scope-store normalizes private realtime ownership', () => {
  /** provider session 和 request id 至少一个存在时才记录私有 scope。 */
  assert.equal(normalizeChatClientScope({}, 'u1'), null);
  const scope = normalizeChatClientScope({ sessionId: 'c1', provider: 'codex', cwd: '/repo' }, 'u1');
  assert.equal(scope?.ozwSessionId, 'c1');
  const store = createChatClientScopeStore();
  const client = {};
  store.set(client, [scope!]);
  assert.equal(store.get(client).length, 1);
});

test('chat-command-router builds context and dispatches command', () => {
  /** command router 必须保留 ws/request 上下文并调用连接级 dispatcher。 */
  const context = buildChatCommandContext({ a: 1 }, 'ws', 'req');
  assert.deepEqual(context, { deps: { a: 1 }, ws: 'ws', request: 'req' });
  let received: unknown = null;
  dispatchChatCommand((message) => { received = message; }, { type: 'ping' });
  assert.deepEqual(received, { type: 'ping' });
});

test('file-route-helpers protect project file tree and workspace expansion', () => {
  /** 文件树应跳过沉重目录，并稳定展示权限文本。 */
  assert.equal(shouldSkipProjectTreeEntry('node_modules'), true);
  assert.equal(permissionBitsToRwx(5), 'r-x');
  assert.equal(expandWorkspacePath('~/demo', { WORKSPACES_ROOT: '/workspace', path: { join: (...parts: string[]) => parts.join('/') } }), '/workspace/demo');
});
