/**
 * File purpose: define the pure chat message state boundary shared by hooks and tests.
 * Business logic: transcript updates from REST, realtime events, and optimistic sends are
 * represented as reducer actions instead of being embedded directly in React hooks.
 */
import type { ChatMessage } from '../types/types';

export type ChatMessageState = {
  messages: ChatMessage[];
};

export type ChatMessageEffect =
  | { type: 'none' }
  | { type: 'reloadSession'; sessionId: string | null };

export type ChatMessageAction =
  | { type: 'acceptedUserMessageSent'; clientRequestId?: string }
  | { type: 'userMessagesPersisted' }
  | { type: 'streamingChunkAppended'; chunk: string; newline?: boolean }
  | { type: 'streamingMessageFinalized' }
  | { type: 'assistantMessageAppended'; message: ChatMessage; persistUsers?: boolean }
  | { type: 'childToolUseAppended'; parentToolUseId: string; childTool: { toolId: string; toolName: string; toolInput: unknown; toolResult: null; timestamp: Date } }
  | { type: 'toolUseResultApplied'; toolUseId: string; parentToolUseId?: string; toolResult: { content: unknown; isError: boolean | undefined; timestamp: Date } }
  | { type: 'errorMessageAppended'; content: string }
  | { type: 'uniqueErrorMessageAppended'; content: string }
  | { type: 'pendingUserMessageRejected'; clientRequestId?: string; errorContent: string }
  | { type: 'persistedReloaded'; persistedMessages: ChatMessage[]; preservePreviousMessages: boolean; sessionId: string | null }
  | { type: 'persistedDeltaAppended'; incomingRawMessages: Record<string, unknown>[]; sessionId: string | null }
  | { type: 'liveRuntimeEventReceived'; event: Record<string, unknown> };
