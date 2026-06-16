/**
 * 文件目的：定义聊天 WebSocket 的稳定入口。
 * 业务意义：HTTP gateway 只依赖本文件，协议命令和 runtime 分发由 realtime dispatcher 承载。
 */
import type { WebSocket } from 'ws';
import { createChatCommandDispatcher, registerChatClient, unregisterChatClient } from './realtime/chat-command-dispatcher.js';
import { parseChatMessage, type ChatInboundMessage } from './realtime/chat-message-schema.js';

/**
 * 处理聊天 WebSocket 连接生命周期。
 */
export function handleChatConnection(deps: any, ws: WebSocket, request: any): void {
  /**
   * PURPOSE: Keep the executable WebSocket handler as a transport boundary:
   * parse inbound messages, invoke the protocol dispatcher, and release state on close.
   */
  const dispatcher = createChatCommandDispatcher(deps, ws, request);

  ws.on('message', async (message: Buffer | string) => {
    let data: ChatInboundMessage | null = null;
    try {
      data = parseChatMessage(message);
      await dispatcher.dispatchChatCommand(data);
    } catch (error: any) {
      dispatcher.sendProtocolError(data, error);
    }
  });

  ws.on('close', dispatcher.close);
}

export {
  registerChatClient,
  unregisterChatClient,
};
