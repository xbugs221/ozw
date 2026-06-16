/**
 * 文件目的：归一化聊天 WebSocket 入站协议命令。
 * 业务意义：codex-command、pi-command、abort-session 和 subscribe-session 等命令在进入 dispatcher 前拥有统一解析边界。
 */

export type ChatCommandType =
  | 'claude-command'
  | 'codex-command'
  | 'pi-command'
  | 'abort-session'
  | 'claude-permission-response'
  | 'subscribe-session'
  | 'check-session-status'
  | 'get-active-sessions'
  | 'ping';

export type ChatInboundMessage = Record<string, any> & { type?: ChatCommandType | string };

/**
 * Parse a raw WebSocket message into the loose command object used by legacy handlers.
 */
export function parseChatMessage(message: Buffer | string): ChatInboundMessage {
  return JSON.parse(String(message)) as ChatInboundMessage;
}
