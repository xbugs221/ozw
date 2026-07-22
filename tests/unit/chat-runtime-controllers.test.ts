/**
 * 文件目的：验证聊天 runtime controllers 的 session、composer、realtime 和 stream 业务规则。
 * 业务风险：这些规则错误会造成用户消息重复发送、streaming 丢 chunk 或 realtime 错路由。
 */
import { expect, it } from 'vitest';
import { buildSessionLoadPlan, applySessionLoadResult, buildVisibleMessageWindow } from '../../frontend/components/chat/session/chatSessionLifecycleController.ts';
import { canContinueSessionHistory, loadSessionMessagesInPages } from '../../frontend/components/chat/session/sessionBulkMessageLoader.ts';
import { buildSubmitRequest, resolveSubmitDisabledReason, createPendingUserMessage } from '../../frontend/components/chat/composer/composerSubmitRuntime.ts';
import { routeChatRealtimeEvent, applyRealtimeSessionEvent } from '../../frontend/components/chat/realtime/chatRealtimeEventRouter.ts';
import { appendStreamingChunk, finalizeStreamingMessage } from '../../frontend/components/chat/realtime/streamingMessageController.ts';

it('chatSessionLifecycleController plans pagination and visible windows', () => {
  /** 顶部加载历史消息时应使用当前 offset，普通加载从 0 开始。 */
  expect(buildSessionLoadPlan({ loadMore: true, offset: 20, pageSize: 10 })).toEqual({ loadMore: true, offset: 20, limit: 10, hasKnownTotal: false });
  expect(applySessionLoadResult(['old'], { messages: ['new'], total: 2, nextRawLineOffset: 2 }, true).messages).toEqual(['old', 'new']);
  expect(buildVisibleMessageWindow(['a', 'b', 'c'], 2)).toEqual(['b', 'c']);
  expect(buildVisibleMessageWindow(['a', 'b', 'c', 'd', 'e'], 3, 'message-position-3')).toEqual(['c', 'd', 'e']);
  expect(buildVisibleMessageWindow([
    { type: 'assistant', content: 'old 1', timestamp: '2026-06-27T00:00:00.000Z', messageKey: 'm1' },
    { type: 'assistant', content: 'old 2', timestamp: '2026-06-27T00:00:01.000Z', messageKey: 'm2' },
    { type: 'assistant', content: 'old 3', timestamp: '2026-06-27T00:00:02.000Z', messageKey: 'm3' },
    { type: 'assistant', content: 'new 4', timestamp: '2026-06-27T00:00:03.000Z', messageKey: 'm4' },
    { type: 'assistant', content: 'new 5', timestamp: '2026-06-27T00:00:04.000Z', messageKey: 'm5' },
  ], 2, 'message-assistant-m3').map((message) => message.content)).toEqual(['old 2', 'old 3']);
});

it('sessionBulkMessageLoader follows backend raw-line offsets', async () => {
  /** Codex JSONL raw lines can produce fewer rendered messages than consumed raw rows. */
  const offsets: number[] = [];
  const projectPaths: string[] = [];
  const result = await loadSessionMessagesInPages({
    sessionMessages: async (_projectName, _sessionId, _limit, offset, _provider, _afterLine, _afterCursor, projectPath) => {
      offsets.push(offset);
      projectPaths.push(projectPath || '');
      const page = offset === 0
        ? { messages: ['newer-line-835', 'newer-line-932'], total: 6, hasMore: true, nextRawLineOffset: 3 }
        : { messages: ['older-line-735', 'older-line-829'], total: 6, hasMore: false, nextRawLineOffset: 6 };
      return new Response(JSON.stringify(page), { status: 200 });
    },
    projectName: 'fixture-project',
    sessionId: 'c12',
    provider: 'codex',
    projectPath: '/tmp/fixture-project',
    pageSize: 3,
  });

  expect(offsets).toEqual([0, 3]);
  expect(projectPaths).toEqual(['/tmp/fixture-project', '/tmp/fixture-project']);
  expect(result.messages).toEqual(['older-line-735', 'older-line-829', 'newer-line-835', 'newer-line-932']);
});

it('sessionBulkMessageLoader crosses an empty display page when the raw cursor advances', async () => {
  /** A fully filtered JSONL window must not hide visible messages on an older page. */
  const offsets: number[] = [];
  const result = await loadSessionMessagesInPages({
    sessionMessages: async (_projectName, _sessionId, _limit, offset) => {
      offsets.push(offset);
      const page = offset === 0
        ? { messages: ['newest-visible'], total: 103, hasMore: true, nextRawLineOffset: 50 }
        : offset === 50
          ? { messages: [], total: 103, hasMore: true, nextRawLineOffset: 100 }
          : { messages: ['oldest-visible'], total: 103, hasMore: false, nextRawLineOffset: 103 };
      return new Response(JSON.stringify(page), { status: 200 });
    },
    projectName: 'history-scroll',
    sessionId: 'fixture-filtered-window-session',
    provider: 'codex',
    pageSize: 50,
  });

  expect(offsets).toEqual([0, 50, 100]);
  expect(result.messages).toEqual(['oldest-visible', 'newest-visible']);
});

it('Hermes pagination stops when rewind exhausts the server cursor despite a stale snapshot total', async () => {
  const cursors: Array<string | null | undefined> = [];
  const result = await loadSessionMessagesInPages({
    sessionMessages: async (_projectName, _sessionId, _limit, _offset, _provider, _afterLine, afterCursor) => {
      cursors.push(afterCursor);
      const page = afterCursor
        ? { messages: [], total: 120, hasMore: false, nextMessageOffset: 50, nextCursor: null }
        : { messages: ['newest-page'], total: 120, hasMore: true, nextMessageOffset: 50, nextCursor: 'opaque-page-2' };
      return new Response(JSON.stringify(page), { status: 200 });
    },
    projectName: 'history-scroll',
    sessionId: 'default~rewind',
    provider: 'hermes',
    pageSize: 50,
  });

  expect(cursors).toEqual([null, 'opaque-page-2']);
  expect(result.messages).toEqual(['newest-page']);
  expect(canContinueSessionHistory({ provider: 'hermes', hasMore: false, nextCursor: null })).toBe(false);
  expect(canContinueSessionHistory({ provider: 'hermes', hasMore: true, nextCursor: null })).toBe(false);
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
