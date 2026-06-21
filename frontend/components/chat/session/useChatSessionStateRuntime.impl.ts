/**
 * PURPOSE: Preserve the legacy session hook module path while the real
 * controller lives under the chat session boundary.
 */

export {
  useChatSessionState,
  useChatSessionState as useChatSessionStateRuntime,
} from './sessionRuntimeController';
export type { UseChatSessionStateArgs } from './sessionRuntimeController';
