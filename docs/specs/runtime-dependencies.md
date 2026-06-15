# 规格：Runtime 依赖诊断与手动会话运行

约束 oz/Codex/Pi runtime 诊断、事件驱动刷新、idle 续发、steer、停止和 Pi 控件状态。

## 测试入口

- `pnpm exec tsx --test tests/backend/runtime-dependencies.test.ts`
- `pnpm exec tsx --test tests/spec/runtime_readiness.ts`
- `pnpm exec tsx --test tests/backend/pi-cli-diagnostics.test.ts`

# 前端轮询优化：事件驱动刷新

### 需求：普通会话页不得常驻状态轮询

普通聊天会话打开并稳定后，前端不得每隔几秒发送业务状态检查。

#### 场景：普通会话 idle 期间不重复发送 check-session-status

- **给定** 用户已登录并打开一个已有项目会话
- **且** 初始会话消息和状态已经加载完成
- **当** 用户 8 秒内没有发送消息、切换页面或手动刷新
- **则** 浏览器不得继续周期性发送 `check-session-status`
- **且** 聊天输入框保持可用
- **且** 页面不得发生新的浏览器 navigation

#### 场景：WebSocket 重连后只做一次状态校准

- **给定** 用户正在查看会话 X
- **当** WebSocket 断开后重连
- **则** 前端可以对会话 X 发起一次状态校准
- **且** 不得因为重连启动新的常驻业务轮询

### 需求：workflow 详情刷新必须由事件驱动

workflow 状态变化应由后端 watcher 或用户动作触发刷新，不得由前端每秒主动拉取。

#### 场景：planning child session 等待不轮询 /api/projects

- **给定** 用户打开一个处于 planning 阶段、子会话尚未出现在本地 read model 的 workflow
- **当** 后端还没有发出相关 `workflow_changed` 或 `session_changed`
- **则** 前端不得每 1 秒请求 `/api/projects`
- **且** UI 可以显示等待状态
- **且** 收到相关事件后再刷新当前 workflow 或项目摘要

#### 场景：Go runner 运行中不每秒拉 workflow 详情

- **给定** 用户打开 Go runner 运行中的 workflow 详情
- **当** run state/log 没有新事件
- **则** 前端不得每 1 秒请求 workflow 详情接口
- **且** 收到 `workflow_changed` 后只刷新当前 workflow

### 需求：项目列表刷新不得被会话追加无条件触发

provider transcript 追加是会话级变化，不应让所有在线页面重新加载项目列表。

#### 场景：非当前会话追加不触发当前页面全量项目刷新

- **给定** 用户正在查看项目 A 的会话 X
- **当** 项目 A 或项目 B 的会话 Y 追加新 transcript
- **则** 后端应发送会话级 scoped event
- **且** 当前页面不得无条件请求 `/api/projects`
- **且** 当前聊天内容、滚动位置和输入框状态不得被打断

#### 场景：项目结构变化仍可刷新项目列表

- **给定** 用户新增、删除、重命名项目或修改项目级配置
- **当** 后端广播项目列表失效事件
- **则** 前端可以刷新项目列表
- **且** 该刷新必须是低频结构变化路径，不得复用为 transcript 追加路径

### 需求：保留有限兜底但禁止无限业务 interval

事件驱动实现可以有恢复机制，但恢复机制必须有明确终止条件。

#### 场景：事件丢失时有限重试

- **给定** 用户刚创建 workflow 或刚提交会话消息
- **当** 预期事件短时间内未到达
- **则** 前端最多执行有限次数的状态校准
- **且** 每次校准必须绑定当前 session/workflow
- **且** 达到上限、命中目标或页面离开后必须停止

---

## 需求：Codex 和 Pi idle 会话必须支持连续续发

已有手动会话完成第一轮后，用户继续发送第二条或后续消息，应复用同一个 `cN` conversation，并能看到新的响应。

### 场景：Codex idle 后第二条消息响应可见

- **给定** 用户已打开 Codex 手动会话 `cN`
- **且** 第一轮消息已经完成，co conversation 处于 idle/completed 状态
- **当** 用户在同一会话发送第二条消息
- **则** ozw 写入的 co request 必须使用 `provider=codex`
- **且** `conversation_id` 必须仍是同一个 `cN`
- **且** `active_policy` 必须是 `queue`
- **且** co 创建第二个 turn 后，页面必须显示第二条 assistant 响应
- **且** 不得重复回放第一轮 assistant 响应

### 场景：Pi idle 后第二条消息响应可见

- **给定** 用户已打开 Pi 手动会话 `cN`
- **且** 第一轮消息已经完成，co conversation 处于 idle/completed 状态
- **当** 用户在同一会话发送第二条消息
- **则** ozw 写入的 co request 必须使用 `provider=pi`
- **且** `conversation_id` 必须仍是同一个 `cN`
- **且** `active_policy` 必须是 `queue`
- **且** co 创建第二个 turn 后，页面必须显示第二条 assistant 响应

## 需求：运行中的 Codex 和 Pi 会话必须支持 steer

会话运行中，用户继续输入消息应被视为对当前 active turn 的 steer，而不是静默失败或无限排队。

### 场景：Codex running 时输入消息写入 steer request

- **给定** Codex 会话 `cN` 正在运行
- **且** 前端已收到 `session-status`，其中 `turn_id=turn_active`
- **当** 用户继续输入并发送一条 steer 消息
- **则** ozw 写入的 co request 必须使用 `provider=codex`
- **且** `conversation_id=cN`
- **且** `active_policy=steer`
- **且** `target_turn_id=turn_active`
- **且** co 对 active turn 追加响应后，页面必须给出可见结果

### 场景：Pi running 时输入消息写入 steer request

- **给定** Pi 会话 `cN` 正在运行
- **且** 前端已收到 `session-status`，其中 `turn_id=turn_active`
- **当** 用户继续输入并发送一条 steer 消息
- **则** ozw 写入的 co request 必须使用 `provider=pi`
- **且** `conversation_id=cN`
- **且** `active_policy=steer`
- **且** `target_turn_id=turn_active`
- **且** co 对 active turn 追加响应后，页面必须给出可见结果

### 场景：steer 被 co 拒绝时用户看到反馈

- **给定** 用户在 running 会话中发送 steer 消息
- **当** co 返回 `steer-rejected` 或 `message-rejected`
- **则** 前端必须清理该消息的 pending 状态
- **且** 页面必须显示可见错误或系统提示
- **且** 输入框不得永久卡在提交中

## 需求：多轮 transcript 必须可刷新恢复

多轮消息完成后，页面刷新或重新进入会话时，应从 durable read model 恢复完整消息，而不是依赖临时 realtime 状态。

### 场景：刷新后两轮消息仍完整可见

- **给定** 用户在同一 Codex 或 Pi 会话中完成两轮消息
- **当** 用户刷新页面或重新打开会话
- **则** 第一轮和第二轮 user 消息都必须可见
- **且** 第一轮和第二轮 assistant 响应都必须可见
- **且** 不得出现重复 assistant 响应

## 需求：跨 provider 不得串线

Codex 和 Pi 都使用 co conversation read model，但 provider 身份必须严格隔离。

### 场景：Pi provider session id 不得读到 Codex conversation

- **给定** co home 中同时存在 Codex 和 Pi conversation
- **且** 两者可能有相似的 provider session id 或 route index
- **当** 前端请求 Pi 会话消息
- **则** 服务端只允许返回 provider 为 Pi 的 conversation 消息
- **且** 不得把 Codex 的 response 混入 Pi transcript

---

## 需求：Pi 流式输出应聚合为可读消息

ozw 必须把 Pi 的底层 delta 事件转换成用户可读的 assistant 消息。

### 场景：同一 response 的 delta 不得逐条显示

- **给定** co `events.jsonl` 中同一 Pi turn 写入多个 `pi-response` `text_delta`
- **当** 前端加载该会话的 session messages
- **则** 页面应显示一条连续 assistant 消息
- **并且** 不得把 `"Let"`、`" me"`、`" first"` 这类 delta 片段显示成多条消息

### 场景：同一 turn 内后续 response 保持顺序

- **给定** 一个 Pi turn 内先后出现两个 response id
- **当** read model 转换该 turn
- **则** transcript 顺序应是 user、第一条 assistant、第二条 assistant
- **并且** 每条 assistant 都是聚合后的完整文本

## 需求：Pi 运行态应从 co 可证明状态恢复

ozw 必须避免把 Pi 的中间 step complete 当作整轮结束，也必须避免 stale `active_turn_id` 永久卡住会话。

### 场景：`pi-complete` 后还有后续输出

- **给定** `events.jsonl` 中 `pi-complete` 后仍有同一 turn 的 `pi-response`
- **当** WebSocket 或 session status 恢复运行态
- **则** ozw 不得因为较早的 `pi-complete` 过早清空停止能力
- **并且** 后续输出仍应进入同一个会话 transcript

### 场景：state 仍 running 但事件已经 terminal

- **给定** co conversation state 仍有 `active_turn_id`
- **且** 对应 turn 事件已经能证明该 turn 不再接受输出
- **当** 用户追加第二条消息
- **则** ozw 应按 idle follow-up 发送 queue，或给出可见状态修复/等待提示
- **并且** 不得静默吞掉用户消息

## 需求：Pi 手动会话路由保持稳定

用户在 ozw 里看到和打开的会话 id 必须是稳定 `cN` 路由。

### 场景：provider session id 绑定后不生成重复入口

- **给定** 用户创建 `cN` Pi 手动会话
- **且** co 返回 Pi provider session id
- **当** 项目列表加载 Pi sessions
- **则** 列表中该会话只有一个入口
- **并且** 入口 id 仍是 `cN`
- **并且** provider session id 仅作为关联字段保存

### 场景：已有真实会话和过期 counter 时新建会话分配未占用 route

- **给定** 项目配置中已经存在 `chat.1` 和 `chat.2` 两条绑定真实 provider session 的手动会话
- **且** `manualSessionRouteCounter` 因历史数据或迁移残留停留在过期值
- **当** 用户继续新建两条手动会话 draft
- **则** ozw 必须从已有 chat route、manual draft 和 counter 的最大编号之后继续分配 `cN`
- **并且** 不得复用已经存在的 `c1` 或 `c2`
- **并且** `manualSessionRouteCounter` 必须推进到最新已分配 route index

### 场景：draft finalize 前不把 cN 当作真实 provider session

- **给定** 用户新建的手动会话 draft route 是 `cN`
- **当** provider 启动前读取该 route 的 runtime 上下文
- **则** `providerSessionId` 必须为空，表示应启动真正的新 provider 会话
- **当** provider 返回真实 session id 并 finalize 该 route
- **则** `chat.N.sessionId` 必须绑定真实 provider session id
- **并且** 后续读取同一 `cN` route 时必须恢复到该真实 provider session

---

## 需求：长会话首屏必须优先加载尾部最新消息

### 场景：打开 co 长会话默认显示最新消息

- **给定** 一个 co conversation 包含大量历史 turn
- **当** 浏览器请求当前会话消息并携带 `limit`
- **则** 后端必须返回最新尾部窗口
- **且** 返回消息在窗口内保持时间正序
- **且** 不得返回最早的历史消息作为首屏内容

### 场景：上滑加载更早历史按尾部 offset 翻页

- **给定** 用户已经看到最新尾部窗口
- **当** 用户向上加载更早消息
- **则** `offset` 必须表示跳过多少条最新消息
- **且** 后端返回尾部窗口之前的更早消息
- **且** 不得重复返回当前尾部窗口

## 需求：当前会话实时刷新必须能补到新增和更新消息

### 场景：provider 追加新消息后页面自动更新

- **给定** 用户正在查看会话 X
- **当** watcher 收到会话 X 的 provider transcript 或 co turn 事件变化
- **则** 后端发送 scoped `session_changed`
- **且** 前端只刷新会话 X 的消息接口
- **且** 页面显示新增消息，不需要强刷网页

### 场景：同一 assistant 消息内容增长也必须刷新

- **给定** Pi/co 把多段 delta 聚合成同一条 assistant 消息
- **当** 该 assistant 消息内容从短文本增长为更完整文本
- **且** 聚合后的消息数量没有增加
- **则** 增量刷新仍必须返回变更后的尾部消息
- **且** 前端替换或合并当前消息内容

## 需求：消息刷新不得退回全量项目刷新或高频轮询

### 场景：非当前会话变化不打断当前聊天

- **给定** 用户正在查看项目 A 的会话 X
- **当** 项目 A 或项目 B 的会话 Y 追加消息
- **则** 当前聊天页不得请求 `/api/projects`
- **且** 当前 transcript、滚动位置和输入框状态不得被清空

### 场景：自动刷新使用事件驱动而不是固定 interval

- **给定** 普通会话页已经完成初始加载
- **当** 用户没有发送消息也没有切换页面
- **则** 前端不得周期性发送业务状态检查或消息刷新请求
- **且** WebSocket 心跳仍可保留为连接健康检查

---

### 需求：Pi 前端必须支持模型选择

#### 场景：Pi provider 激活时展示模型控件

- 假设用户在聊天界面选择 Pi provider
- 当 composer 渲染完成
- 那么用户应看到 Pi 模型控制入口
- 并且该入口展示当前 Pi 模型摘要

#### 场景：用户切换 Pi 模型

- 假设用户打开 Pi 模型控制入口
- 当用户选择另一个 Pi 可用模型
- 那么前端应更新当前 Pi 模型状态
- 并且将会话级 model-state 持久化为新模型
- 并且下一次 Pi 发送应携带该模型

### 需求：Pi 前端必须支持思考深度选择

#### 场景：Pi reasoning 模型展示可用思考深度

- 假设 Pi 模型目录中某模型支持 reasoning
- 当用户选择该模型
- 那么思考深度下拉应展示该模型支持的 levels
- 并且不展示 `thinkingLevelMap` 中标记为 `null` 的 level

#### 场景：Pi 非 reasoning 模型只允许关闭思考

- 假设 Pi 模型目录中某模型 `reasoning=false`
- 当用户选择该模型
- 那么思考深度只能选择 `off`

#### 场景：用户切换 Pi 思考深度

- 假设用户正在 Pi 会话中
- 当用户选择 `high` 思考深度
- 那么前端应更新 `piThinkingLevel`
- 并且会话 model-state 应保存 `thinkingLevel=high`
- 并且下一次 Pi 发送应携带 `thinkingLevel=high`

### 需求：Pi 发送链路必须传递模型和思考深度

#### 场景：发送 Pi 普通消息

- 假设 active provider 是 Pi
- 且当前模型为 `anthropic/claude-sonnet-4-5`
- 且当前思考深度为 `high`
- 当用户发送消息
- 那么 websocket `pi-command` 的 options 必须包含 `model` 和 `thinkingLevel`
- 并且不得使用 Codex-only 字段 `reasoningEffort` 表达 Pi 思考深度

#### 场景：服务端接收 Pi 消息

- 假设服务端收到带 `model` 和 `thinkingLevel` 的 `pi-command`
- 当调用 native runtime
- 那么 `sendNativeMessage({ provider: 'pi' })` 必须收到相同的 `model` 和 `thinkingLevel`

### 需求：Pi runtime 必须应用模型和思考深度

#### 场景：新建 Pi 会话

- 假设当前没有 Pi AgentSession
- 当用户发送带 `model` 和 `thinkingLevel` 的 Pi 消息
- 那么 runtime 应使用对应模型和思考深度创建 `createAgentSession()`

#### 场景：复用 idle Pi 会话

- 假设当前 Pi AgentSession 已存在且没有 streaming
- 当用户切换模型或思考深度后发送消息
- 那么 runtime 应在 prompt 前调用 `setModel()` 或 `setThinkingLevel()` 应用变更

#### 场景：Pi 会话运行中继续输入

- 假设当前 Pi AgentSession 正在 streaming
- 当用户发送运行中输入
- 那么 runtime 应通过 Pi 原生 `streamingBehavior='steer'` 或 `streamingBehavior='followUp'` 入队
- 并且不强制切换当前 turn 的模型或思考深度

### 需求：Pi steer/follow-up 队列状态必须对前端可见

#### 场景：Pi queue_update 转发到前端

- 假设 Pi SDK 发出 `queue_update`
- 当 runtime 收到事件
- 那么服务端应发送前端事件 `session-queue-state`
- 并且包含 `steering` 和 `followUp` 队列数组

#### 场景：用户看到运行中输入语义

- 假设 Pi 会话正在运行
- 当用户准备继续输入
- 那么 UI 应能表达本次输入将 steer 当前 turn 或作为 follow-up later

### 需求：会话 model-state 必须支持 Pi thinkingLevel

#### 场景：保存 Pi thinkingLevel

- 假设用户在 Pi 会话中选择 `xhigh`
- 当前端调用 model-state 保存接口
- 那么项目配置应记录 `thinkingLevel=xhigh`

#### 场景：重新打开 Pi 会话

- 假设项目配置中已有 `thinkingLevel=medium`
- 当用户重新打开该 Pi 会话
- 那么前端应恢复 `piThinkingLevel=medium`

#### 场景：Codex 不受影响

- 假设 Codex 会话仍使用 `reasoningEffort`
- 当保存或读取 Pi `thinkingLevel`
- 那么 Codex 的 `reasoningEffort` 行为不得改变
