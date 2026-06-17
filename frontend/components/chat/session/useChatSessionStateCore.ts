/**
 * PURPOSE: Keep chat session hook compatibility as a thin boundary.
 * 业务目的：会话加载和可见窗口规则由 controller/runtime 承担，本文件只保留旧内部入口。
 */
export { useChatSessionState } from './useChatSessionStateRuntime';
