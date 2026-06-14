/**
 * 文件目的：将 Codex app-server notification 转换为前端 runtime event。
 * 业务意义：streaming delta、item lifecycle 和错误通知映射可独立测试，避免和 transport/session 状态耦合。
 */

import { StreamingDeltaBatcher } from '../../streaming-delta-batcher.js';
import type { CodexAppServerSession } from './session-manager.js';
import type { CodexAppServerNotification } from './stdio-transport.js';

/**
 * 将 app-server ThreadItem 归一化为前端已有的 item 事件结构。
 */
export function transformAppServerItem(item: Record<string, unknown>, lifecycle?: 'started' | 'updated' | 'completed'): Record<string, unknown> {
  const itemType = String(item.type || '');
  const callId = item.call_id ?? item.callId ?? item.id ?? item.itemId ?? null;
  const itemStatus = typeof item.status === 'string'
    ? item.status
    : (lifecycle === 'completed' ? 'completed' : undefined);
  switch (itemType) {
    case 'update': {
      const nested = item.item || item.payload || item.data || item.update;
      if (nested && typeof nested === 'object') {
        return transformAppServerItem(nested as Record<string, unknown>);
      }
      return { type: 'item', itemType: 'update', item };
    }
    case 'agent_message':
    case 'agentMessage':
      return {
        type: 'item',
        itemType: 'agent_message',
        itemId: item.id || item.message_id || null,
        ...(itemStatus ? { status: itemStatus } : {}),
        message: { role: 'assistant', content: item.text, phase: typeof item.phase === 'string' ? item.phase : undefined },
      };
    case 'reasoning':
      return { type: 'item', itemType: 'reasoning', itemId: item.id || item.message_id || null, ...(itemStatus ? { status: itemStatus } : {}), message: { role: 'assistant', content: item.text, isReasoning: true } };
    case 'command_execution':
    case 'commandExecution':
      return { type: 'item', itemType: 'command_execution', itemId: item.id || item.call_id || null, command: item.command || item.command_line || '[command unavailable]', output: item.aggregatedOutput ?? item.aggregated_output ?? item.output ?? '', exitCode: item.exitCode ?? item.exit_code, lifecycle: 'item.updated', status: item.status };
    case 'file_change':
    case 'fileChange':
      return { type: 'item', itemType: 'file_change', itemId: item.id || item.call_id || null, changes: item.changes, status: item.status };
    case 'mcp_tool_call':
    case 'mcpToolCall':
      return { type: 'item', itemType: 'mcp_tool_call', itemId: item.id || item.call_id || null, server: item.server, tool: item.tool, arguments: item.arguments, result: item.result, error: item.error, status: item.status };
    case 'function_call':
    case 'functionCall':
      return {
        type: 'item',
        itemType: 'function_call',
        itemId: callId,
        item: {
          ...item,
          type: 'function_call',
          call_id: callId,
          name: item.name || item.toolName || item.tool,
          arguments: item.arguments ?? item.args ?? item.input ?? '',
        },
      };
    case 'function_call_output':
    case 'functionCallOutput':
      return {
        type: 'item',
        itemType: 'function_call_output',
        itemId: callId,
        item: {
          ...item,
          type: 'function_call_output',
          call_id: callId,
          output: item.output ?? item.content ?? item.result ?? '',
          error: item.error,
        },
      };
    case 'web_search':
    case 'webSearch':
      return { type: 'item', itemType: 'web_search', query: item.query };
    case 'todo_list':
    case 'todoList':
      return { type: 'item', itemType: 'todo_list', items: item.items };
    case 'error':
      return { type: 'item', itemType: 'error', message: { role: 'error', content: item.message } };
    default:
      return { type: 'item', itemType, item };
  }
}

/**
 * 处理单条 app-server notification 并更新目标 session 状态。
 */
export function handleAppServerNotification(
  session: CodexAppServerSession,
  notification: CodexAppServerNotification,
  expectedThreadId?: string | null,
): void {
  const { method, params } = notification;
  const p = (params || {}) as Record<string, unknown>;
  const threadId = getNotificationThreadId(p);
  const expected = expectedThreadId ?? session.providerThreadId;
  if (threadId !== undefined && expected !== undefined && String(threadId) !== expected) {
    return;
  }

  switch (method) {
    case 'thread/started': {
      const thread = p.thread as Record<string, unknown> | undefined;
      if (thread?.id && !session.providerThreadId) {
        session.providerThreadId = String(thread.id);
        session.writer?.send({ type: 'session-created', sessionId: session.providerThreadId, provider: 'codex' });
        if (typeof session.writer?.setSessionId === 'function') {
          session.writer.setSessionId(session.providerThreadId);
        }
      }
      break;
    }
    case 'turn/started': {
      const turn = p.turn as Record<string, unknown> | undefined;
      if (turn?.id) {
        session.activeTurnId = String(turn.id);
        session.turnStartedAt = new Date().toISOString();
        session.status = 'running';
      }
      session.writer?.send({
        type: 'session-status',
        sessionId: session.providerThreadId || session.ozwSessionId,
        provider: 'codex',
        isProcessing: true,
        turnId: session.activeTurnId || undefined,
        turnStartedAt: session.turnStartedAt || undefined,
      });
      break;
    }
    case 'turn/completed': {
      getCodexStreamingDeltaBatcher(session).flushSession(session.providerThreadId || session.ozwSessionId);
      session.status = 'completed';
      session.activeTurnId = null;
      session.turnStartedAt = null;
      session.writer?.send({ type: 'session-status', sessionId: session.providerThreadId || session.ozwSessionId, provider: 'codex', isProcessing: false });
      session.writer?.send({ type: 'codex-complete', sessionId: session.providerThreadId || session.ozwSessionId, actualSessionId: session.providerThreadId || session.ozwSessionId });
      break;
    }
    case 'item/started':
    case 'item/updated':
    case 'item/completed': {
      const item = (p.item || p.update) as Record<string, unknown> | undefined;
      if (!item) break;
      const lifecycle = method === 'item/completed' ? 'completed' : (method === 'item/updated' ? 'updated' : 'started');
      const transformed = transformAppServerItem(item, lifecycle);
      const transformedItemType = String(transformed.itemType || '');
      const sessionId = session.providerThreadId || session.ozwSessionId;
      if (lifecycle !== 'completed' && (transformedItemType === 'agent_message' || transformedItemType === 'reasoning')) {
        const message = transformed.message && typeof transformed.message === 'object'
          ? transformed.message as Record<string, unknown>
          : null;
        getCodexStreamingDeltaBatcher(session).enqueue({
          envelopeType: 'codex-response',
          sessionId,
          itemType: transformedItemType as 'agent_message' | 'reasoning',
          itemId: transformed.itemId ?? null,
          text: typeof message?.content === 'string' ? message.content : '',
          mode: 'replace',
        });
        break;
      }
      if (lifecycle === 'completed') {
        getCodexStreamingDeltaBatcher(session).flushSession(sessionId);
      }
      session.writer?.send({ type: 'codex-response', data: transformed, sessionId });
      break;
    }
    case 'item/agentMessage/delta': {
      const itemId = p.itemId as string | undefined;
      if (itemId !== undefined) {
        getCodexStreamingDeltaBatcher(session).enqueue({
          envelopeType: 'codex-response',
          sessionId: session.providerThreadId || session.ozwSessionId,
          itemType: 'agent_message',
          itemId,
          text: (p.delta as string | undefined) || '',
        });
      }
      break;
    }
    case 'item/commandExecution/outputDelta': {
      sendOutputDelta(session, 'command_execution', p);
      break;
    }
    case 'item/fileChange/outputDelta': {
      const itemId = p.itemId as string | undefined;
      if (itemId !== undefined) {
        session.writer?.send({
          type: 'codex-response',
          data: {
            type: 'item',
            itemType: 'file_change',
            itemId,
            changes: p.delta ? [{ kind: 'update', path: '', diff: p.delta }] : [],
            lifecycle: 'item.updated',
          },
          sessionId: session.providerThreadId || session.ozwSessionId,
        });
      }
      break;
    }
    case 'error': {
      getCodexStreamingDeltaBatcher(session).flushSession(session.providerThreadId || session.ozwSessionId);
      session.writer?.send({ type: 'codex-error', error: String(p.message || 'Codex app-server error'), sessionId: session.providerThreadId || session.ozwSessionId });
      session.status = 'failed';
      session.activeTurnId = null;
      session.turnStartedAt = null;
      break;
    }
    default:
      break;
  }
}

/**
 * 从通知参数中提取 thread 归属 id。
 */
function getNotificationThreadId(params: Record<string, unknown>): string | undefined {
  return (params.threadId || (params.thread as Record<string, unknown> | undefined)?.id) as
    | string
    | undefined;
}

/**
 * 获取 session 级 streaming batcher，保证 delta 和 completed flush 使用同一条路径。
 */
function getCodexStreamingDeltaBatcher(session: CodexAppServerSession): StreamingDeltaBatcher {
  if (!session.streamingDeltaBatcher) {
    session.streamingDeltaBatcher = new StreamingDeltaBatcher((event) => {
      session.writer?.send(event);
    });
  }
  return session.streamingDeltaBatcher;
}

/**
 * 发送命令输出类增量事件。
 */
function sendOutputDelta(session: CodexAppServerSession, itemType: string, p: Record<string, unknown>): void {
  const itemId = p.itemId as string | undefined;
  if (itemId === undefined) return;
  session.writer?.send({
    type: 'codex-response',
    data: {
      type: 'item',
      itemType,
      itemId,
      output: (p.delta as string | undefined) || '',
      lifecycle: 'item.updated',
    },
    sessionId: session.providerThreadId || session.ozwSessionId,
  });
}
