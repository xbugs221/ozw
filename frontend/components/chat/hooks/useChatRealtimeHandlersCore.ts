/**
 * PURPOSE: Keep chat realtime hook compatibility as a thin boundary.
 * 业务目的：实时事件路由和 streaming 合并规则由 controller/runtime 承担，本文件只保留旧内部入口。
 */
export { useChatRealtimeHandlers } from './useChatRealtimeHandlersRuntime';
