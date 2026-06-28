/**
 * PURPOSE: Contract-test the source integration points for current-session
 * message bookmarks so implementation stays on existing pagination and
 * responsive chat layout boundaries.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const BOOKMARK_COMPONENT_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'chat',
  'view',
  'subcomponents',
  'ConversationBookmarks.tsx',
);
const CHAT_INTERFACE_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'chat',
  'view',
  'ChatInterface.tsx',
);
const SESSION_RUNTIME_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'chat',
  'session',
  'sessionRuntimeController.ts',
);

/**
 * Read a production source file and produce a clear acceptance failure when a
 * required integration surface is missing.
 */
function readRequiredSource(filePath: string, businessName: string): string {
  assert.equal(fs.existsSync(filePath), true, `缺少 ${businessName}: ${path.relative(REPO_ROOT, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

test('书签组件提供桌面列表、手机按钮和手机抽屉入口', () => {
  const source = readRequiredSource(BOOKMARK_COMPONENT_PATH, '当前会话消息书签组件');

  assert.match(source, /data-testid=["']chat-message-bookmarks["']/, '组件根节点必须可测试定位');
  assert.match(source, /data-testid=["']chat-bookmark-desktop-list["']/, '桌面端必须有常驻书签列表');
  assert.match(source, /data-testid=["']chat-bookmark-mobile-trigger["']/, '手机端必须有书签入口按钮');
  assert.match(source, /data-testid=["']chat-bookmark-mobile-panel["']/, '手机端必须有书签抽屉或面板');
  assert.match(source, /data-testid=["']chat-message-bookmark-item["']/, '每个书签项必须可测试定位');
  assert.match(source, /data-testid=["']chat-message-bookmark-summary["']/, '助手摘要必须有稳定测试标识');
  assert.match(source, /\b(md|lg|xl):/, '组件必须包含响应式断点样式或等价响应式入口');
});

test('书签点击复用当前会话 messageKey 定位，不调用全量加载', () => {
  const componentSource = readRequiredSource(BOOKMARK_COMPONENT_PATH, '当前会话消息书签组件');
  const chatInterfaceSource = readRequiredSource(CHAT_INTERFACE_PATH, '聊天界面接入点');
  const sessionRuntimeSource = readRequiredSource(SESSION_RUNTIME_PATH, '会话分页定位控制器');

  assert.doesNotMatch(
    componentSource,
    /loadAllMessages\s*\(/,
    '书签组件不得通过 loadAllMessages 实现跳转，否则长会话会被强制全量加载',
  );
  assert.match(
    componentSource,
    /userMessageKey|messageKey/,
    '书签点击必须携带用户消息 messageKey 作为定位锚点',
  );
  assert.match(
    chatInterfaceSource,
    /ConversationBookmarks|chat-message-bookmarks|onBookmarkSelect/,
    'ChatInterface 必须接入书签组件或等价书签选择回调',
  );
  assert.match(
    chatInterfaceSource,
    /loadMessagesUntilTarget|revealLoadedMessage/,
    '书签定位必须复用现有逐页加载或已加载消息定位能力',
  );
  assert.match(
    sessionRuntimeSource,
    /loadMessagesUntilTarget/,
    '会话运行时必须保留按目标 messageKey 逐页加载的能力',
  );
});
