# 任务：会话消息导航书签

## 1. 先运行创建阶段契约测试

- [x] 运行 `pnpm exec tsx --test docs/changes/31-会话消息导航书签/tests/message-bookmark-index.acceptance.test.ts`
- [x] 运行 `pnpm exec tsx --test docs/changes/31-会话消息导航书签/tests/message-bookmark-integration.acceptance.test.ts`
- [x] 运行 `pnpm exec playwright test --config=playwright.spec.config.ts docs/changes/31-会话消息导航书签/tests/message-bookmark-e2e.acceptance.spec.ts`
- [x] 确认初始失败原因是书签构建器、书签组件或 UI 行为尚未实现，而不是测试语法、路径或环境错误。

## 2. 实现书签索引纯逻辑

- [x] 新增 `frontend/components/chat/utils/conversationBookmarks.ts`
- [x] 导出 `CHAT_BOOKMARK_ASSISTANT_SUMMARY_LIMIT = 50`
- [x] 导出 `buildConversationBookmarks`
- [x] 跳过思考、工具、工具结果、错误和子智能体容器消息。
- [x] 对后续最终助手回复正文做 50 字符直接截断。
- [x] 为无最终回复的用户消息输出“回复中”状态。

## 3. 实现界面组件

- [x] 新增 `ConversationBookmarks.tsx`
- [x] 桌面端显示常驻书签列表。
- [x] 手机端显示书签按钮和抽屉面板。
- [x] 书签项展示用户预览和助手摘要。
- [x] 书签项使用稳定 `data-testid`，便于端到端测试复核。

## 4. 接入聊天页定位链路

- [x] 在 `ChatInterface.tsx` 或相邻组合层生成书签索引。
- [x] 点击书签时优先调用现有 `revealLoadedMessage`。
- [x] 目标未加载时调用 `loadMessagesUntilTarget`。
- [x] 不使用 `loadAllMessages` 作为书签跳转路径。
- [x] 确保目标行 `data-message-key` 与书签 `userMessageKey` 一致。

## 5. 响应式和性能验证

- [x] 桌面截图写入 `test-results/chat-message-bookmarks/desktop.png`
- [x] 手机截图写入 `test-results/chat-message-bookmarks/mobile.png`
- [x] 网络日志写入 `test-results/chat-message-bookmarks/network.json`
- [x] 状态快照写入 `test-results/chat-message-bookmarks/state.json`
- [x] 确认长会话 `.chat-message` DOM 数量不超过 150。

## 6. 回归验证

- [x] 契约测试全部通过。
- [x] 执行相关历史测试：`pnpm exec playwright test --config=playwright.spec.config.ts tests/e2e/history-scroll-preservation.spec.ts`
  - 2026-06-29：该命令在 `playwright.spec.config.ts` 下返回 `No tests found`；改用 `playwright.config.ts` 运行同文件，结果 6 passed / 2 failed，失败点为历史滚动既有长用例超时和外部追加可见性断言。
- [x] 检查桌面和手机布局没有遮挡输入框。
