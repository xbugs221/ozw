/**
 * PURPOSE: Keep chat composer hook compatibility as a thin boundary.
 * 业务目的：提交禁用、请求构建和 pending message 规则由 controller/runtime 承担，本文件只保留旧内部入口。
 */
export { useChatComposerState } from './useChatComposerStateRuntime';
