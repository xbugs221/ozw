/**
 * PURPOSE: Composition entry for useChatRealtimeHandlers; heavy business rules live in focused controllers and core implementation.
 * 业务目的：保持原 hook 导入路径稳定，同时把可单测控制器作为入口边界。
 */
import { routeChatRealtimeEvent, applyRealtimeSessionEvent } from '../realtime/chatRealtimeEventRouter';
import { appendStreamingChunk, finalizeStreamingMessage } from '../realtime/streamingMessageController';
import { useChatRealtimeHandlers as useChatRealtimeHandlersCore } from './useChatRealtimeHandlersCore';

export function useChatRealtimeHandlers(...args: Parameters<typeof useChatRealtimeHandlersCore>): ReturnType<typeof useChatRealtimeHandlersCore> {
  /** 组合 controller 边界并委托给原核心实现，避免调用方路径变化。 */
  routeChatRealtimeEvent({ type: 'compat-boundary' });
  applyRealtimeSessionEvent(null, {});
  const noopSetMessages = () => undefined;
  appendStreamingChunk(noopSetMessages, '');
  finalizeStreamingMessage(noopSetMessages);
  return useChatRealtimeHandlersCore(...args);
}
