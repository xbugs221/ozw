# 规格：Workflow 状态读取与阶段兼容

约束 oz flow、v1.2.0 七阶段、批量列表、子会话和 active changes 读取。

## 测试入口

- `pnpm exec tsx --test tests/backend/wo-workflow-contract.test.ts`
- `pnpm exec tsx --test tests/specs/workflow-boundary.spec.ts`
- `pnpm exec tsx --test tests/e2e/workflow-status-watch-dag-detail.spec.ts`

## 需求：前端不得复制 co/oz flow 生命周期状态机

ozw 前端应只发送用户意图、展示本地 pending 反馈、读取 co/oz flow 权威状态并渲染结果，不得用本地 Set 或 realtime payload 作为 provider/workflow 生命周期事实源。

### 场景：发送消息后不直接宣告 provider session running

- **当** 用户在 Codex 或 Pi 会话中发送消息
- **则** 前端可以显示本地 pending 用户消息和防重复提交状态
- **且** 不得仅因为点击发送就把具体 provider session 记为权威 running
- **并且** 是否显示可中断运行态必须等待 co 返回 `session-status`、`active_turn_id` 或等价 read model

### 场景：路由刷新后运行态从 co 恢复

- **当** 用户刷新或重新打开一个仍有 `active_turn_id` 的会话
- **则** 前端应通过 `check-session-status` 或项目 read model 恢复运行态
- **且** 发送按钮应显示停止按钮
- **并且** 不得依赖刷新前遗留的前端 `processingSessions`

### 场景：workflow 阶段状态来自 oz flow

- **当** 用户打开 workflow 详情或 workflow 子会话
- **则** stage、run status、当前轮次和中断状态来自 oz flow read model
- **且** chat 的 provider turn 状态只用于该子会话输入区是否可停止
- **并且** chat 本地状态不得覆盖 oz flow 展示的 stage 事实

## 需求：三 provider 的推送内容不得直接成为最终消息渲染事实

Codex、Pi 的 WebSocket 内容事件应只触发 ack、状态更新或 read model 刷新。最终 assistant 正文、reasoning、工具卡片和文件变更必须来自持久化会话消息 read model。

### 场景：运行中 provider 内容事件不直接插入 transcript

- **当** Codex 或 Pi 在运行中推送 assistant content item
- **则** 前端不得把该 payload 直接追加为最终 assistant 消息
- **且** 可触发对应会话消息 read model 的刷新
- **并且** 页面中不得出现只存在于 realtime payload、尚未落盘的 assistant 正文

### 场景：持久化 read model 更新后按权威顺序显示

- **当** provider 的持久化会话消息新增用户消息、assistant 正文、reasoning 或工具结果
- **且** 前端收到刷新事件或完成事件
- **则** 页面应按 read model 顺序渲染消息
- **并且** 工具卡片结构、折叠状态和正文顺序与刷新浏览器后的结果一致

### 场景：重复推送不会重复渲染

- **当** 同一 provider 会话连续收到重复 `projects_updated`、content event 或 complete event
- **则** 同一条 assistant 正文、用户消息和工具卡片最多显示一次
- **并且** 用户滚动位置和已加载历史窗口不应被重复推送打乱

## 需求：运行中 UI 只保留停止按钮表达

底部运行状态条应删除，避免与发送按钮状态重复。

### 场景：发送按钮变为停止按钮

- **当** 当前会话处于本地 dispatching 或 co running 状态
- **则** composer action button 应从发送变为停止
- **且** 用户能通过该按钮请求中断当前 turn
- **并且** 没有 co active turn 时不得向错误 turn 发送 abort

### 场景：底部状态条不再出现

- **当** 当前会话正在运行
- **则** 输入框上方或底部不得显示旧的 `ProcessingStatus` 条
- **且** 页面不得显示 fake tokens、运行秒数、`esc to stop` 等旧状态条内容
- **并且** 断线提示、附件、模型选择和 follow latest 控件保持可用

## 需求：错误和超时只作为 UI 反馈，不改写权威生命周期

网络超时、provider 错误和 abort 失败应反馈给用户，但不得让前端永久持有与 co/oz flow 不一致的运行态。

### 场景：网络超时后可恢复

- **当** 发送后服务端长时间没有任何 ack 或 status
- **则** 前端可以显示网络异常错误
- **且** 应清理本地 pending dispatch 状态
- **并且** 后续收到 co status 或 oz flow read model 更新时，应以 co/oz flow 权威状态恢复页面

### 场景：provider 错误后状态收敛

- **当** Codex 或 Pi 返回 error/failed/aborted
- **则** 前端应显示错误或中断反馈
- **且** 停止按钮应按 co 返回状态消失
- **并且** 不得保留本地 processing 残留导致刷新后继续显示运行中

---

## 需求：oz flow 批量列表必须显示 changes 中的全部提案

ozw workflow read model 和前端分组必须以 oz flow batch `changes` 为批量条目的顺序主来源。已启动提案保留真实 run 详情，未启动提案显示为 pending 占位，不得伪造 runId 或详情路由。

### 场景：批量追加后存在未启动提案

- **给定** oz flow batch `state.json` 中 `changes` 为 `['change-a', 'change-b', 'change-c']`
- **且** `run_ids` 只包含 `change-a` 和 `change-b`
- **当** ozw 构建 batch read model
- **则** batch 的总数必须为 3
- **且** batch 条目必须按 `changes` 顺序包含 `change-a`、`change-b`、`change-c`
- **且** `change-c` 必须显示为待启动状态
- **且** `change-c` 不得伪造 runId 或可点击详情路由

### 场景：前端渲染批量列表

- **给定** 项目 read model 中有一个 total 为 3 的 batch
- **且** 其中只有前 2 个提案存在真实 workflow
- **当** 用户展开批量工作流列表
- **则** 列表必须显示 3 个提案卡片
- **且** 前 2 个卡片保留真实阶段进度
- **且** 第 3 个卡片显示待启动
- **且** 批量头部进度仍显示 `2/3`

## 需求：工作流展示不再区分单次任务 tab

工作流列表应统一按批量任务语义展示。没有 batch state 的单个 workflow 也作为一项批量任务展示，避免出现与 oz flow 批量模型不一致的“单次任务”分类。

### 场景：只有 1 个提案的工作流

- **给定** 项目中只有一个未归入 batch state 的 oz flow run
- **当** ozw 构建 workflow 分组
- **则** 该分组也必须按批量任务展示
- **且** 进度必须显示为 `0/1` 或 `1/1`
- **且** 界面不得出现“单次任务”文案

### 场景：历史批量 run 仍可打开详情

- **给定** 批量条目有真实 runId
- **当** 用户点击该提案卡片
- **则** 仍打开原有 workflow 详情页
- **且** 详情页中的批量标记、阶段、子会话和产物读取保持不变

---

## 需求：规划会话必须按 oz flow planner 角色读取

ozw 必须把 `oz flow` 当前契约中的 planner role 作为规划会话主来源，不得只读取 planning key。

### 场景：读取 codex planner 规划会话

- **给定** `oz flow state.json` 中存在 `sessions["codex:planner"] = "planner-thread-1"`
- **当** 用户打开 workflow 详情页
- **则** 规划行显示可进入的"会话"
- **且** 点击后进入该 run 的 planning child session route
- **并且** read model 中规划 sessionRef 的 `sessionId` 是 `planner-thread-1`

### 场景：读取非 Codex planner 规划会话

- **给定** planning 阶段配置的 tool 是 `pi`
- **且** `oz flow state.json` 中存在 `sessions["pi:planner"] = "pi-planner-1"`
- **当** ozw 构造 workflow read model
- **则** 规划行 sessionRef 的 provider 是 `pi`
- **且** session id 是 `pi-planner-1`
- **并且** 不得错误回退为 Codex provider

### 场景：兼容历史 planning key

- **给定** 旧运行态中只存在 `sessions["codex:planning"] = "legacy-planning-thread"`
- **当** 用户打开 workflow 详情页
- **则** ozw 仍能显示规划会话入口
- **但** 新增测试和 fixture 的主路径必须使用 `codex:planner`

### 场景：规划会话缺失

- **给定** `oz flow state.json` 中没有 planner/planning 会话 id
- **当** 用户打开 workflow 详情页
- **则** 规划行显示 `未知`
- **且** 不得用 run id、stage key 或 log 文件名伪造会话 id

## 需求：runnerProcesses 只能表达真实进程事实

ozw 不得从 `state.sessions` 或 stage 状态合成 runner process rows。没有真实 process 数据时，进程区必须隐藏。

### 场景：sessions-only 状态不显示进程区

- **给定** `oz flow state.json` 中存在 `sessions["codex:planner"]` 和 `sessions["codex:executor"]`
- **且** `state.processes` 不存在或为空
- **当** 用户打开 workflow 详情页
- **则** 角色摘要仍显示对应会话入口
- **但** 页面不显示 `workflow-runner-processes` 进程区
- **并且** read model 的 `runnerProcesses` 为空数组

### 场景：真实 processes 保留 pid

- **给定** `oz flow state.json` 中存在 `processes` 数组含 pid 和 session_id
- **当** ozw 构造 workflow read model
- **则** `runnerProcesses[0].pid` 是真实 pid
- **且** `runnerProcesses[0].sessionId` 是真实 session_id
- **并且** 前端展示时不得把 session_id 当作 pid

### 场景：process 没有 pid 不得伪造

- **给定** `state.processes[0].session_id = "reviewer-thread-1"`
- **且** 该 process 没有 `pid`
- **当** 用户查看进程区
- **则** 页面可以显示 `thread=reviewer-thread-1`
- **但** 不得显示 `pid=reviewer-thread-1`
- **并且** 不得把 session id 称为进程编号

## 需求：会话编号和进程编号在 UI 上语义分离

workflow UI 必须让用户能区分 provider 会话编号和系统进程编号。

### 场景：角色行展示会话编号入口

- **当** workflow 角色摘要展示 `规`、`写`、`审`、`修` 或 `存` 的会话入口
- **则** 这些入口表示 provider session id
- **且** 点击进入对应 workflow child session
- **并且** 不得暗示它是 pid

### 场景：进程行展示 process metadata

- **当** workflow 详情页展示真实进程行
- **则** pid 只来自 `process.pid`
- **且** thread/session 只来自 `process.sessionId`
- **并且** 二者应分开渲染或分开命名

## 需求：测试 fixture 必须贴近真实 oz flow 契约

ozw 的 workflow 测试数据必须使用当前 `oz flow` 的 role key，避免测试通过但真实运行态失败。

### 场景：fixture 使用 codex:planner

- **当** Playwright fixture 或 server read model 测试需要构造规划会话
- **则** 主路径必须写入 `sessions["codex:planner"]`
- **且** 不得只写 `sessions["codex:planning"]`

### 场景：旧 fixture 预期被更新

- **当** 测试断言 workflow runner process 区
- **则** 只有 fixture 显式提供 `processes` 时才断言进程区存在
- **并且** sessions-only fixture 应断言进程区不存在

---

## 需求：ozw 必须正确读取 oz flow v1.2.0 七阶段状态

ozw 必须把 `planning`、`acceptance`、`execution`、`review/fix`、`qa`、`archive` 作为 oz flow v1.2.0 主路径读取，同时保留旧阶段兼容。

### 场景：读取完整七阶段 run

- **给定** oz flow sealed `state.json` 包含 `planning`、`acceptance`、`execution`、`review_1`、`fix_1`、`review_2`、`qa`、`archive`
- **当** ozw 调用 `listWorkflowReadModels()`
- **则** `stageStatuses` 必须按七阶段业务顺序返回
- **且** `acceptance` 的 label 必须表达验收计划
- **并且** `qa` 的 label 必须表达 QA 验收
- **并且** diagnostics 不得报告 `acceptance` 或 `qa` 是未知阶段

### 场景：缺少 workflow_display 时生成 fallback 展示行

- **给定** oz flow `state.json` 没有 `workflow_display.lines`
- **当** ozw 构建 `workflowDisplay.lines`
- **则** fallback 必须包含 `planning`、`acceptance`、`start`、`review`、`1 fix review`、`qa`、`archive`
- **并且** review/fix 循环继续保持现有折叠规则

## 需求：acceptance 和 qa 子会话必须可路由

### 场景：sessions 中存在 acceptance 和 qa 阶段会话

- **给定** `state.sessions` 包含 `codex:acceptance` 和 `codex:qa`
- **当** ozw 构建 `childSessions`
- **则** acceptance 会话必须挂到 `stageKey=acceptance`
- **且** routePath 必须为 `/runs/<runId>/sessions/acceptance`
- **并且** qa 会话必须挂到 `stageKey=qa`
- **并且** routePath 必须为 `/runs/<runId>/sessions/qa`

### 场景：workflow 详情页打开新阶段会话

- **给定** 用户在 workflow 详情页看到 acceptance 或 qa 阶段
- **当** 用户点击该阶段的会话入口
- **则** 页面必须进入对应已有工作流子会话
- **并且** 不得新建普通聊天会话

## 需求：v1.2.0 阶段产物必须挂到正确阶段

### 场景：acceptance summary 存在

- **给定** `state.paths.acceptance_summary` 指向一个存在的 Markdown 文件
- **当** ozw 构建 workflow artifacts
- **则** 该产物必须挂到 `stage=acceptance`
- **并且** workflow detail 中 acceptance 阶段必须能看到该文件

### 场景：QA artifact 存在

- **给定** `state.paths.qa` 或等价 QA path 指向一个存在的 JSON/Markdown 文件
- **当** ozw 构建 workflow artifacts
- **则** 该产物必须挂到 `stage=qa`
- **并且** workflow detail 中 qa 阶段必须能看到该文件

### 场景：产物路径不存在

- **给定** v1.2.0 path key 指向不存在的文件
- **当** ozw 读取 workflow
- **则** workflow 列表仍必须正常返回
- **并且** diagnostics 必须包含可复核的缺失路径 warning

## 需求：前端阶段进度必须展示七阶段主路径

### 场景：workflow card 展示七阶段进度

- **给定** workflow 的 `stageStatuses` 包含 acceptance 和 qa
- **当** 用户查看 sidebar 或 project overview workflow card
- **则** 阶段进度必须包含 acceptance 和 qa 的稳定视觉节点
- **并且** review/fix 多轮仍折叠显示计数

### 场景：旧 run 兼容读取

- **给定** 旧 run 仍使用 `verification` 或 `ready_for_acceptance`
- **当** ozw 读取该 run
- **则** 旧 run 不应导致读取失败
- **但** 新建和新测试主路径不得继续依赖这些旧阶段

---

## 需求：provider-aware oz flow sessions 必须生成 workflow child sessions

ozw 必须把 `oz flow state.sessions` 中的 provider role map 当作 workflow child session 来源，而不是只依赖 runner process rows。

### 场景：Pi executor sessions-only 状态可进入子会话

- **给定** `oz flow state.json` 中存在 `sessions["pi:executor"] = "pi-thread-1"`
- **且** `state.processes` 不存在或为空
- **当** ozw 构造 workflow read model
- **则** `childSessions` 包含 id 为 `pi-thread-1` 的子会话
- **且** 该子会话的 provider 是 `pi`
- **并且** 该子会话的 stageKey 是 `execution`

### 场景：sessions-only 状态不伪造进程

- **给定** `oz flow state.json` 只有 `sessions["pi:executor"]`
- **且** 没有真实 `processes`
- **当** ozw 构造 workflow read model
- **则** `runnerProcesses` 是空数组
- **但** workflow role summary 和 stage inspection 仍显示可进入的 Pi 会话

### 场景：explicit process 与 role session 去重

- **给定** `state.processes[0].session_id = "pi-thread-1"`
- **且** `sessions["pi:executor"] = "pi-thread-1"`
- **当** ozw 构造 child sessions
- **则** `pi-thread-1` 只出现一次
- **且** process pid 保留在 `runnerProcesses`
- **并且** child session 的 provider 仍是 `pi`

### 场景：非 Pi provider role map 同样可路由

- **给定** `sessions["pi:executor"] = "pi-thread-1"` 或 `sessions["codex:reviewer"] = "codex-thread-1"`
- **当** ozw 构造 workflow read model
- **则** 对应 child session 使用各自 provider
- **并且** 不得统一回退为 Codex

## 需求：Pi workflow child session 必须按 provider 加载消息

Pi workflow 子会话打开后，聊天页必须保留 workflow 和 provider 上下文，并从 co read model 读取消息。

### 场景：点击 Pi role row 进入 workflow child route

- **当** 用户在 workflow 详情页点击 `pi:executor` 对应的"会话"
- **则** 浏览器进入 `/runs/<runId>/sessions/<address>` 或 `/runs/<runId>/sessions/by-id/<sessionId>`
- **且** selected session 的 `workflowId` 是当前 run
- **并且** selected session 的 `__provider` 是 `pi`

### 场景：Pi child session 请求消息时携带 provider

- **给定** 当前 selected session provider 是 `pi`
- **当** 聊天页加载该 session 消息
- **则** 请求 `/api/projects/:projectName/sessions/:sessionId/messages` 时带有 `provider=pi`
- **且** 服务端不得尝试读取 Codex JSONL 作为 fallback

### 场景：co conversation 存在时返回 Pi 消息

- **给定** co conversation state 中 `provider = "pi"`
- **且** `provider_session_id = "pi-thread-1"`
- **并且** turns/events 中存在用户消息和 assistant 文本事件
- **当** 前端加载 `pi-thread-1` 的消息
- **则** 页面展示 co durable history 中的用户消息和 assistant 消息
- **并且** 消息 provider 标记为 `pi`

### 场景：co conversation 缺失时不跨 provider fallback

- **给定** oz flow state 记录了 `sessions["pi:executor"] = "pi-thread-missing"`
- **但** co 没有对应 conversation
- **当** 前端加载该 child session
- **则** 消息区可以为空或显示明确错误反馈
- **且** 不得显示同名 Codex/Pi 会话内容

## 需求：active oz changes API 必须走轻量路径

新建工作流弹窗读取 active oz changes 时，不得重建全项目 provider/session/sidebar read model。

### 场景：打开弹窗不触发全量项目会话扫描

- **当** 前端打开工作流操作弹窗
- **则** `/api/projects/:projectName/openspec/changes` 只解析当前 project path
- **且** 不调用全量 provider session population
- **并且** 不需要 `attachWorkflowMetadata(await getProjects())`

### 场景：返回未被 workflow claim 的 active changes

- **给定** `oz list --json` 返回 active changes `["a", "b"]`
- **且** 当前项目已有 workflow claim 了 `"a"`
- **当** 请求 active changes API
- **则** 返回 `["b"]`
- **并且** 排序规则与现有 `listProjectAdoptableOpenSpecChanges` 保持一致

### 场景：oz list 快速时接口不秒级等待

- **给定** 测试夹具中 `oz list --json` 立即返回
- **且** 当前项目 workflow read model 很小
- **当** 请求 `/openspec/changes`
- **则** 响应不应被 unrelated provider history 扫描拖慢
- **并且** 测试应能证明慢路径不再依赖全项目 `getProjects()`

## 需求：现有 33/34 方向不得回退

本变更必须兼容既有两个活动提案的架构方向。

### 场景：消息最终事实仍来自 co/oz flow read model

- **当** Pi workflow child session 运行中收到 realtime 事件
- **则** 页面可以刷新 read model
- **但** 最终 transcript 仍以 co durable conversation messages 为准

### 场景：session id 不被当作 pid

- **当** workflow 只有 `state.sessions` 而没有 `state.processes`
- **则** 页面不得显示 `workflow-runner-processes`
- **且** 不得把 `pi-thread-1` 显示成 pid

---
