/**
 * PURPOSE: Keep chat command dispatcher compatibility as a thin boundary.
 * 业务目的：realtime command 运行时迁到 chat-command-runtime，本文件只保留旧内部入口。
 */
export {
  createChatCommandDispatcher,
  registerChatClient,
  unregisterChatClient,
} from './chat-command-runtime.js';
