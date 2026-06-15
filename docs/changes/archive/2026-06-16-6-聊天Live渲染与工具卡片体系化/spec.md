# 规格：聊天 Live 渲染与工具卡片体系化

## 验收矩阵

| 场景 | required_tests | required_evidence |
| --- | --- | --- |
| accepted 用户气泡立即进入绿色 persisted 状态 | `delivery-status-machine-contract` | `delivery-status-state` |
| live 内容先于 JSONL 可见且 reload 不清空 | `live-before-jsonl-contract` | `live-before-jsonl-screenshot` |
| 文件型工具路径统一可点击打开 | `tool-open-file-contract` | `tool-open-file-screenshot` |

### 需求：deliveryStatus 成为明确状态机

#### 场景：accepted 用户气泡立即进入绿色 persisted 状态

- **给定** 用户在 Codex/Pi 手动会话发送消息
- **当** 前端收到 provider `message-accepted`
- **则** 对应 optimistic 用户行必须进入 `persisted`
- **并且** DOM 气泡必须使用绿色样式
- **测试文件**：`docs/changes/6-聊天Live渲染与工具卡片体系化/tests/chat-live-tooling.contract.test.ts`
- **真实数据来源**：真实 reducer 源码和 browser spec
- **入口路径**：`deliveryStatusMachine` 与 `chatMessageReducer`
- **关键断言**：状态机函数存在；accepted 不再转 `sent`；browser spec 断言 green CSS
- **剩余风险**：旧历史消息没有 deliveryStatus 时仍按 persisted 显示

### 需求：live transcript 不被 JSONL 延迟阻塞

#### 场景：live 内容先于 JSONL 可见且 reload 不清空

- **给定** provider 已 accepted 用户消息但 JSONL 尚未写入该 turn
- **当** 前端收到 live assistant/tool/thinking event
- **则** live 内容必须可见
- **并且** 空 persisted refresh 不得清空 accepted optimistic 用户行和 live 内容
- **测试文件**：`docs/changes/6-聊天Live渲染与工具卡片体系化/tests/chat-live-tooling.contract.test.ts`
- **真实数据来源**：真实 merge/reducer 源码和现有 Playwright 业务用例
- **入口路径**：`liveTurnMergePolicy`、`sessionMessageMerge`、`useChatSessionState`
- **关键断言**：有独立 merge policy；Playwright 覆盖 live before JSONL；reducer 覆盖 empty reload preserve
- **剩余风险**：真实外部 provider 写盘延迟不可控，但本地事件契约可验证

### 需求：工具卡片文件打开契约统一

#### 场景：文件型工具路径统一可点击打开

- **给定** Codex/Pi 输出 Read、Edit、FileChanges 或 view_image 工具卡片
- **当** 用户点击卡片里的文件路径
- **则** 前端必须调用 workspace `onFileOpen`
- **并且** 图片路径应打开右侧图片预览
- **测试文件**：`docs/changes/6-聊天Live渲染与工具卡片体系化/tests/chat-live-tooling.contract.test.ts`
- **真实数据来源**：真实 ToolRenderer/toolConfigs 源码和 Playwright 页面截图
- **入口路径**：`openFileToolConfig`、`ToolRenderer`、`CodeEditorImagePreview`
- **关键断言**：open-file helper 存在；view_image 配置去重；Playwright 点击图片路径打开预览
- **剩余风险**：文件不存在时仍由现有 editor error UI 处理
