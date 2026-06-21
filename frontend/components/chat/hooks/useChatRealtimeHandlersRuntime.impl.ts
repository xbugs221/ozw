/**
 * PURPOSE: Preserve the legacy realtime hook module path while the real
 * controller lives under the chat realtime boundary.
 */

export {
  useChatRealtimeHandlers,
  useChatRealtimeHandlers as useChatRealtimeHandlersRuntime,
} from '../realtime/realtimeRuntimeController';
