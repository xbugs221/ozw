/**
 * 文件目的：装配聊天 WebSocket command dispatcher。
 * 业务意义：realtime 协议细节保留在 core，scope store/router 作为可单测边界。
 */
import type { WebSocket } from 'ws';
import { registerChatClient as registerChatClientCore, unregisterChatClient as unregisterChatClientCore, createChatCommandDispatcher as createChatCommandDispatcherCore } from './chat-command-dispatcher-core.js';
export { createChatClientScopeStore, normalizeChatClientScope } from './chat-client-scope-store.js';
export { buildChatCommandContext, dispatchChatCommand } from './chat-command-router.js';
import { buildChatCommandContext } from './chat-command-router.js';

export function registerChatClient(runtime: any, ws: WebSocket, userId: string | null): void {
  /** 注册 chat 客户端并保留 scope store 组合边界。 */
  registerChatClientCore(runtime, ws, userId);
}

export function unregisterChatClient(runtime: any, ws: WebSocket): void {
  /** 移除 chat 客户端状态。 */
  unregisterChatClientCore(runtime, ws);
}

export function createChatCommandDispatcher(deps: any, ws: WebSocket, request: any) {
  /** 构建 command context 并委托 core dispatcher。 */
  const context = buildChatCommandContext(deps, ws, request);
  return createChatCommandDispatcherCore(context.deps, context.ws, context.request);
}
