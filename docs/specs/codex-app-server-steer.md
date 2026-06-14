# 规格：支持 Codex 手动会话 steer

### 需求：Codex 新会话思考深度选择器正确传递用户选择

#### 场景：用户在新 Codex 会话中切换思考深度并发送消息

- **给定** 用户打开一个全新的 Codex 手动会话草稿（`new-session-xxx` 或 `cN`，无历史消息）
- **当** 用户在思考深度下拉框中选择 "Low"（或其他非默认值）
- **且** 用户输入消息并发送
- **则** 发送的 `codex-command` WebSocket 消息的 `options.reasoningEffort` 字段必须为 `"low"`
- **且** Codex app-server 收到的 `turn/start` 请求中的 `effort` 参数应为 `"low"`
- **且** 发送后下拉框应保持显示 "Low"

#### 场景：用户刷新页面后思考深度选择保持一致

- **给定** 用户在上一次会话中将思考深度改为 "Low"
- **当** 用户刷新页面或打开新会话
- **则** 思考深度下拉框必须显示 "Low"（从 localStorage 恢复）
- **且** 不得被任何 effect 覆盖为 "High" 或其他值

#### 场景：model catalog 加载不覆盖用户手动选择的思考深度

- **给定** 用户已将思考深度设为 "Medium"
- **当** Codex model catalog 异步加载完成
- **则** 思考深度必须保持 "Medium"，不得被重置为 model 的 `defaultReasoningEffort`

### 需求：Codex running 输入必须 steer 到当前 active turn

Codex 手动会话运行中，用户继续输入补充要求时，系统必须将该输入通过 Codex app-server `turn/steer` 发送到当前 active turn，而不是排队等待当前 turn 完成。

#### 场景：运行中补充要求发送 turn/steer

- **给定** 用户打开 Codex 手动会话并发送第一条消息
- **且** 后端已收到 app-server `turn/started`，记录了 `threadId` 和 `activeTurnId`
- **当** 用户在第一轮仍运行时继续输入补充要求
- **则** 后端发送 app-server `turn/steer`
- **且** `turn/steer.params.threadId` 等于当前 provider thread id
- **且** `turn/steer.params.expectedTurnId` 等于当前 active turn id
- **且** 补充要求出现在 `turn/steer.params.input` 中
- **且** 后端不得把该补充要求放入 Codex queue

#### 场景：没有 active turn 时不得静默 queue

- **给定** Codex 会话状态显示 running
- **但** 后端没有可验证的 `activeTurnId`
- **当** 用户发送补充要求
- **则** 后端拒绝 steer 并广播用户可见错误
- **且** 前端将该条 optimistic user message 标记为 failed
- **且** 不得静默 queue 到下一轮

### 需求：Codex app-server 协议映射和失败恢复必须保持

Codex app-server runtime 必须把 provider notification 稳定映射为前端可消费的实时事件，并在 transport close/error 时显式标记 running session 失败，避免用户看到卡死的运行态。

#### 场景：notification delta 映射到前端实时消息

- **给定** app-server 推送 `item/agentMessage/delta` 或 `item/commandExecution/outputDelta`
- **当** 后端处理当前 Codex session 的 notification
- **则** 后端必须广播 `codex-response`
- **且** agent message delta 必须保留 `itemId`、`itemType=agent_message` 和增量文本
- **且** command execution output delta 必须保留 `itemId`、`itemType=command_execution` 和输出片段

#### 场景：transport close/error 标记运行会话失败

- **给定** Codex app-server transport 因 close 或 error 中断
- **且** 某个 session 仍处于 running
- **当** runtime 收到 transport failure
- **则** session manager 必须将该 running session 标记为 failed
- **且** 后端必须通过 writer 广播用户可见错误
- **且** 后续补充输入不得继续附着到已失败的 active turn

#### 场景：并发 session notification 只归属目标 thread

- **给定** 同一个 app-server runtime 中存在多个 Codex manual session
- **当** app-server 推送带 `threadId` 的 notification
- **则** runtime 只能更新匹配 `providerThreadId` 的 session
- **且** 不得把一个 thread 的 delta 或 completion 广播到另一个会话

对应规格测试：`tests/specs/codex-app-server-protocol-mapping.spec.ts`、`tests/specs/codex-app-server-steer-runtime.spec.ts`，并生成 `test-results/oz-113-codex-app-server-runtime/protocol.log`。

### 需求：会话私有 realtime 消息不得按同用户全量广播

Codex/Pi provider delta、session lifecycle、permission request 等会话私有事件必须按发起窗口 owner scope 或明确订阅的会话 scope 投递。同一用户打开多个窗口时，用户身份只能作为认证边界，不能作为会话私有消息的完整投递边界。

#### 场景：同一用户两个窗口在线，窗口 A 发起的 Codex delta 不进入窗口 B

- **给定** 同一用户在窗口 A 和窗口 B 同时保持 chat WebSocket 在线
- **且** 窗口 A 发送带 `sessionId/ozwSessionId/projectPath/provider/clientRequestId` 的 `codex-command`
- **当** 后端通过 runtime writer 收到窗口 A 对应会话的 `codex-delta`
- **则** 窗口 A 必须收到该 delta
- **且** 窗口 B 未订阅该会话时不得收到该会话私有消息
- **且** 公共项目刷新等非会话私有事件仍可按同用户广播

#### 场景：窗口 A 收到的 provider delta 带有完整归属字段

- **给定** 后端向窗口 A 投递 Codex provider delta
- **当** delta 来源于某个 CBW 会话和项目路径
- **则** 投递给前端的消息必须包含 `ozwSessionId`、`ozw_session_id`、`provider` 和 `projectPath`
- **且** 前端切换或打开会话时应声明 `subscribe-session`，用于接收已明确订阅的同会话消息

对应规格测试：`tests/specs/codex-ws-turn-ownership.spec.ts`，并生成 `test-results/115-websocket-window-ownership/runtime-delivery-log.json`。

### 需求：Codex steer 不得破坏消息一致性

运行中 app-server live event 只作为临时显示；完成后 JSONL/read model 是唯一权威历史。前端不得因为同时消费 live event 和 JSONL 而重复、丢失或错序显示消息。

#### 场景：完成后强刷前后消息一致

- **给定** Codex running turn 中发生了 steer
- **且** 前端已经显示 live assistant/tool 消息
- **当** app-server 通知 `turn/completed`
- **则** 前端执行 JSONL terminal reconcile
- **且** 未在 JSONL 中匹配到的 stale live 工具卡片被清除
- **且** 刷新页面后看到的用户消息、assistant 正文和工具卡片数量与刷新前一致

#### 场景：同一工具调用只显示一张卡片

- **给定** app-server live event 已显示一个工具调用
- **且** Codex JSONL 随后持久化同一工具调用和结果
- **当** 前端完成 terminal reconcile
- **则** 同一工具调用只显示一张工具卡片
- **且** 工具结果附着在同一卡片上

### 需求：Codex steer 不得造成明显性能退化

支持 steer 后，常规 live event 和 scoped session 更新不得触发项目全量刷新或高频 JSONL 全量解析。

#### 场景：app-server live event 不触发项目全量刷新

- **给定** Codex app-server 推送 `item/started`、`item/agentMessage/delta`、`item/completed`
- **当** 前端和后端处理这些 live event
- **则** 后端不得广播包含完整项目列表的 `projects_updated`
- **且** 前端不得调用 `/api/projects` 全量刷新
- **且** 当前会话消息只通过 live reducer 或 scoped session message reload 更新

#### 场景：JSONL 刷新保持增量读取

- **给定** 当前 Codex 会话已经加载了历史消息
- **当** `session_changed` 或 turn complete 触发消息刷新
- **则** 后端继续使用 tail window / `afterLine` 增量读取
- **且** 不得在每个 live event 上全量解析整个 JSONL

### 需求：运行中的 Codex 会话刷新后仍可停止

#### 场景：刷新运行中的 Codex 会话恢复停止按钮

- **Given** 用户打开一个仍在运行的 Codex 手动会话
- **And** 服务端对该会话的 `check-session-status` 返回 `isProcessing=true`
- **When** 用户刷新页面或重新打开该会话路由
- **Then** composer 必须显示停止按钮
- **And** 前端必须把该会话视为可中断状态

#### 场景：刷新后点击停止发送当前会话 abort

- **Given** 刷新后的 Codex 会话已经恢复停止按钮
- **When** 用户点击停止按钮
- **Then** 前端必须发送 `abort-session`
- **And** `abort-session.sessionId` 或 `abort-session.ozwSessionId` 必须指向当前 Codex 会话
- **And** `abort-session.provider` 必须是 `codex`

### 需求：Codex 文本流式输出按增量追加显示

#### 场景：同一 assistant 文本 delta 追加到同一条消息

- **Given** Codex 正在为当前会话流式输出 assistant 文本
- **When** 前端连续收到同一 `itemId` 的文本片段 `这是`、`一段`、`流式回答`
- **Then** 页面中途必须显示累积文本 `这是一段流式回答`
- **And** 后续片段不得抹除前面片段
- **And** 页面不得把每个片段渲染成多条 assistant 消息

#### 场景：完成事件后最终内容不重复

- **Given** Codex live 文本已经在页面显示
- **When** Codex 完成且 JSONL/read model 返回同一 assistant 正文
- **Then** 页面最终只显示一份 assistant 正文
- **And** 不得同时保留 live 副本和 persisted 副本

### 需求：Codex 协议 JSON 不进入聊天正文

#### 场景：未知或对象形态的 Codex payload 不直接渲染

- **Given** 前端收到包含协议对象的 `codex-response`
- **When** 该对象不是用户可读文本、工具卡片或 thinking 内容
- **Then** 页面不得显示原始 JSON
- **And** 页面不得显示 `itemId`、`delta`、`content_part` 等协议字段作为普通正文
- **And** 已有用户消息和已渲染 assistant 文本不得被清空

### 需求：Codex 文件操作 JSON 必须渲染为工具卡片

Codex live 和 JSONL replay 都可能把 `add`、`edit`、`write` 或 `update` 文件操作放在 assistant message 文本中。前端必须把这类带路径的文件操作 payload 归一成文件操作工具卡片，避免用户看到 provider raw JSON，同时不能误删普通业务 JSON。

#### 场景：live agent_message 承载文件操作 JSON

- **Given** 用户打开一个 Codex 手动会话
- **And** 页面已经显示真实 assistant 正文
- **When** 后端通过 WebSocket 推送 `codex-response`，其中 `data.type = "item"`、`itemType = "agent_message"`，`message.content` 是 `add`、`edit`、`write` 或 `update` 文件操作 JSON 字符串
- **Then** 每个文件路径必须出现在 `codex-tool-card` 卡片中
- **And** 聊天正文不得显示 raw JSON 字段名、`JSON Response` 或协议 envelope
- **And** 真实 assistant 正文仍保持可见

#### 场景：live file_change changes 数组承载文件操作

- **Given** Codex WebSocket 推送 `codex-response`
- **And** `data.type = "item"`、`data.itemType = "file_change"`
- **And** `data.changes` 包含 `{ "kind": "update", "path": "src/live-update.ts" }`
- **When** 用户查看运行中的聊天 transcript
- **Then** 页面必须显示 `FileChanges` 工具卡
- **And** 卡片中必须显示 `src/live-update.ts`
- **And** transcript 不得把 `changes`、`kind`、`path` 或 `diff` JSON 作为普通正文显示

#### 场景：分片文件操作 JSON 完整后替换旧正文

- **Given** Codex WebSocket 以同一个 `itemId` 分两次推送 `agent_message`
- **And** 第一片内容是未闭合 JSON：`{"type":"update",`
- **And** 第二片内容补全为：`"path":"src/split-update.ts"}`
- **When** 两片内容都到达
- **Then** 页面必须只显示 `FileChanges` 工具卡
- **And** 不得保留旧的 raw JSON 正文

#### 场景：JSONL 历史回放承载文件操作 JSON

- **Given** Codex JSONL 中的 `response_item.message.content.output_text` 保存了文件操作 JSON 字符串
- **When** 用户刷新或重新打开该会话
- **Then** 每个文件操作仍必须渲染为 `codex-tool-card`
- **And** live 阶段和 JSONL replay 阶段都不得回退成 raw JSON
- **And** 不得把文件写入内容直接作为普通 assistant 正文显示

#### 场景：普通业务 JSON 不得被误删

- **Given** 用户要求 Codex 输出普通 JSON 数据
- **When** JSON 缺少文件操作类型或缺少文件路径字段
- **Then** 前端仍应按普通 assistant 内容或现有 JSON renderer 展示
- **And** 不得转换为文件操作卡片

### 需求：Codex WS live 思考块首次显示即为思考样式

#### 场景：同 itemId 的普通正文不得被后续 reasoning 翻转为 thinking

- **Given** Codex WebSocket 对同一 `itemId` 先推送 `agent_message`
- **And** 随后推送 `reasoning`
- **When** reasoning 文本代表思考内容
- **Then** 用户不应先看到普通 assistant 正文再看到思考块样式跳变
- **And** 最终 transcript 中不得同时存在一份普通正文副本和一份思考块副本

#### 场景：reasoning 和 thinking 内容保持独立 message 类型

- **Given** Codex WebSocket 推送 `reasoning` 或 `thinking`
- **When** reducer 生成 ChatMessage
- **Then** 该消息必须带 `isThinking: true`
- **And** 不得带 `isToolUse: true`
- **And** 渲染层应走思考块分支

### 需求：Codex 续发运行时 transcript 必须顺序稳定且幂等

Codex 手动会话中，用户追加发送新消息并接收智能体响应时，前端必须把本地发送、WS accepted、WS live response、读模型刷新和完成刷新合并成一个稳定 transcript。重复的 WebSocket 事件（因重连、重放或后端冗余推送产生）不得在页面产生重复气泡或打乱已有顺序。

#### 场景：重复 accepted 不产生重复用户气泡

- **给定** 用户已打开一个 Codex 手动会话，第一轮用户和助手消息已经持久化
- **当** 用户在 composer 中发送第二轮追加请求
- **且** 后端或 WS 重连导致同一个 `clientRequestId` 的 `message-accepted` 到达两次
- **则** transcript 中第二轮用户气泡只展示一次
- **且** 该用户气泡保持在第二轮助手响应之前

#### 场景：重复 live assistant 推送不产生重复助手气泡

- **给定** 第二轮用户请求已经显示在 transcript 中
- **当** Codex 通过 WS 推送同一个 assistant live item 两次
- **则** transcript 中第二轮助手响应只展示一次
- **且** 第二轮可见顺序保持为 `第二轮用户 -> 第二轮助手`

#### 场景：读模型滞后刷新不打乱多轮续发顺序

- **给定** 用户已经连续发送第二轮和第三轮追加请求
- **且** 第二轮、第三轮的 live assistant 响应都已经显示
- **当** `projects_updated` 到达，但 `/messages` 读模型仍只返回第一轮持久化消息
- **则** transcript 仍保持 `第一轮用户 -> 第一轮助手 -> 第二轮用户 -> 第二轮助手 -> 第三轮用户 -> 第三轮助手`
- **且** 第二轮、第三轮用户气泡和助手气泡都不重复

#### 场景：部分持久化追上不留下 live/persisted 双份

- **给定** 第二轮已经写入 JSONL/read model，第三轮仍只有 live transcript
- **当** `projects_updated` 重复到达
- **则** 第二轮 persisted 用户和助手内容替换或合并原 live/optimistic 行
- **且** 第二轮用户、第二轮助手、第三轮用户、第三轮 live 助手都各只展示一次
- **且** 第三轮仍在第二轮之后，不被移动到 transcript 尾部错误位置

#### 场景：完成态刷新以后以 persisted transcript 收敛

- **给定** 第二轮和第三轮最终都已经进入 read model
- **当** `codex-complete` 到达并触发刷新，或者用户刷新浏览器页面
- **则** transcript 展示 persisted 的最终第二轮和第三轮内容
- **且** 不再显示同一轮的旧 live assistant 副本

### 需求：Codex 运行态刷新保持多轮请求与回复的相对顺序

#### 场景：用户连续追加请求且 provider transcript 滞后

- **Given** Codex 会话中第一轮 `用户1 -> 助手1` 已经进入 persisted read model
- **And** 用户在前端继续发送 `用户2`
- **And** Codex 已经通过 live 事件显示 `助手2` 的大量响应内容
- **And** 用户又继续发送 `用户3`
- **And** Codex 已经通过 live 事件显示 `助手3` 的响应内容
- **When** `projects_updated`、`content` 或其他实时事件触发 session messages reload
- **Then** 前端合并后的可见顺序必须保持为 `用户1、助手1、用户2、助手2、用户3、助手3`
- **And** 不得显示为 `用户1、助手1、用户2、用户3、助手2、助手3`

#### 场景：最新一轮回复尚未完成

- **Given** 最新 Codex turn 仍在 streaming
- **When** provider JSONL 尚未包含最新用户请求或 assistant/tool 内容
- **Then** 前端必须继续保留本地 optimistic 用户气泡和 live assistant/tool 消息
- **And** 这些本地消息必须保留上一帧 UI 中的相对顺序
- **And** 不得把所有未确认用户气泡统一追加到聊天底部

### 需求：Codex persisted echo 追上后不重复不重排

#### 场景：JSONL 只追上了部分追加轮次

- **Given** 第二轮用户请求和 assistant 回复已经进入 persisted read model
- **And** 第三轮仍只有本地 optimistic 用户气泡和 live assistant 回复
- **When** 刷新合并 persisted 和 previous messages
- **Then** 第二轮 optimistic 用户气泡应与 persisted echo 合并为一条
- **And** 第三轮本地消息仍应显示在第二轮之后
- **And** 页面不得出现重复的第二轮用户气泡或 live assistant 副本

#### 场景：最新回复完成后最终收敛

- **Given** Codex complete 后 provider JSONL 已包含全部多轮 transcript
- **When** 前端重新加载会话消息
- **Then** 最终 UI 应以 persisted read model 为准
- **And** 此前保留的 live assistant/tool 消息应被去重
- **And** 多轮用户请求之间的 assistant 内容仍保持可见

### 需求：Codex 第二轮 live 推送不得清空旧响应正文

#### 场景：发送第二轮后上一轮 assistant 正文持续可见

- **给定** 用户正在查看一个 Codex `cN` 手动会话
- **且** JSONL 中已经存在第一轮用户消息和第一轮 assistant 响应
- **当** 用户通过聊天输入框发送第二轮消息
- **且** 前端收到 Codex WebSocket live `agent_message`
- **则** 第一轮 assistant 响应正文必须仍显示在聊天区
- **且** 第二轮用户消息必须显示在第二轮 live assistant 正文上方
- **且** 页面不得等到 `codex-complete` 或 history reload 后才恢复第一轮正文

### 需求：Codex 完成重载后消息顺序必须符合对话因果

#### 场景：第二轮完成后用户消息不得显示在本轮响应下面

- **给定** 用户在同一个 Codex `cN` 手动会话发送第二轮消息
- **且** JSONL 在完成前已经落盘第二轮用户消息和第二轮 assistant 响应
- **当** 前端收到 `codex-complete` 并重新加载 session history
- **则** 聊天 DOM 顺序必须是第一轮用户、第一轮 assistant、第二轮用户、第二轮 assistant
- **且** 第二轮用户消息只能显示一次
- **且** 第二轮用户消息不得出现在第二轮 assistant 响应下面

### 需求：Codex 历史消息分页必须使用稳定 raw line 游标

#### 场景：向上加载更早历史不会重叠或跳过消息

- **给定** 一个 Codex rollout JSONL 会话包含多轮用户消息、assistant 文本、thinking、tool use 和 tool result
- **且** raw JSONL line 与 UI 消息不是一一对应关系
- **当** 用户打开该历史会话并向上滚动加载更早消息
- **则** 第二页请求必须使用后端返回的 raw line 游标
- **且** 第二页 raw line 范围不得与第一页重叠
- **且** 已加载消息合并后不得重复用户气泡、不得丢失对应 assistant/tool 上下文

### 需求：Codex read model 不得返回 provider 内部角色消息

#### 场景：rollout 文件包含 developer 和环境上下文

- **给定** Codex JSONL 中存在 `response_item.message role=developer`
- **且** 同一文件存在 `turn_context`、环境上下文或 provider 内部说明
- **当** 前端通过 `/api/projects/:projectName/sessions/:sessionId/messages?provider=codex` 加载历史消息
- **则** API 的 `messages` 数组不得包含 developer/system/bootstrap 内部消息
- **且** 内部消息不得影响可见分页 cursor

### 需求：打开 Codex 历史会话后用户气泡必须保持 turn 顺序

#### 场景：rollout 文件同时保存 response_item 用户 echo 和 event_msg 用户消息

- **给定** 同一用户输入在 JSONL 中同时出现 `response_item.message role=user` 和 `event_msg user_message`
- **当** 用户打开历史 Codex 会话并加载全部消息
- **则** 该用户输入只显示一次
- **且** 每个用户气泡必须出现在本 turn 的 assistant/tool 响应之前
- **且** 不得出现多个用户气泡集中显示在会话末尾的现象

### 需求：Codex 手动会话验收测试必须走真实用户入口

#### 场景：测试从真实页面和真实 composer 提交

- **给定** 测试准备了 Playwright 隔离 HOME 下的真实 Codex JSONL
- **当** 测试打开 fixture 项目的真实 `cN` 会话路由
- **则** 测试必须通过页面 textarea 和 submit button 发送第二轮消息
- **且** 必须断言 WebSocket 发出的 `codex-command` 带有当前 `cN` 会话身份
- **且** DOM 断言必须基于 `.chat-message` 的可见文本顺序，而不是只检查纯函数返回值

### 需求：Codex 聊天 Markdown 容错中文邻接代码块 fence

#### 场景：opening fence 前紧贴中文正文

- **给定** Codex assistant 回复包含 `下面是代码```ts\nconst value = 1;\n````
- **当** 用户在聊天区查看该回复
- **则** `const value = 1;` 必须显示在代码块中
- **且** `下面是代码` 必须显示为普通正文
- **且** ` ```ts` 不得作为裸文本显示

#### 场景：closing fence 后紧贴中文正文

- **给定** Codex assistant 回复包含 ` ```ts\nconst value = 1;\n```继续说明`
- **当** 用户在聊天区查看该回复
- **则** `const value = 1;` 必须显示在代码块中
- **且** `继续说明` 必须显示为代码块后的普通正文
- **且** closing fence 不得和后续中文混排显示

#### 场景：opening 和 closing fence 同时邻接中文

- **给定** Codex assistant 回复包含 `下面是代码```ts\nconst value = 1;\n```继续说明`
- **当** 前端渲染聊天 Markdown
- **则** 页面必须只有一个包含 `const value = 1;` 的代码块
- **且** 代码块前后中文仍保持可读顺序
- **且** 用户不得看到裸 ``` fence 标记

#### 场景：合法 Markdown 不被改写

- **给定** Codex assistant 回复已经包含标准 fenced code block
- **当** 前端执行聊天 Markdown 预处理
- **则** 预处理不得改变代码内容、语言名和前后换行结构
- **且** 单行 `这里是 ```pnpm test``` 命令` 必须继续按 inline code 处理，不得被误转成 block code
