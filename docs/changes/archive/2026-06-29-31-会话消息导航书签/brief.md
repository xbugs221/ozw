# 会话消息导航书签简报

## 用户问题

当前会话消息变多后，用户难以快速回到之前的关键请求。现有聊天页已有分页加载、虚拟滚动和按 `messageKey` 定位能力，本次变更需要在此基础上增加一个当前会话内的消息导航书签。

## 交付目标

- 在当前会话内展示用户消息书签。
- 每个书签展示用户消息预览，以及后续智能体最终回复正文前 50 个字符。
- 点击书签后定位到对应用户消息；目标尚未加载时，逐页加载旧消息直到找到目标。
- 桌面端提供常驻轻量导航；手机端提供折叠入口和抽屉式列表。
- 长会话下不强制加载全部历史，不破坏现有虚拟滚动 DOM 上限。

## 非目标

- 不做跨会话导航或全局搜索。
- 不调用模型重新生成摘要。
- 不展示工具调用、思考过程、系统消息作为书签主体。
- 不重做聊天消息分页和虚拟滚动架构。

## 验收入口

- `pnpm exec tsx --test docs/changes/31-会话消息导航书签/tests/message-bookmark-index.acceptance.test.ts`
- `pnpm exec tsx --test docs/changes/31-会话消息导航书签/tests/message-bookmark-integration.acceptance.test.ts`
- `pnpm exec playwright test --config=playwright.spec.config.ts docs/changes/31-会话消息导航书签/tests/message-bookmark-e2e.acceptance.spec.ts`

## 执行阶段默认上下文

优先从以下现有能力切入：

```text
ChatInterface
  |
  +-- useChatSessionState
  |     +-- visibleMessages
  |     +-- loadMessagesUntilTarget
  |     +-- revealLoadedMessage
  |
  +-- ChatMessagesPane
        +-- 虚拟滚动
        +-- data-message-key 定位
```

新增实现应保持仓库精简：书签索引逻辑放在可单独测试的纯函数里，界面组件只负责渲染和触发定位。
