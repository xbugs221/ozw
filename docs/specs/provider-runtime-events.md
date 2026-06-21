# 规格：Provider runtime live 事件渲染

约束 provider 原生事件、JSONL reconcile、conf 元数据和实时消息类型标志。

## 测试入口

- `pnpm exec tsx --test tests/specs/provider-runtime-boundary.spec.ts`
- `pnpm exec tsx --test tests/specs/backend-realtime-boundary.spec.ts`
- `pnpm exec tsx --test tests/specs/provider-live-non-streaming-render.spec.ts`
- `pnpm exec tsx --test tests/specs/codex-live-transcript-rendering.spec.ts`
- `pnpm exec tsx --test tests/specs/chat-tool-message-types.spec.ts`

## 需求：provider 原生事件直接驱动运行中消息渲染

### 场景：Provider runtime facade 不直接承载 mapper、session store 和 fake runtime 主体

- **给定** Codex/Pi 原生 runtime 事件、session status、abort 和 fake Pi runtime 都会经过 provider runtime facade
- **当** 维护者修改 `backend/domains/provider-runtime/runtime-router.ts`
- **那么** Pi/Codex 事件转换必须位于 `provider-event-mappers.ts`
- **并且** session lookup、status 和 abort 状态主体必须位于 `runtime-session-store.ts`
- **并且** fake runtime 或测试 harness 必须位于独立模块
- **并且** `runtime-router.ts` 只能保留 public facade 和路由协调，不得重新定义 mapper/session lookup/fake runtime 主体

对应规格测试：`tests/specs/backend-realtime-boundary.spec.ts`，并生成 `test-results/backend-realtime-boundary/source-audit.json`。

### 场景：Codex JSONL 尚未落盘时页面也能显示 assistant 内容

- **给定** 用户在 ozw 中发起 Codex 手动聊天
- **且** Codex app-server 已通过 WebSocket 返回 `agent_message` item
- **且** provider JSONL 尚未可读或尚未包含完整 assistant 内容
- **当** 前端收到 `codex-response`
- **那么** 页面应直接显示该 assistant 内容
- **并且** 同一 `itemId` 的后续 update 应更新同一条消息而不是追加重复气泡

### 场景：Codex 文件变更协议 JSON 不进入聊天正文

- **给定** 用户打开 Codex 会话页面
- **当** 前端收到 `codex-response`，其中 `data.type = "item"`、`itemType = "agent_message"`，但 `message.content` 是 `type: "add"`、`type: "update"` 或同类新建/更新/写入文件操作 JSON 字符串
- **那么** 聊天正文不得显示该 raw JSON
- **并且** 不得显示 `JSON Response`、`"type": "add"`、`"type": "update"` 这类协议结构
- **并且** 不得把文件写入内容直接当作普通 assistant 正文
- **并且** 真实 assistant 文本仍保持可见

### 场景：Codex 真实 JSON 输出仍可显示

- **给定** Codex 输出的是用户可见正文，或用户明确要求 Codex 输出 JSON
- **当** 前端收到对应 live event 或从持久化 read model 恢复
- **那么** 正文仍应显示
- **并且** 真实业务 JSON 仍可走现有 JSON renderer，不得被协议过滤误删

### 场景：Provider payload 解析只有一个 typed 来源

- **给定** 聊天消息转换、消息 merge 和 live transcript 都需要识别 provider file update 或 Codex tool update payload
- **当** 审计生产源码中的 parser 使用关系
- **那么** `frontend/components/chat/utils/providerPayloadParsers.ts` 必须导出统一 typed parser
- **并且** `messageTransforms.ts` 和 `sessionMessageMerge.ts` 必须复用该模块
- **并且** 不得在消息转换或 merge 路径保留重复私有 parser 副本

对应规格测试：`tests/specs/chat-tool-message-types.spec.ts`，并生成 `test-results/chat-tool-message-types/source-audit.json`。

### 场景：Pi streaming delta 合并为同一条 assistant 消息

- **给定** 用户在 ozw 中发起 Pi 手动聊天
- **当** Pi SDK 连续返回同一 `messageId` 的 text delta
- **那么** 页面应把这些 delta 合并为一条 assistant 消息
- **并且** 不依赖 `/messages` 反复读取 JSONL 才能看到运行中内容

## 需求：provider JSONL 只作为持久历史来源

### 场景：完成后用 provider JSONL reconcile，不重复显示 live 消息

- **给定** 一个 Codex 或 Pi turn 已通过 live transcript 展示
- **当** provider JSONL/session store 完成落盘
- **并且** 前端执行最终 history reconcile
- **那么** persisted transcript 应替换或确认 live message
- **并且** 同一 user/assistant/tool 消息不得重复显示或乱序

### 场景：前后端共享 live transcript reducer

- **给定** provider runtime 需要维护 active turn overlay 和 live transcript snapshot
- **当** 前端渲染 native runtime transcript 且后端 store 合并 provider event
- **那么** 两端必须复用 `shared/provider-runtime-transcript.ts` 中的纯 reducer 和类型
- **并且** 后端 provider runtime 模块不得导入 `frontend/components/chat/*`
- **并且** active turn store 和 live transcript store 不得用 `@ts-nocheck` 绕过类型边界

### 场景：长历史仍按需加载

- **给定** 一个包含大量历史消息的 Codex/Pi 会话
- **当** 用户打开该会话
- **那么** ozw 仍只加载最新窗口
- **并且** 用户向上滚动或点击加载时才加载更早消息
- **并且** 前端 DOM 挂载消息数量仍有上限

## 需求：`conf.json` 只保存元数据

### 场景：发送运行中消息不会写入 pending transcript

- **给定** 用户发送 Codex/Pi 消息
- **当** provider session id 还未最终落盘到 provider history
- **那么** ozw 不得把 `pendingUserMessages`、`pendingProviderSessionId`、`startRequestId`、`cancelRequested` 写入 XDG `conf.json`
- **并且** 刷新恢复应使用 native runtime live snapshot 或 provider JSONL，而不是 config 中的 pending transcript

## 需求：正常请求取消不得污染浏览器错误证据

刷新、路由切换或组件卸载导致的 slash commands 请求取消是正常生命周期结果，不应作为用户可见错误或 QA 阻塞项。

### 场景：slash commands 请求被页面生命周期取消

- **给定** 用户打开项目页面或会话页面，前端正在加载 slash commands
- **当** 页面刷新、路由切换、组件卸载或浏览器取消该请求
- **那么** 前端不得写入 `Error fetching slash commands` console error
- **并且** 不得展示可见错误提示
- **并且** QA 证据必须能把该取消归类为 expected cancellation，而不是 unhandled network failure

### 场景：slash commands 真实服务失败仍可诊断

- **给定** `/api/commands/list` 返回 HTTP 5xx、认证错误或非取消型网络失败
- **当** 前端捕获该失败
- **那么** 仍必须保留错误诊断或可恢复状态
- **并且** 不得把真实失败误分类为 expected cancellation

### 场景：项目内 `.ozw/conf.json` 不再参与配置读写

- **给定** 项目目录中存在旧 `<project>/.ozw/conf.json`
- **当** ozw 读取或保存项目配置
- **那么** ozw 只使用 XDG state 下的 config
- **并且** 不创建、不读取、不更新项目内 `.ozw/conf.json`

## 需求：co 兼容和 co 数据彻底清理

### 场景：生产代码不再包含 co 文件协议入口

- **给定** ozw 已使用 Codex app-server 与 Pi native SDK
- **当** 构建或测试生产源码
- **那么** `backend/co-client.ts`、`backend/co-read-model.ts` 和 co request/state/event 兼容入口不应存在
- **并且** 手动聊天路径不读取 `CCFLOW_CO_HOME` 或 `co-request-v1` / `co-conversation-v1`

### 场景：升级后删除 ozw legacy co state

- **给定** 用户本机存在旧 `${XDG_STATE_HOME}/ozw/co` 目录
- **当** ozw 启动或执行迁移 cleanup
- **那么** ozw 应幂等删除该 legacy co state
- **并且** 不删除 `~/.codex`、`~/.pi` 等 provider 原生历史数据

---

## 需求：实时流式消息的类型标志必须与持久化消息一致

### 场景：Pi thinking delta 实时渲染为正文同款 Markdown

Given 一个 Pi 手动会话正在流式传输 thinking_delta
When `reduceNativeRuntimeEvent` 处理 `itemType: 'reasoning'` 事件
Then 生成的消息必须满足：
- `type === 'assistant'`
- `isThinking === true`
- `content` 为合并后的 thinking 文本

当该消息被 `MessageComponent` 渲染时：
- 必须使用 `<Markdown>` 组件渲染内容
- 必须使用与助手正文一致的字号和文字颜色
- 不得使用灰色左竖线、额外缩进或斜体弱化思考正文

### 场景：Pi tool_call 实时渲染为工具卡片

Given 一个 Pi 手动会话正在执行工具
When `reduceNativeRuntimeEvent` 处理 `itemType: 'tool_call'` 或 `itemType: 'tool_result'` 事件
Then 生成的消息必须满足：
- `type === 'assistant'`
- `isToolUse === true`
- `toolName` 和 `toolInput`/`toolResult` 正确填充

当该消息被 `MessageComponent` 渲染时：
- 不得显示 🔧 icon 和 "工具" label
- 必须使用 `ToolRenderer` 渲染工具卡片

### 场景：Codex reasoning item 同样使用 assistant + isThinking

Given 一个 Codex 会话返回 `itemType: 'reasoning'`
When `reduceNativeRuntimeEvent` 处理该事件
Then 生成的消息必须满足：
- `type === 'assistant'`
- `isThinking === true`
- 渲染时与 Pi thinking 使用同一正文样式契约

### 场景：更新后的历史测试断言不 regress

Given 50 号提案的 `native-live-transcript.test.ts` 已更新断言
When 运行 `pnpm test tests/2026-05-28-50-...native-live-transcript.test.ts`
Then 所有测试必须通过，且不得出现 `type === 'reasoning'` 或 `type === 'tool'` 的断言

---
