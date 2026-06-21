/**
 * File purpose: normalize realtime provider payloads into chat message reducer actions.
 * Business logic: WebSocket envelopes stay outside the reducer; only structured actions cross
 * into the pure transcript merge boundary.
 */
import type { ChatMessageAction } from './chatMessageStateTypes';

const NATIVE_LIVE_ITEM_TYPES = new Set([
  'agent_message',
  'reasoning',
  'thinking',
  'command_execution',
  'tool_call',
  'tool_result',
  'file_change',
  'mcp_tool_call',
  'function_call',
  'custom_tool_call',
  'function_call_output',
  'update',
  'error',
]);

/**
 * Convert Codex/Pi native runtime item payloads to reducer actions.
 */
export function normalizeNativeRuntimeMessage(message: Record<string, unknown>): ChatMessageAction | null {
  const data = message.data as Record<string, unknown> | undefined;
  if (!data || data.type !== 'item') {
    return null;
  }
  const itemType = typeof data.itemType === 'string' ? data.itemType : '';
  if (!NATIVE_LIVE_ITEM_TYPES.has(itemType)) {
    return null;
  }
  return { type: 'liveRuntimeEventReceived', event: message };
}
