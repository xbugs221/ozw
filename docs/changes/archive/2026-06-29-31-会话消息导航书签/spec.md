# 规格：会话消息导航书签

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence |
|---|---|---|---|
| 需求：当前会话生成用户消息书签 | 场景：用户消息与最终回复摘要配对 | `contract-bookmark-index` | `bookmark-state-snapshot` |
| 需求：当前会话生成用户消息书签 | 场景：进行中消息保留书签 | `contract-bookmark-index` | `bookmark-state-snapshot` |
| 需求：点击书签定位当前会话消息 | 场景：已加载消息直接定位 | `contract-bookmark-integration`, `e2e-bookmark-navigation` | `desktop-bookmark-screenshot`, `bookmark-network-log` |
| 需求：点击书签定位当前会话消息 | 场景：目标未加载时逐页加载 | `contract-bookmark-integration`, `e2e-bookmark-navigation` | `bookmark-network-log` |
| 需求：桌面和手机端适配 | 场景：桌面常驻列表，手机抽屉入口 | `contract-bookmark-integration`, `e2e-bookmark-responsive` | `desktop-bookmark-screenshot`, `mobile-bookmark-screenshot` |
| 需求：长会话性能边界 | 场景：不全量加载、不破坏虚拟滚动 | `contract-bookmark-index`, `e2e-bookmark-performance` | `bookmark-network-log`, `bookmark-state-snapshot` |

### 需求：当前会话生成用户消息书签

#### 场景：用户消息与最终回复摘要配对

- 测试文件：`docs/changes/31-会话消息导航书签/tests/message-bookmark-index.acceptance.test.ts`
- 真实数据来源：使用生产 `ChatMessage` 字段组合，包含用户消息、思考消息、工具消息和最终助手消息。
- 入口路径：`frontend/components/chat/utils/conversationBookmarks.ts` 的 `buildConversationBookmarks`。
- 关键断言：
  - 每条用户消息生成一个书签。
  - 思考消息和工具消息不会被当作最终回复摘要。
  - `assistantSummary` 等于最终回复正文前 50 个字符。
  - 摘要不追加省略号。
- 剩余风险：不同 Provider 的特殊正文结构可能需要在执行阶段补充样例。

#### 场景：进行中消息保留书签

- 测试文件：`docs/changes/31-会话消息导航书签/tests/message-bookmark-index.acceptance.test.ts`
- 真实数据来源：使用生产 `ChatMessage` 字段组合，构造只有用户消息、工具或思考过程但尚无最终助手回复的会话。
- 入口路径：`buildConversationBookmarks`。
- 关键断言：
  - 用户消息仍生成书签。
  - `assistantStatus` 为 `pending`。
  - `assistantSummary` 为“回复中”。
- 剩余风险：实际流式消息完成事件仍需端到端测试覆盖更新时机。

### 需求：点击书签定位当前会话消息

#### 场景：已加载消息直接定位

- 测试文件：
  - `docs/changes/31-会话消息导航书签/tests/message-bookmark-integration.acceptance.test.ts`
  - `docs/changes/31-会话消息导航书签/tests/message-bookmark-e2e.acceptance.spec.ts`
- 真实数据来源：仓库既有 Playwright Codex 历史 fixture，代表真实 JSONL 会话读取链路。
- 入口路径：`/session/fixture-mixed-long-virtual-session`
- 关键断言：
  - 书签列表可见。
  - 点击当前已加载尾部的用户消息书签后，该用户消息进入视口。
  - 定位使用 `messageKey`，不是文本搜索滚动。
- 剩余风险：高亮动画时长不作为合同，只要求目标进入视口。

#### 场景：目标未加载时逐页加载

- 测试文件：
  - `docs/changes/31-会话消息导航书签/tests/message-bookmark-integration.acceptance.test.ts`
  - `docs/changes/31-会话消息导航书签/tests/message-bookmark-e2e.acceptance.spec.ts`
- 真实数据来源：`fixture-mixed-long-virtual-session` 的 1000+ 轮长会话。
- 入口路径：`ChatInterface -> useChatSessionState.loadMessagesUntilTarget`
- 关键断言：
  - 书签跳转不得调用 `loadAllMessages`。
  - 网络请求必须保留分页参数。
  - 找到目标后再执行可见定位。
- 剩余风险：旧消息索引完整性依赖服务端分页返回稳定 `messageKey`。

### 需求：桌面和手机端适配

#### 场景：桌面常驻列表，手机抽屉入口

- 测试文件：
  - `docs/changes/31-会话消息导航书签/tests/message-bookmark-integration.acceptance.test.ts`
  - `docs/changes/31-会话消息导航书签/tests/message-bookmark-e2e.acceptance.spec.ts`
- 真实数据来源：真实聊天页和 Playwright viewport。
- 入口路径：`ConversationBookmarks.tsx`
- 关键断言：
  - 桌面端显示 `chat-bookmark-desktop-list`。
  - 手机端显示 `chat-bookmark-mobile-trigger`，点击后显示 `chat-bookmark-mobile-panel`。
  - 书签区域不遮挡聊天输入框。
- 剩余风险：精确视觉样式通过截图复核，不在源码契约里固定具体像素。

### 需求：长会话性能边界

#### 场景：不全量加载、不破坏虚拟滚动

- 测试文件：
  - `docs/changes/31-会话消息导航书签/tests/message-bookmark-index.acceptance.test.ts`
  - `docs/changes/31-会话消息导航书签/tests/message-bookmark-e2e.acceptance.spec.ts`
- 真实数据来源：`fixture-mixed-long-virtual-session` 的 1000+ 轮会话。
- 入口路径：聊天页真实消息 API、虚拟滚动 DOM。
- 关键断言：
  - 初始打开长会话不发起无分页参数的全量消息请求。
  - `.chat-message` DOM 数量保持不超过现有虚拟滚动上限。
  - 书签索引构建可处理 1000+ 轮消息。
- 剩余风险：极端超长回复摘要的文本清理成本需要执行阶段用浏览器性能数据复核。
