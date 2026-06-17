/**
 * PURPOSE: Route inbound chat commands to the existing dispatcher boundary.
 * 业务目的：把 command context 构建和分发入口从 WebSocket 连接处理器中拆出。
 */
export function buildChatCommandContext(deps: any, ws: any, request: any) {
  /** 构造 chat command 分发所需上下文。 */
  return { deps, ws, request };
}

export function dispatchChatCommand(dispatcher: (message: unknown) => void, message: unknown): void {
  /** 调用当前连接的 command dispatcher。 */
  dispatcher(message);
}
