/**
 * File purpose: pure reducer for chat transcript message updates.
 * Business logic: keeps REST refresh, JSONL delta, native live item, and optimistic send merge
 * rules in one Node-testable module.
 */
import type { ChatMessage } from '../types/types';
import { mergePersistedAndOptimisticMessages, mergeSessionMessageDelta } from '../utils/sessionMessageMerge';
import { reduceNativeRuntimeEvent } from '../utils/nativeRuntimeTranscript';
import { appendUniqueErrorMessage } from '../utils/errorDedup';
import type { ChatMessageAction, ChatMessageState } from './chatMessageStateTypes';

/**
 * Mark optimistic user sends as persisted once provider history confirms them.
 */
export function markUserMessagesPersisted(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) =>
    message.type === 'user' && (message.deliveryStatus === 'pending' || message.deliveryStatus === 'sent')
      ? { ...message, deliveryStatus: 'persisted' as const }
      : message,
  );
}

/**
 * Mark pending user sends as delivered after assistant output starts.
 */
export function markPendingUserMessagesDelivered(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) =>
    message.type === 'user' && message.deliveryStatus === 'pending' && !message.clientRequestId
      ? { ...message, deliveryStatus: 'sent' as const }
      : message,
  );
}

/**
 * Mark the accepted user send as sent, falling back to the newest pending user row.
 */
export function markAcceptedUserMessageSent(messages: ChatMessage[], clientRequestId?: string): ChatMessage[] {
  const exactIndex = clientRequestId
    ? messages.findIndex((message) =>
      message.type === 'user'
      && message.deliveryStatus === 'pending'
      && message.clientRequestId === clientRequestId)
    : -1;
  const acceptedIndex = exactIndex >= 0
    ? exactIndex
    : (() => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.type === 'user' && message.deliveryStatus === 'pending') return index;
      }
      return -1;
    })();
  if (acceptedIndex < 0) return messages;
  return messages.map((message, index) =>
    index === acceptedIndex ? { ...message, deliveryStatus: 'sent' as const } : message);
}

/**
 * Append a buffered streaming assistant chunk.
 */
export function appendStreamingChunkToMessages(messages: ChatMessage[], chunk: string, newline = false): ChatMessage[] {
  if (!chunk) return messages;
  const updated = markUserMessagesPersisted([...messages]);
  const lastIndex = updated.length - 1;
  const last = updated[lastIndex];
  if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
    const nextContent = newline ? (last.content ? `${last.content}\n${chunk}` : chunk) : `${last.content || ''}${chunk}`;
    updated[lastIndex] = { ...last, content: nextContent };
  } else {
    updated.push({
      type: 'assistant',
      content: chunk,
      timestamp: new Date(),
      isStreaming: true,
      source: 'claude-realtime',
      messageKey: `streaming-${Date.now()}`,
    });
  }
  return markPendingUserMessagesDelivered(updated);
}

/**
 * Finalize the current streaming assistant message.
 */
export function finalizeStreamingMessageInMessages(messages: ChatMessage[]): ChatMessage[] {
  const updated = [...messages];
  const lastIndex = updated.length - 1;
  const last = updated[lastIndex];
  if (last && last.type === 'assistant' && last.isStreaming) {
    updated[lastIndex] = { ...last, isStreaming: false };
  }
  return markPendingUserMessagesDelivered(updated);
}

/**
 * Append a rendered assistant or tool message, optionally persisting optimistic user rows first.
 */
export function appendAssistantMessage(messages: ChatMessage[], message: ChatMessage, persistUsers = false): ChatMessage[] {
  const baseMessages = persistUsers ? markUserMessagesPersisted(messages) : messages;
  return [...baseMessages, message];
}

/**
 * Attach a child tool call to its parent subagent container.
 */
export function appendChildToolUse(
  messages: ChatMessage[],
  parentToolUseId: string,
  childTool: { toolId: string; toolName: string; toolInput: unknown; toolResult: null; timestamp: Date },
): ChatMessage[] {
  return messages.map((message) => {
    if (message.toolId !== parentToolUseId || !message.isSubagentContainer) return message;
    const existingChildren = message.subagentState?.childTools || [];
    return {
      ...message,
      subagentState: {
        childTools: [...existingChildren, childTool],
        currentToolIndex: existingChildren.length,
        isComplete: false,
      },
    };
  });
}

/**
 * Apply a tool result to either a normal tool row or a child tool inside a subagent container.
 */
export function applyToolUseResult(
  messages: ChatMessage[],
  toolUseId: string,
  toolResult: { content: unknown; isError: boolean | undefined; timestamp: Date },
  parentToolUseId?: string,
): ChatMessage[] {
  return messages.map((message) => {
    if (parentToolUseId && message.toolId === parentToolUseId && message.isSubagentContainer && message.subagentState) {
      return {
        ...message,
        subagentState: {
          ...message.subagentState,
          childTools: message.subagentState.childTools.map((child) =>
            child.toolId === toolUseId ? { ...child, toolResult } : child),
        },
      };
    }

    if (!message.isToolUse || message.toolId !== toolUseId) return message;
    const result = { ...message, toolResult };
    if (message.isSubagentContainer && message.subagentState) {
      result.subagentState = {
        ...message.subagentState,
        isComplete: true,
      };
    }
    return result;
  });
}

/**
 * Mark a rejected optimistic user row as failed and append the visible error.
 */
export function rejectPendingUserMessage(
  messages: ChatMessage[],
  errorContent: string,
  clientRequestId?: string,
): ChatMessage[] {
  const withFailed = messages.map((message) =>
    message.type === 'user' && message.deliveryStatus === 'pending'
      && (!clientRequestId || message.clientRequestId === clientRequestId)
      ? { ...message, deliveryStatus: 'failed' as const }
      : message);
  return appendAssistantMessage(withFailed, {
    type: 'error',
    content: errorContent,
    timestamp: new Date(),
  });
}

/**
 * Reduce one structured chat message action.
 */
export function chatMessageReducer(state: ChatMessageState, action: ChatMessageAction): ChatMessageState {
  switch (action.type) {
  case 'acceptedUserMessageSent':
    return { ...state, messages: markAcceptedUserMessageSent(state.messages, action.clientRequestId) };
  case 'userMessagesPersisted':
    return { ...state, messages: markUserMessagesPersisted(state.messages) };
  case 'streamingChunkAppended':
    return { ...state, messages: appendStreamingChunkToMessages(state.messages, action.chunk, action.newline) };
  case 'streamingMessageFinalized':
    return { ...state, messages: finalizeStreamingMessageInMessages(state.messages) };
  case 'assistantMessageAppended':
    return { ...state, messages: appendAssistantMessage(state.messages, action.message, action.persistUsers) };
  case 'childToolUseAppended':
    return { ...state, messages: appendChildToolUse(state.messages, action.parentToolUseId, action.childTool) };
  case 'toolUseResultApplied':
    return { ...state, messages: applyToolUseResult(state.messages, action.toolUseId, action.toolResult, action.parentToolUseId) };
  case 'errorMessageAppended':
    return {
      ...state,
      messages: appendAssistantMessage(state.messages, { type: 'error', content: action.content, timestamp: new Date() }),
    };
  case 'uniqueErrorMessageAppended':
    return { ...state, messages: appendUniqueErrorMessage(state.messages, action.content) };
  case 'pendingUserMessageRejected':
    return { ...state, messages: rejectPendingUserMessage(state.messages, action.errorContent, action.clientRequestId) };
  case 'persistedReloaded':
    return {
      ...state,
      messages: mergePersistedAndOptimisticMessages(action.persistedMessages, state.messages, {
        preservePreviousMessages: action.preservePreviousMessages,
        sessionId: action.sessionId,
      }),
    };
  case 'persistedDeltaAppended':
    return {
      ...state,
      messages: mergeSessionMessageDelta({
        existingMessages: state.messages,
        incomingRawMessages: action.incomingRawMessages,
        sessionId: action.sessionId,
      }),
    };
  case 'liveRuntimeEventReceived':
    return {
      ...state,
      messages: reduceNativeRuntimeEvent(state.messages, action.event) as ChatMessage[],
    };
  default:
    return state;
  }
}
