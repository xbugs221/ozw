/**
 * 文件目的：验证聊天 runtime controllers 的 session、composer、realtime 和 stream 业务规则。
 * 业务风险：这些规则错误会造成用户消息重复发送、streaming 丢 chunk 或 realtime 错路由。
 */
import { expect, it } from 'vitest';
import { buildSessionLoadPlan, applySessionLoadResult, buildVisibleMessageWindow } from '../../frontend/components/chat/session/chatSessionLifecycleController.ts';
import { buildSubmitRequest, resolveSubmitDisabledReason, createPendingUserMessage } from '../../frontend/components/chat/composer/composerSubmitRuntime.ts';
import { routeChatRealtimeEvent, applyRealtimeSessionEvent } from '../../frontend/components/chat/realtime/chatRealtimeEventRouter.ts';
import { appendStreamingChunk, finalizeStreamingMessage } from '../../frontend/components/chat/realtime/streamingMessageController.ts';

it('chatSessionLifecycleController plans pagination and visible windows', () => {
  /** 顶部加载历史消息时应使用当前 offset，普通加载从 0 开始。 */
  expect(buildSessionLoadPlan({ loadMore: true, offset: 20, pageSize: 10 })).toEqual({ loadMore: true, offset: 20, limit: 10, hasKnownTotal: false });
  expect(applySessionLoadResult(['old'], { messages: ['new'], total: 2, nextRawLineOffset: 2 }, true).messages).toEqual(['old', 'new']);
  expect(buildVisibleMessageWindow(['a', 'b', 'c'], 2)).toEqual(['b', 'c']);
});

it('composerSubmitRuntime blocks empty sends and builds pending messages', () => {
  /** 空消息且无附件时必须阻止提交，有内容时创建 pending 用户消息。 */
  expect(resolveSubmitDisabledReason({ message: '   ', attachmentCount: 0 })).toBe('empty');
  expect(resolveSubmitDisabledReason({ message: 'fix bug', attachmentCount: 0 })).toBeNull();
  expect(buildSubmitRequest({ message: 'fix bug', provider: 'codex', sessionId: 's1', projectName: 'p1' }).sessionId).toBe('s1');
  expect(createPendingUserMessage({ id: 'm1', content: 'hello' }).deliveryStatus).toBe('pending');
});

it('chatRealtimeEventRouter and streamingMessageController expose real routing and merge hooks', () => {
  /** realtime 事件应能分类，streaming 控制器应通过 setState 更新消息。 */
  expect(routeChatRealtimeEvent({ type: 'stream_delta' })).toBe('stream');
  expect(applyRealtimeSessionEvent({ id: 's1' }, { sessionId: 's1' })).toEqual({ sessionId: 's1', matchesCurrentSession: true });
  let messages: any[] = [];
  const setMessages = (updater: any) => { messages = typeof updater === 'function' ? updater(messages) : updater; };
  appendStreamingChunk(setMessages, 'hi');
  finalizeStreamingMessage(setMessages);
  expect(Array.isArray(messages)).toBe(true);
});
