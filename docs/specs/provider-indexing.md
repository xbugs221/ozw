# 规格：Provider 索引与会话来源

约束 Provider 项目发现、会话概览、手动列表、跨 provider 边界和历史 co 清理。

## 测试入口

- `pnpm exec tsx --test tests/backend/provider-session-index-store.test.ts`
- `pnpm exec tsx --test tests/specs/provider-session-list-read-model.spec.ts`
- `pnpm exec tsx --test tests/specs/hermes-readonly-provider.spec.ts`
- `pnpm exec tsx --test tests/specs/provider-runtime-boundary.spec.ts tests/specs/project-index-backfill-selection.spec.ts`

## 需求：项目发现必须使用 Provider 的轻量权威索引

`/api/projects` 必须通过轻量数据源发现 Codex、Pi、Claude 项目和会话概览，不得为仓库列表全量解析 Provider 历史。

### 场景：Codex 通过 JSONL 首行发现项目

- **给定** `~/.codex/sessions/**/*.jsonl` 中某文件第一条非空记录是 `type=session_meta`
- **且** `payload.cwd = "/repo/codex-project"`
- **当** ozw 构建项目列表
- **则** 返回的项目包含 `/repo/codex-project`
- **并且** 对应 session provider 是 `codex`
- **且** 不需要读取该 JSONL 后续全部消息行

### 场景：Codex 旧格式 fallback 深读

- **给定** 某 Codex JSONL 第一条非空记录不是 `session_meta`
- **但** 文件中后续记录仍能被现有完整解析逻辑识别出 cwd
- **当** ozw 构建 Codex 索引
- **则** 该文件仍能被识别
- **并且** fallback 只影响该文件，不阻塞其他正常头部文件

### 场景：Pi 通过 JSONL 首行发现项目

- **给定** `~/.pi/agent/sessions/**/*.jsonl` 中某文件第一条非空记录是 `type=session`
- **且** `cwd = "/repo/pi-project"`
- **当** ozw 构建项目列表
- **则** 返回的项目包含 `/repo/pi-project`
- **并且** 对应 session provider 是 `pi`
- **且** 不需要读取该 Pi transcript 的后续记录

### 场景：Pi 通过 SQLite session 表发现项目

- **给定** Pi 数据库 `pi.db` 中 `session.directory = "/repo/pi-project"`
- **当** ozw 构建项目列表
- **则** 返回的项目包含 `/repo/pi-project`
- **并且** 对应 session provider 是 `pi`
- **且** 不需要执行 `pi session list --format json`
- **并且** 不扫描 snapshot、tool-output 或 session_diff 目录

### 场景：Claude 通过 JSONL 头部发现项目

- **给定** `~/.claude/projects/<project>/<session>.jsonl` 存在可用记录，含 `cwd`、`sessionId` 与时间戳
- **当** 后台 backfill 构建项目索引
- **则** 项目概览返回正确的 `claudeSessions`、provider 与 provider session id
- **并且** 首个可用记录后的坏行或大工具输出不得影响发现
- **且** Claude HOME 扫描不得位于轻量项目列表请求路径

### 场景：Provider 后台同步维护 project_index

- **给定** provider JSONL 新增、修改或删除
- **当** watcher 或启动 backfill 处理该变化
- **则** 后台任务必须同步更新 `provider_session_index` 和 `project_index`
- **且** 影响可见项目清单时必须发送 `project_list_invalidated`
- **且** 直接位于系统临时目录下的 `ozw-pi-*` 项目不得进入可见项目清单
- **测试文件**：`tests/specs/project-index-db-backed.spec.ts`

## 需求：多 Provider 会话概览必须保持身份稳定

项目概览可以使用轻量 session 元数据，但不得改变现有路由和 UI state 契约。

### 场景：同一项目存在三类 Provider 会话

- **给定** 同一项目路径下存在 Codex、Pi 和 Pi session
- **当** 请求 `/api/projects`
- **则** 同一个项目下分别返回 `codexSessions`、`piSessions`、`piSessions`
- **并且** 每个 session 的 provider 标记保持正确
- **且** 不能把 Pi 或 Pi 会话归入 Codex

### 场景：项目自定义标题和 session UI state 生效

- **给定** ozw project config 中保存了项目 displayName
- **且** 某 Provider session 有 favorite、pending 或 hidden 状态
- **当** 项目列表使用轻量 Provider 索引返回
- **则** displayName 和 session UI state 仍按配置叠加
- **并且** hidden session 默认不出现在可见列表中

### 场景：workflow child session 不进入普通手动会话列表

- **给定** 某 Provider session 被 workflow ownership metadata 标记为 child session
- **当** 项目列表使用轻量 Provider 索引返回
- **则** 该 session 不应出现在普通手动会话分组
- **并且** workflow 页面仍能按 workflow read model 访问它

## 需求：项目列表不得被历史体积线性拖慢

项目列表性能应与"文件数量和索引记录数量"相关，而不应与所有 transcript 内容总大小线性相关。

### 场景：Codex 后续大内容不影响项目发现

- **给定** Codex JSONL 首行包含完整 `session_meta`
- **且** 后续写入大量消息行或大型工具输出
- **当** 构建 Codex 项目索引
- **则** 项目归属仍来自首行
- **并且** 测试能证明后续内容不会被项目发现逻辑依赖

### 场景：Provider 索引同轮请求只构建一次

- **给定** 多个并发 `/api/projects` 或同一轮 `getProjects()` 内多次需要 Provider 索引
- **当** Provider 索引正在构建
- **则** 后续调用复用同一个 promise
- **并且** 不重复扫描 Codex/Pi 文件或重复查询 Pi DB

### 场景：Pi DB 不可用时快速 fallback

- **给定** `pi.db` 不存在、schema 不兼容或只读打开失败
- **当** ozw 构建 Pi 索引
- **则** 可以 fallback 到现有 CLI 读取
- **并且** CLI 失败时返回空 Pi 索引
- **且** 不能让整个项目列表请求失败

## 需求：会话详情仍按需读取真实历史

概览轻量化不能破坏进入会话后的聊天详情。

### 场景：进入 Codex 会话后仍能读取真实消息

- **给定** 项目概览中的 Codex session 来自 JSONL 头部索引
- **当** 用户打开该 session
- **则** 消息详情接口仍按 Codex JSONL 读取真实 transcript
- **并且** 不因概览 messageCount 为轻量值而丢失消息

### 场景：进入 Pi 会话后仍按 Pi/co read model 加载

- **给定** 项目概览中的 Pi session 来自 Pi JSONL 头部或 ozw 配置
- **当** 用户打开该 session
- **则** 消息详情按 Pi/co read model 加载
- **并且** 不 fallback 到 Codex JSONL

### 场景：进入 Claude 会话后显式分页读取历史

- **给定** 项目概览已提供 Claude session
- **当** 用户显式打开记录/消息入口并提供 `limit` 或 cursor
- **则** 只读取有界的 Claude JSONL 历史，保持 user、thinking、工具调用、工具结果与最终回复顺序
- **并且** 元数据与 sidechain 不进入可见记录
- **且** 默认进入 TUI 时不得预读历史

### 场景：进入 Pi 会话后仍按 Pi 数据源加载

- **给定** 项目概览中的 Pi session 来自 SQLite `session` 表
- **当** 用户打开该 session
- **则** 消息详情按 OpenCore 的消息数据源加载
- **并且** 项目概览不需要预先读取 `message` 或 `part` 全表

---

## 需求：Pi co 会话必须显示用户消息气泡

Pi 会话从 co durable state 回读时，必须把 request 文本还原成用户消息，而不是只显示 assistant event。

### 场景：turn 目录没有 request.json 但 state.json 有 request_id

- **给定** co conversation `c49` 的 provider 是 `pi`
- **且** `requests/done/<request>.json` 中存在 `text = "ping"`
- **且** `turns/<turn>/state.json` 中存在同一个 `request_id`
- **且** `turns/<turn>/events.jsonl` 中存在 `pi-response`
- **当** 前端请求 `/api/projects/:projectName/sessions/c49/messages?provider=pi`
- **则** 响应必须先包含 `role = "user"` 且 `content = "ping"` 的消息
- **并且** 后续包含对应 assistant 回复

### 场景：两轮 Pi 消息都可回读

- **给定** 同一个 Pi conversation 有两条 request，文本分别为 `"ping"` 和 `"ping2"`
- **且** 两个 turn 都通过 `state.json.request_id` 关联 request
- **当** ozw 读取该会话消息
- **则** transcript 顺序必须是 user `"ping"`、assistant、user `"ping2"`、assistant
- **并且** 第二条 user 消息不得被吞掉

## 需求：发送中的 Pi user 消息不得在刷新时消失

当 Pi request 被 co daemon 认领但尚未完成时，ozw 仍应保留用户刚发送的消息。

### 场景：request 位于 claimed 桶

- **给定** Pi request 已从 pending 移入 `requests/claimed`
- **且** turn state 已记录 `conversation_id` 和 `request_id`
- **当** 聊天页刷新或重新加载 session messages
- **则** API 响应必须包含该 request 的 user 消息
- **且** 前端不得把已显示的 optimistic user bubble 清除

### 场景：request 位于 running 桶

- **给定** Pi request 仍在 `requests/running`
- **当** ozw 读取 co conversation messages
- **则** user 消息必须可见
- **且** assistant event 尚未到达时 transcript 可以只有 user 消息

## 需求：durable user 消息与 optimistic 气泡必须去重

前端发送后立即展示的用户气泡，与 co durable request 回读出的用户消息代表同一次发送时，只能显示一条。

### 场景：durable request 确认 optimistic bubble

- **给定** 前端已显示一条 optimistic user bubble `"ping2"`
- **且** session messages 随后返回同一 request 的 durable user message `"ping2"`
- **当** 前端合并消息
- **则** 聊天区只显示一条 `"ping2"` 用户气泡
- **并且** 该气泡不再标记为 pending 或 failed

### 场景：真实重复发送不能被误删

- **给定** 用户连续两次发送相同文本 `"ping"`
- **且** 两次 request id 不同
- **当** durable transcript 回读完成
- **则** 聊天区必须显示两条独立的 user 消息

---

## 需求：手动会话列表应以 provider JSONL 为来源

ozw 必须把当前项目下存在的 Codex/Pi provider JSONL 作为会话列表来源，并在此基础上过滤可证明属于工作流内部的会话。

### 场景：Pi 命令行会话应进入手动列表

- **给定** 项目下存在一个 Pi JSONL 会话
- **且** 该会话没有 ozw `cN` route 或 `origin=manual` 元数据
- **且** 它没有被任何当前工作流元数据引用
- **当** 前端加载项目手动会话列表
- **则** 该 Pi 会话应出现在 `piSessions`

### 场景：Pi 工作流内部会话仍应被过滤

- **给定** 项目下存在一个 Pi JSONL 会话
- **且** 当前项目 workflow metadata 明确引用该 session id
- **当** 前端加载项目手动会话列表
- **则** 该 Pi 会话不得出现在 `piSessions`

### 场景：Codex 命令行会话应进入手动列表

- **给定** 项目下存在一个 Codex JSONL 会话
- **且** 该会话没有 ozw `cN` route 或 `origin=manual` 元数据
- **且** 它没有被任何当前工作流元数据引用
- **当** 前端加载项目手动会话列表
- **则** 该 Codex 会话应出现在 `codexSessions`

### 场景：Codex 工作流内部会话仍应被过滤

- **给定** 项目下存在一个 Codex JSONL 会话
- **且** 当前项目 workflow metadata 明确引用该 session id
- **当** 前端加载项目手动会话列表
- **则** 该 Codex 会话不得出现在 `codexSessions`

## 需求：oz flow clean 后的残留引用不得隐藏命令行会话

`oz flow clean` 删除工作流子会话 JSONL 后，ozw 不应再因为旧 workflow metadata 或缺少 ozw route 而隐藏其它 provider JSONL。

### 场景：已删除的工作流子会话只是不再出现

- **给定** workflow metadata 仍引用一个旧子会话 session id
- **且** 该子会话 JSONL 已不存在
- **且** 同项目下还有一个命令行直接产生的 provider JSONL
- **当** 前端加载项目手动会话列表
- **则** 已删除的子会话不出现
- **并且** 命令行 provider 会话仍出现

---

## 需求：手动聊天不得依赖 co

ozw 的 Codex/Pi 手动聊天必须由服务端 native agent runtime 直接调用 Codex app-server 或 Pi SDK，不得通过 co request、co conversation 或 co read model。

### 场景：Codex 手动消息直接进入 Codex app-server

- **给定** 用户在项目聊天页选择 Codex
- **当** 用户发送一条新消息
- **则** 服务端应创建或恢复 Codex app-server session
- **并且** 使用 app-server protocol 转发结构化事件
- **并且** 不写入 `co-request-v1`

### 场景：Pi 手动消息直接进入 Pi SDK

- **给定** 用户在项目聊天页选择 Pi
- **当** 用户发送一条新消息
- **则** 服务端应创建或恢复 Pi `AgentSession`
- **并且** 使用 `AgentSession` 事件更新前端
- **并且** 不写入 `co-request-v1`

## 需求：运行中输入必须遵循 provider 原生能力

ozw 必须区分 Codex 和 Pi 的运行中输入能力，不得把所有 provider 都包装成 co steer。

### 场景：Codex 运行中续发不得伪装成 steer

- **给定** Codex 当前会话正在生成回复
- **当** 用户输入第二条消息
- **则** ozw 不得发送 Codex steer
- **并且** ozw 应将该消息作为队列中的下一轮，或在用户选择停止后重新发送

### 场景：Pi 运行中 steer 应在下一次 LLM 调用前生效

- **给定** Pi 当前会话正在执行一轮包含工具调用的回复
- **当** 用户以 steer 方式发送纠正消息
- **则** 该消息应排入 Pi `AgentSession` steering queue
- **并且** 在当前工具执行结束后、下一次 LLM 调用前进入上下文

### 场景：Pi followUp 应在当前 run 自然结束后执行

- **给定** Pi 当前会话正在生成回复
- **当** 用户以 followUp 方式发送下一条消息
- **则** 该消息应排入 Pi follow-up queue
- **并且** 在当前 run 没有更多 tool call 和 steering message 后执行

## 需求：停止与刷新恢复应由 native runtime 保证

ozw 必须通过 provider native runtime 管理停止、完成和消息读取。

### 场景：停止后重新发送不复用旧运行态

- **给定** 任一 provider 当前会话正在运行
- **当** 用户点击停止
- **则** 服务端应 abort 当前 native run
- **并且** 清理该 session 的 active run
- **当** 用户随后发送新消息
- **则** 新消息应作为新的 provider turn 执行

### 场景：刷新页面后已完成消息不丢失

- **给定** 用户已经完成多轮 Codex/Pi 手动聊天
- **当** 用户刷新浏览器并重新打开同一 session
- **则** 页面应从 provider native transcript/session 读取已完成 user/assistant/tool 消息
- **并且** 不依赖 co conversation 数据

## 需求：历史 co 数据不进入新路径

ozw 不需要迁移、读取或展示历史 co conversation。

### 场景：旧 co conversation 不作为新会话来源

- **给定** 本机存在旧的 co conversation 文件
- **当** 用户打开 ozw 项目会话列表
- **则** 旧 co conversation 不应作为 Codex/Pi 手动 session 出现
- **并且** 新发送消息不得续写旧 co conversation

---

## 需求：Hermes 历史是只读的 profile-scoped Provider

Hermes `state.db` 只能作为本地允许 home 中的只读数据源。它的 session identity 必须由 profile scope 和原始 session id 共同组成，不能与其他 provider 或同名 profile session 混淆。

### 场景：SQLite/WAL 刷新只发现可见顶层项目会话

- **给定** 允许列表中的 Hermes home 包含 `state.db`，并且可能有多个 profile 使用同一个原始 session id
- **当** 后台 backfill 或 state.db/WAL/SHM watcher 刷新项目索引
- **则** 读取必须使用 SQLite 只读连接，不得迁移、checkpoint、改变 journal mode 或写入数据库
- **并且** 只显示属于项目的可见顶层逻辑会话；archive、delegate 和 compression ancestor 不得泄漏到普通卡片
- **且** 未归属会话只能进入只读未归属集合；单个不兼容 schema 或坏 profile 只产生诊断，不能阻塞其余 profile

### 场景：历史与 UI capability 维持只读边界

- **给定** 用户从 Hermes 卡片进入压缩会话的历史详情
- **当** 服务端读取 root 到 tip 的 active 消息，并把 reasoning、工具调用/结果和结构化正文归一化
- **则** 历史必须按稳定 message key 有序返回，且不得返回 system prompt、model config、api content 或本机媒体文件内容
- **并且** 前端必须把会话保存在 `hermesSessions` 独立 bucket；未知 provider 必须安全失败，不能降级为 Codex
- **且** Hermes capability 仅允许列表和历史读取；创建、发送、重命名、删除、实时订阅、状态查询与终端恢复均为 false
- **测试文件**：`tests/backend/hermes-session-read-model.test.ts`、`tests/specs/hermes-readonly-provider.spec.ts`

## 后续规格

- [Provider runtime live 事件渲染](./provider-runtime-events.md)
