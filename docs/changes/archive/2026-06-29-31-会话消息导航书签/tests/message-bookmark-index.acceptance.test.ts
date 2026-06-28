/**
 * PURPOSE: Contract-test current-session message bookmark indexing before the
 * UI is implemented, including the 50-character assistant summary rule.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

type MessageLike = {
  type: string;
  content?: string;
  timestamp: string;
  messageKey?: string;
  isThinking?: boolean;
  isToolUse?: boolean;
  isSubagentContainer?: boolean;
  toolName?: string;
};

type BookmarkLike = {
  id: string;
  userMessageKey: string;
  userPreview: string;
  assistantMessageKey: string | null;
  assistantSummary: string;
  assistantStatus: 'complete' | 'pending';
};

const REPO_ROOT = process.cwd();
const BOOKMARK_MODULE_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'chat',
  'utils',
  'conversationBookmarks.ts',
);

/**
 * Load the production bookmark module and fail with a business-level message
 * when the feature has not been implemented yet.
 */
async function loadBookmarkModule(): Promise<{
  CHAT_BOOKMARK_ASSISTANT_SUMMARY_LIMIT: number;
  buildConversationBookmarks: (messages: MessageLike[]) => BookmarkLike[];
}> {
  assert.equal(
    fs.existsSync(BOOKMARK_MODULE_PATH),
    true,
    '缺少 frontend/components/chat/utils/conversationBookmarks.ts，尚未实现当前会话书签索引构建器',
  );

  const moduleExports = await import(pathToFileURL(BOOKMARK_MODULE_PATH).href);
  assert.equal(
    typeof moduleExports.buildConversationBookmarks,
    'function',
    'conversationBookmarks.ts 必须导出 buildConversationBookmarks(messages)',
  );
  assert.equal(
    moduleExports.CHAT_BOOKMARK_ASSISTANT_SUMMARY_LIMIT,
    50,
    '助手回复摘要限制必须固定为 50 个字符',
  );

  return moduleExports as {
    CHAT_BOOKMARK_ASSISTANT_SUMMARY_LIMIT: number;
    buildConversationBookmarks: (messages: MessageLike[]) => BookmarkLike[];
  };
}

/**
 * Return the exact first N user-visible characters, matching the product rule
 * that summaries are direct excerpts rather than generated summaries.
 */
function firstCharacters(value: string, count: number): string {
  return Array.from(value).slice(0, count).join('');
}

test('书签按用户消息生成，并直接截取后续最终回复正文前 50 个字符', async () => {
  const {
    CHAT_BOOKMARK_ASSISTANT_SUMMARY_LIMIT,
    buildConversationBookmarks,
  } = await loadBookmarkModule();

  const finalAnswer =
    '这是第一轮智能体最终回复正文，长度明显超过五十个字符，用来证明摘要只是直接截取正文前面一部分信息，不应该额外生成总结或省略号。';
  const messages: MessageLike[] = [
    {
      type: 'user',
      content: '请帮我规划一个会话消息导航书签',
      timestamp: '2026-06-28T10:00:00.000Z',
      messageKey: 'user-1',
    },
    {
      type: 'assistant',
      content: '内部思考不应该进入摘要',
      timestamp: '2026-06-28T10:00:01.000Z',
      messageKey: 'thinking-1',
      isThinking: true,
    },
    {
      type: 'assistant',
      content: '工具调用参数不应该进入摘要',
      timestamp: '2026-06-28T10:00:02.000Z',
      messageKey: 'tool-1',
      isToolUse: true,
      toolName: 'read',
    },
    {
      type: 'assistant',
      content: finalAnswer,
      timestamp: '2026-06-28T10:00:03.000Z',
      messageKey: 'assistant-final-1',
    },
    {
      type: 'user',
      content: '第二轮用户消息',
      timestamp: '2026-06-28T10:01:00.000Z',
      messageKey: 'user-2',
    },
    {
      type: 'assistant',
      content: '短回复',
      timestamp: '2026-06-28T10:01:01.000Z',
      messageKey: 'assistant-final-2',
    },
  ];

  const bookmarks = buildConversationBookmarks(messages);

  assert.equal(bookmarks.length, 2, '每条用户消息都应生成一个当前会话书签');
  assert.equal(bookmarks[0].userMessageKey, 'user-1');
  assert.equal(bookmarks[0].assistantMessageKey, 'assistant-final-1');
  assert.equal(bookmarks[0].assistantStatus, 'complete');
  assert.equal(
    bookmarks[0].assistantSummary,
    firstCharacters(finalAnswer, CHAT_BOOKMARK_ASSISTANT_SUMMARY_LIMIT),
    '摘要必须直接等于最终回复正文前 50 个字符',
  );
  assert.equal(
    Array.from(bookmarks[0].assistantSummary).length,
    50,
    '超过 50 个字符的最终回复必须被截断到 50 个字符',
  );
  assert.ok(
    !bookmarks[0].assistantSummary.includes('省略号'),
    '摘要不得包含截断点之后的正文',
  );
  assert.ok(
    !bookmarks[0].assistantSummary.endsWith('...') && !bookmarks[0].assistantSummary.endsWith('…'),
    '直接截取摘要时不得额外追加省略号',
  );
  assert.equal(bookmarks[1].assistantSummary, '短回复');
});

test('进行中的用户消息也生成书签，并显示回复中状态', async () => {
  const { buildConversationBookmarks } = await loadBookmarkModule();
  const messages: MessageLike[] = [
    {
      type: 'user',
      content: '请继续补充移动端适配',
      timestamp: '2026-06-28T11:00:00.000Z',
      messageKey: 'user-pending',
    },
    {
      type: 'assistant',
      content: '仍在分析中',
      timestamp: '2026-06-28T11:00:01.000Z',
      messageKey: 'thinking-pending',
      isThinking: true,
    },
  ];

  const bookmarks = buildConversationBookmarks(messages);

  assert.equal(bookmarks.length, 1, '尚无最终回复时仍应保留用户消息书签');
  assert.equal(bookmarks[0].userMessageKey, 'user-pending');
  assert.equal(bookmarks[0].assistantMessageKey, null);
  assert.equal(bookmarks[0].assistantStatus, 'pending');
  assert.equal(bookmarks[0].assistantSummary, '回复中');
});

test('1000+ 轮长会话索引保持线性结果，不依赖全量 DOM 渲染', async () => {
  const { buildConversationBookmarks } = await loadBookmarkModule();
  const messages: MessageLike[] = [];

  for (let index = 1; index <= 1050; index += 1) {
    messages.push({
      type: 'user',
      content: `长会话第 ${index} 轮用户消息`,
      timestamp: `2026-06-28T12:${String(index % 60).padStart(2, '0')}:00.000Z`,
      messageKey: `long-user-${index}`,
    });
    messages.push({
      type: 'assistant',
      content: `长会话第 ${index} 轮智能体最终回复正文`,
      timestamp: `2026-06-28T12:${String(index % 60).padStart(2, '0')}:01.000Z`,
      messageKey: `long-assistant-${index}`,
    });
  }

  const bookmarks = buildConversationBookmarks(messages);

  assert.equal(bookmarks.length, 1050);
  assert.equal(bookmarks[0].userMessageKey, 'long-user-1');
  assert.equal(bookmarks.at(-1)?.userMessageKey, 'long-user-1050');
  assert.equal(bookmarks.at(-1)?.assistantSummary, '长会话第 1050 轮智能体最终回复正文');
});
