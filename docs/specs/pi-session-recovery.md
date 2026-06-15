# 规格：Pi 消息恢复与持久顺序

约束刷新恢复、JSONL 快照桥接、DeepSeek thinking 持久化和消息身份稳定。

## 测试入口

- `pnpm exec tsx --test tests/backend/pi-session-messages-endpoint.test.ts`
- `pnpm exec tsx --test tests/specs/pi-session-message-order.spec.ts`
- `pnpm exec tsx --test tests/manual/node-history/pi-session-message-recovery-contract.test.ts`

## 需求：刷新网页后 Pi 会话消息恢复

### 场景：已完成的 Pi 会话刷新后完整恢复

- **给定** 一个已有历史消息的 Pi 会话
- **当** 用户刷新浏览器后导航到该会话
- **则** 该会话的所有历史消息气泡必须完整显示
- **且** JSONL 优先读取，live snapshot 桥接仅在 JSONL 尚未就绪时兜底

### 场景：正在运行中的 Pi 会话刷新后已完成消息可见

- **给定** 一个正在流式响应的 Pi 会话
- **当** 用户刷新浏览器后导航到该会话
- **则** 已完成的 assistant 消息和 user 消息气泡必须可见
- **且** 运行中的 live transcript 通过 `getNativeSessionLiveTranscript` 返回实时数据

### 场景：运行时 liveMessages 为空不得提前返回空

- **给定** Pi 会话正在运行（status === 'running'）但 liveMessages 为空数组
- **当** 用户刷新页面后请求消息
- **则** `handleGetSessionMessages` 不得因 liveSnapshot 为空数组而提前返回空消息
- **且** 必须使用 `liveSnapshot !== null` 检查（而非 `liveSnapshot && ...`）以允许空 liveMessages 穿透
- **且** 必须继续尝试后续 providerSessionId 和 snapshot 桥接路径

### 场景：JSONL 未就绪时回退到快照桥接

- **给定** Pi 会话已完成的 turn 但 JSONL 文件尚未被写入
- **且** providerSessionId 已绑定
- **当** `getPiSessionMessages` 返回空消息列表
- **则** 必须回退检查 `getPiSessionCompletedSnapshot`
- **且** 如果快照可用则必须返回快照消息而非空消息
- **且** 消息来源标记为 `live-snapshot-bridge`

## 需求：Pi DeepSeek 模型思考过程写入 JSONL 与刷新恢复

### 场景：Pi DeepSeek 模型流式返回 thinking 内容

- **给定** Pi 会话使用 DeepSeek 模型（返回 `reasoning_content`）
- **当** Pi SDK 产生 `thinking_delta` 流式事件
- **则** 思考内容必须在 turn 结束时写入 JSONL 文件
- **且** JSONL 中必须包含 `type: 'thinking'` 的 content part

### 场景：页面刷新后恢复 Pi DeepSeek 会话历史

- **给定** Pi DeepSeek 会话正在流式返回（status: `running`）
- **当** 用户刷新浏览器页面
- **则** 前端应先加载 JSONL 中已有的历史消息
- **且** 再合并当前 running 会话的 live transcript snapshot（如果存在）
- **且** 结果消息列表应包含刷新前已产生的所有思考块和工具调用
- **且** 后续 WebSocket 流式事件应正确追加到已有消息列表末尾（不覆盖、不重复）

### 场景：Pi running 刷新恢复合并 JSONL 历史与 live snapshot

- **给定** Pi 会话正在运行且 JSONL 已有部分历史
- **当** `handleGetSessionMessages` 处理 running 状态
- **则** 必须先读取 `getPiSessionMessages` JSONL 历史
- **且** 再调用 `mergeAndDedupMessages()` 与 live snapshot 按 `messageKey` + 内容指纹去重合并
- **且** `normalizeLiveMessageToJsonlShape()` 将 live `ChatMessageLike` 标准化为 JSONL wire shape
- **且** `makeMessageFingerprint()` 同时读取 `msg.message.content` 和 `msg.content` 防止去重丢失

### 场景：Pi 会话完成后 JSONL 包含完整思考历史

- **给定** Pi 会话已完成（`pi-complete` 已发送）
- **当** 前端请求会话消息
- **则** 返回的消息列表应包含所有思考块（`isThinking: true`）
- **且** 思考内容与流式渲染时一致，无截断或丢失

### 场景：JSONL 未就绪时回退到快照桥接

- **给定** Pi 会话已完成的 turn 但 JSONL 文件尚未被写入
- **且** providerSessionId 已绑定
- **当** `getPiSessionMessages` 返回空消息列表
- **则** 必须回退检查 `getPiSessionCompletedSnapshot`
- **且** 如果快照可用则必须返回快照消息而非空消息
- **且** 快照消息通过 `normalizeLiveMessageToJsonlShape()` 标准化

## 需求：Pi live 与刷新后的 persisted 顺序一致

同一轮 Pi 输出在运行态和刷新态应保持相同的用户可读顺序。

### 场景：运行态先看到思考、工具和最终正文

- **给定** Pi live 事件按 `thinking A -> toolCall B -> toolResult B -> thinking C -> text D` 到达
- **当** 用户在会话运行中查看 transcript
- **则** 聊天区必须按该顺序展示
- **且** `thinking C` 不得回写到 `thinking A` 导致工具卡片视觉下沉

### 场景：完成后刷新不改变相对顺序

- **给定** 同一轮 Pi 输出已经写入 native JSONL
- **当** 用户刷新页面或 ozw 通过 `projects_updated` 重新加载 `/messages`
- **则** persisted transcript 的相对顺序必须与运行态一致
- **且** 不得出现 live/persisted 双份工具卡片或双份 assistant 正文

## 需求：Pi 消息身份必须稳定且不误删真实重复

Pi 顺序修复应依赖 provider line/part/tool identity，而不是正文相同或 timestamp 相近。

### 场景：用户连续发送相同文本

- **给定** 用户在同一个 Pi 会话中连续两次发送相同短文本，例如“继续”
- **当** 两次发送都写入 Pi JSONL
- **则** 两个用户 turn 必须都展示
- **且** 它们的后续 assistant、thinking 和工具卡片不得因为正文相同被合并

### 场景：同一行内多个 part 共用 timestamp

- **给定** Pi 同一条 assistant JSONL 的多个 content part 使用同一个 timestamp
- **当** ozw 构建消息顺序
- **则** 顺序必须来自 JSONL line number 和 content part index
- **且** 不得用 timestamp 重新排序这些 part
