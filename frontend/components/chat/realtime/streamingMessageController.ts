/**
 * PURPOSE: Own streaming message merge rules for realtime chat events.
 * 业务目的：把 token chunk 追加和完成态转换从长 hook 中拆出，避免 session 切换时丢消息。
 */
import type { Dispatch, SetStateAction } from 'react';
import { chatMessageReducer } from '../state/chatMessageReducer';
import type { ChatMessage } from '../types/types';

export function appendStreamingChunk(
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  chunk: string,
  newline = false,
): void {
  /** 合并一个 realtime streaming chunk，并保持 reducer 作为唯一状态入口。 */
  if (!chunk) return;
  setChatMessages((previous) => chatMessageReducer({ messages: previous }, { type: 'streamingChunkAppended', chunk, newline }).messages);
}

export function finalizeStreamingMessage(setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>): void {
  /** 将当前 streaming assistant 消息固化成普通消息。 */
  setChatMessages((previous) => chatMessageReducer({ messages: previous }, { type: 'streamingMessageFinalized' }).messages);
}
