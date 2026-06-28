# 设计：会话消息导航书签

## 总体结构

```text
frontend/components/chat/utils/conversationBookmarks.ts
  |
  +-- buildConversationBookmarks(messages)
        |
        +-- 输出轻量书签索引

frontend/components/chat/view/subcomponents/ConversationBookmarks.tsx
  |
  +-- 桌面书签列表
  +-- 手机入口和抽屉

ChatInterface.tsx
  |
  +-- 传入当前会话消息
  +-- 传入定位回调
```

## 数据合同

书签对象建议包含：

| 字段 | 含义 |
|---|---|
| `id` | 书签自身稳定标识 |
| `userMessageKey` | 点击后定位的用户消息 key |
| `userPreview` | 用户消息预览 |
| `assistantMessageKey` | 已完成回复的消息 key；进行中时为 `null` |
| `assistantSummary` | 智能体最终回复正文前 50 个字符，或“回复中” |
| `assistantStatus` | `complete` 或 `pending` |

## 摘要规则

- 只取智能体最终回复正文。
- 跳过思考消息、工具调用、工具结果、子智能体容器和错误消息。
- 直接截取前 50 个字符。
- 不追加省略号，避免摘要长度超过合同。

```text
assistant.content
  -> 去掉首尾空白
  -> 折叠连续空白
  -> 截取前 50 个字符
```

## 定位策略

优先复用现有能力：

```text
点击书签
  |
  +-- 当前已加载 -> revealLoadedMessage(userMessageKey)
  |
  +-- 未加载 -> loadMessagesUntilTarget({ messageKey: userMessageKey })
                    |
                    +-- 逐页加载旧消息
                    +-- 找到后 revealLoadedMessage
```

不得通过 `loadAllMessages` 实现书签跳转。

## 响应式布局

| 断点 | 设计 |
|---|---|
| 桌面端 | 右侧窄栏，宽度固定或可约束，不挤压输入区 |
| 手机端 | 浮动图标按钮或顶部紧凑按钮，点击后打开底部抽屉 |

## 风险和取舍

| 风险 | 处理 |
|---|---|
| 历史消息未加载导致书签不完整 | 先展示已加载索引；点击旧搜索目标时逐页加载 |
| 书签列表太长 | 书签列表自身滚动，不扩大聊天 DOM |
| 摘要含 Markdown 或代码块 | 仍按正文文本截断，不做富文本渲染 |
| 手机遮挡输入框 | 抽屉打开时覆盖列表，关闭后恢复聊天 |
