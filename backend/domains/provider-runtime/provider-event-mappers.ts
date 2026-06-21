/**
 * 文件目的：承载 provider runtime 事件转换边界。
 * 业务意义：Pi SDK 与 Codex runtime 的原生事件在这里转换成浏览器可消费的 RuntimeEvent 数据。
 */
import type { RuntimeEvent } from './provider-runtime-events.js';

/**
 * 读取 Pi 工具调用输入，兼容 SDK 版本间的字段别名。
 */
function readPiToolInput(event: Record<string, unknown>): unknown {
  /** 统一传给前端 reducer，避免 start/update 缺 input 导致裸卡片。 */
  return event.arguments ?? event.args ?? event.input;
}

/**
 * 读取 Pi 工具调用输出，兼容中间更新与结束事件。
 */
function readPiToolOutput(event: Record<string, unknown>): unknown {
  /** update 事件可能用 partialResult，end 事件可能用 output/result。 */
  return event.partialResult ?? event.output ?? event.result;
}

/**
 * 将 Pi SDK AgentSessionEvent 映射为 ozw runtime item/turn/error 事件。
 */
export function transformPiEvent(event: Record<string, unknown>): unknown {
    switch (event.type) {
      // Streaming assistant text delta
      case 'message_update': {
        const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
        if (ame?.type === 'text_delta') {
          return { type: 'item', itemType: 'agent_message', itemId: event.messageId || null, status: 'in_progress', delta: { text: ame.delta || '' }, message: { role: 'assistant' } };
        }
        if (ame?.type === 'thinking_delta') {
          return { type: 'item', itemType: 'reasoning', itemId: event.messageId || null, status: 'in_progress', delta: { text: ame.delta || '' }, message: { role: 'assistant', isReasoning: true } };
        }
        return event;
      }
      // Tool execution lifecycle
      case 'tool_execution_start':
        return {
          type: 'item',
          itemType: 'tool_call',
          itemId: event.toolCallId || null,
          toolCallId: event.toolCallId || null,
          tool: event.toolName,
          arguments: readPiToolInput(event),
          status: 'running'
        };
      case 'tool_execution_update':
        return {
          type: 'item',
          itemType: 'tool_call',
          itemId: event.toolCallId || null,
          toolCallId: event.toolCallId || null,
          tool: event.toolName,
          arguments: readPiToolInput(event),
          output: readPiToolOutput(event),
          status: 'running'
        };
      case 'tool_execution_end':
        return {
          type: 'item',
          itemType: 'tool_result',
          itemId: event.toolCallId || null,
          toolCallId: event.toolCallId || null,
          tool: event.toolName,
          result: readPiToolOutput(event),
          isError: event.isError,
          status: 'completed'
        };
      // Turn lifecycle
      case 'turn_start':
        return { type: 'turn_started', timestamp: typeof event.timestamp === 'number' ? event.timestamp : undefined };
      case 'turn_end': {
        const turnPayload: Record<string, unknown> = { type: 'turn_complete' };
        if (event.toolResults) turnPayload.toolResults = event.toolResults;
        return turnPayload;
      }
      // Message lifecycle (for completion tracking)
      case 'message_start':
      case 'message_end':
        return event;
      case 'error':
        return { type: 'error', message: event.message || 'Pi error' };
      default:
        return event;
    }
}

/**
 * 保留 Codex mapper 边界，Codex app-server 已输出 RuntimeEvent 兼容包络。
 */
export function transformCodex(event: RuntimeEvent | Record<string, unknown>): RuntimeEvent | Record<string, unknown> {
  return event;
}
