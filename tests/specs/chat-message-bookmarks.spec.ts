/**
 * 文件目的：规格级保护当前会话消息导航书签的索引、响应式入口和分页定位边界。
 * Sources: 2026-06-29-31-会话消息导航书签
 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
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
const BOOKMARK_MODULE_PATH = 'frontend/components/chat/utils/conversationBookmarks.ts';
const BOOKMARK_COMPONENT_PATH = 'frontend/components/chat/view/subcomponents/ConversationBookmarks.tsx';
const CHAT_INTERFACE_PATH = 'frontend/components/chat/view/ChatInterface.tsx';
const SESSION_RUNTIME_PATH = 'frontend/components/chat/session/sessionRuntimeController.ts';

/**
 * 读取仓库源码文件，缺失时输出可读的业务能力名称。
 */
async function readRequiredSource(relativePath: string, businessName: string): Promise<string> {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  try {
    return await readFile(absolutePath, 'utf8');
  } catch {
    assert.fail(`缺少 ${businessName}: ${relativePath}`);
  }
}

/**
 * 检查仓库路径是否存在。
 */
async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await stat(path.join(REPO_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * 加载生产书签索引模块，确保导出面向业务合同稳定。
 */
async function loadBookmarkModule(): Promise<{
  CHAT_BOOKMARK_ASSISTANT_SUMMARY_LIMIT: number;
  buildConversationBookmarks: (messages: MessageLike[]) => BookmarkLike[];
}> {
  assert.equal(
    await pathExists(BOOKMARK_MODULE_PATH),
    true,
    '缺少当前会话书签索引构建器 frontend/components/chat/utils/conversationBookmarks.ts',
  );

  const moduleExports = await import(pathToFileURL(path.join(REPO_ROOT, BOOKMARK_MODULE_PATH)).href);
  assert.equal(typeof moduleExports.buildConversationBookmarks, 'function');
  assert.equal(moduleExports.CHAT_BOOKMARK_ASSISTANT_SUMMARY_LIMIT, 50);

  return moduleExports as {
    CHAT_BOOKMARK_ASSISTANT_SUMMARY_LIMIT: number;
    buildConversationBookmarks: (messages: MessageLike[]) => BookmarkLike[];
  };
}

/**
 * 按用户可见字符截取摘要，避免 UTF-16 截断破坏多字节字符。
 */
function firstCharacters(value: string, count: number): string {
  return Array.from(value).slice(0, count).join('');
}

test('current-session bookmarks are created from user messages with final assistant excerpts', async () => {
  /** 书签摘要必须是后续最终助手回复正文前 50 个字符，不使用思考或工具消息。 */
  const { CHAT_BOOKMARK_ASSISTANT_SUMMARY_LIMIT, buildConversationBookmarks } = await loadBookmarkModule();
  const finalAnswer =
    '这是第一轮智能体最终回复正文，长度明显超过五十个字符，用来证明摘要只是直接截取正文前面一部分信息，不应该额外生成总结或省略号。';

  const bookmarks = buildConversationBookmarks([
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
  ]);

  assert.equal(bookmarks.length, 1);
  assert.equal(bookmarks[0].userMessageKey, 'user-1');
  assert.equal(bookmarks[0].assistantMessageKey, 'assistant-final-1');
  assert.equal(bookmarks[0].assistantStatus, 'complete');
  assert.equal(bookmarks[0].assistantSummary, firstCharacters(finalAnswer, CHAT_BOOKMARK_ASSISTANT_SUMMARY_LIMIT));
  assert.equal(Array.from(bookmarks[0].assistantSummary).length, 50);
  assert.equal(bookmarks[0].assistantSummary.endsWith('...') || bookmarks[0].assistantSummary.endsWith('…'), false);
});

test('pending user messages keep bookmark navigation state', async () => {
  /** 无最终回复时用户消息仍应出现在书签列表，便于流式进行中会话定位。 */
  const { buildConversationBookmarks } = await loadBookmarkModule();
  const bookmarks = buildConversationBookmarks([
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
  ]);

  assert.equal(bookmarks.length, 1);
  assert.equal(bookmarks[0].userMessageKey, 'user-pending');
  assert.equal(bookmarks[0].assistantMessageKey, null);
  assert.equal(bookmarks[0].assistantStatus, 'pending');
  assert.equal(bookmarks[0].assistantSummary, '回复中');
});

test('bookmark indexing scales to long sessions without requiring rendered DOM', async () => {
  /** 1000+ 轮会话的索引结果应与用户消息数量线性一致。 */
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
});

test('bookmark UI keeps responsive entry points and paginated messageKey navigation', async () => {
  /** 书签 UI 必须接入当前定位链路，不能以全量加载替代逐页查找。 */
  const componentSource = await readRequiredSource(BOOKMARK_COMPONENT_PATH, '当前会话消息书签组件');
  const chatInterfaceSource = await readRequiredSource(CHAT_INTERFACE_PATH, '聊天界面接入点');
  const sessionRuntimeSource = await readRequiredSource(SESSION_RUNTIME_PATH, '会话分页定位控制器');

  assert.match(componentSource, /data-testid=["']chat-message-bookmarks["']/);
  assert.match(componentSource, /data-testid=["']chat-bookmark-desktop-trigger["']/);
  assert.match(componentSource, /data-testid=["']chat-bookmark-desktop-list["']/);
  assert.match(componentSource, /data-testid=["']chat-bookmark-mobile-trigger["']/);
  assert.match(componentSource, /data-testid=["']chat-bookmark-mobile-panel["']/);
  assert.match(componentSource, /data-testid=["']chat-message-bookmark-item["']/);
  assert.match(componentSource, /data-testid=["']chat-message-bookmark-summary["']/);
  assert.match(componentSource, /isDesktopPanelOpen/);
  assert.match(componentSource, /setIsDesktopPanelOpen/);
  assert.match(componentSource, /aria-label=["']显示消息书签["']/);
  assert.match(componentSource, /aria-label=["']隐藏消息书签["']/);
  assert.match(componentSource, /\b(md|lg|xl):/);
  assert.doesNotMatch(componentSource, /loadAllMessages\s*\(/);
  assert.match(componentSource, /userMessageKey|messageKey/);
  assert.match(chatInterfaceSource, /ConversationBookmarks|chat-message-bookmarks|onBookmarkSelect/);
  assert.match(chatInterfaceSource, /loadMessagesUntilTarget|revealLoadedMessage/);
  assert.match(sessionRuntimeSource, /loadMessagesUntilTarget/);
});
