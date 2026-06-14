/**
 * File purpose: public entry for realtime chat event handling.
 * Business logic: keep the subscribed hook API stable while the implementation delegates
 * transcript mutations to the pure chat message reducer boundary.
 */
export { useChatRealtimeHandlers } from './useChatRealtimeHandlersImpl';
