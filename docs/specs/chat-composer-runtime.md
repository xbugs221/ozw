# 规格：聊天输入发送与运行态可见

## 需求：聊天输入和会话控制规则保持模块化

### 场景：公开聊天 hooks 只作为组合层

- **给定** 开发者审查聊天 composer 和 session hooks
- **当** 输入、附件、发送、模型控制、会话加载、滚动锚点和本地恢复规则发生变更
- **则** 公开 `useChatComposerState.ts` 和 `useChatSessionState.ts` 必须保持轻量组合层
- **且** 主要业务规则必须由 `frontend/components/chat/composer/` 与 `frontend/components/chat/session/` 下的专用模块承载
- **且** 生产聊天路径必须实际导入这些模块，而不是只保留未使用的边界文件

### 场景：附件、发送和模型控制行为不因拆分回退

- **给定** 用户发送新会话消息、在运行中会话补充消息、添加附件或切换模型/思考深度
- **当** 控制面模块处理这些输入
- **则** 附件数量、大小、去重、上传失败提示和清理规则必须稳定
- **且** Codex steer、Pi follow-up/queue、optimistic user message 和 duplicate submit 规则必须保持稳定
- **且** 异步 catalog 加载不得覆盖用户选择，同值选择不得触发冗余 model-state PUT

### 场景：会话加载和文件提及不因拆分回退

- **给定** 用户打开长会话、上滑加载旧历史、收到终态 refresh、使用 `@` 文件提及或 slash command
- **当** session loader、scroll anchor、recovery store 和 composer 输入模块协作
- **则** reload、delta append、上滑加载和 terminal reconcile 不得打乱消息顺序或重复消息
- **且** 多 token 文件模糊搜索、键盘选择和命令加载必须保持稳定

## 需求：聊天输入只通过 Ctrl/Meta+Enter 发送

### 场景：裸 Enter 只换行不发送

- **给定** 用户打开真实项目的手动会话聊天页
- **且** 输入框内已有一段草稿文本
- **当** 用户按裸 Enter
- **则** 前端不得发送 `codex-command` 或 `pi-command`
- **且** textarea 必须保留原草稿并插入换行
- **且** 不得出现新的用户消息气泡

### 场景：Ctrl+Enter 和 Meta+Enter 发送

- **给定** 用户打开真实项目的手动会话聊天页
- **当** 用户分别使用 Ctrl+Enter 和 Meta+Enter 提交草稿
- **则** 每次必须只发送一条当前 provider 命令
- **且** 发送后 textarea 必须清空
- **且** 点击发送按钮的行为不受影响

## 需求：设置页不暴露 sendByCtrlEnter

### 场景：发送快捷键不能被用户改回裸 Enter

- **给定** 用户打开 ozw 设置页
- **当** 用户查看外观、智能体、诊断等设置内容
- **则** 页面不得显示 `sendByCtrlEnter` 对应的开关
- **且** 页面不得显示“使用 Ctrl+Enter 发送”或 “Send by Ctrl+Enter”

## 需求：运行中的 cN 会话持续可见并可取消

### 场景：provider session 状态指向 cN 路由时显示 live 输出和停止按钮

- **给定** 用户打开项目的 cN 手动会话路由
- **且** provider runtime 返回 `session-status`，其中 `sessionId` 是 provider session id，`ozwSessionId/ozw_session_id` 是当前 cN
- **当** 同一运行 turn 推送 live assistant 输出
- **则** 聊天区必须显示该 live 输出
- **且** composer 必须显示停止按钮
- **当** 用户点击停止按钮
- **则** 前端必须发送 `abort-session`
- **且** abort 目标必须指向当前 cN 或其 provider session，而不是其他会话

### 场景：空 read model 刷新不吞掉 live 输出

- **给定** 手动会话运行中已经显示 live assistant 或 live tool 卡片
- **当** `/messages` 因持久化尚未完成而短暂返回空数组
- **则** 前端仍保留当前 live 消息卡片
- **且** 后续持久化消息到达后再按身份去重合并

### 场景：accepted follow-up 先变绿再显示 live before JSONL

- **给定** 用户在运行中的 cN 手动会话继续发送 follow-up
- **当** provider 已 accepted 该用户消息但 JSONL/read model 尚未写入该 turn
- **则** 用户气泡必须显示 `data-delivery-status="persisted"` 并使用绿色样式
- **且** 同 turn live assistant 内容必须在空 JSONL 刷新前可见

## 需求：文件型工具卡片路径可在真实页面打开

### 场景：view_image 工具路径打开图片预览

- **给定** 聊天页渲染包含真实 workspace 图片路径的 view_image 工具卡片
- **当** 用户点击工具卡片中的图片路径
- **则** 右侧 workspace 区域必须显示对应图片预览
- **且** 路径控件不得退化成普通文本

### 场景：Read 和 Edit 工具路径打开文本或 diff 上下文

- **给定** 聊天页渲染 Read 或 Edit 工具卡片
- **当** 用户点击卡片中的文件路径
- **则** workspace 必须打开对应文本文件或 diff 上下文
- **且** 前端必须使用原始文件路径调用打开逻辑

## 需求：active turn 使用后端开始时间计时

### 场景：新 turn 开始后状态消息携带同一个 turnStartedAt

- **给定** Codex 或 Pi 会话开始一个 active turn
- **当** 后端推送 `session-status` 且 `isProcessing` 为 true
- **则** 状态消息必须携带后端记录的 `turnStartedAt`
- **且** 运行中的 steer 或 follow-up 不得覆盖当前 active turn 的开始时间

### 场景：刷新页面后通过状态查询恢复 turnStartedAt

- **给定** 用户刷新正在运行的聊天页面
- **当** 前端通过 `check-session-status` 查询当前会话状态
- **则** 后端必须返回同一个 active turn 的 `turnStartedAt`
- **且** 前端计时不得改用刷新时间或组件挂载时间

### 场景：运行中提示行使用后端时间锚点计时

- **给定** 前端收到包含 `turnStartedAt` 的运行中状态
- **当** composer 处于 loading 状态
- **则** 输入框上方必须显示 `chat-active-turn-indicator`
- **且** `chat-active-turn-elapsed` 必须基于 `Date.parse(turnStartedAt)` 计算耗时
- **且** 状态短语可以每秒刷新，但不得改变计时锚点

### 场景：turn 结束后提示行消失

- **给定** active turn 已结束、失败、取消或收到 `isProcessing: false`
- **当** 前端处理对应运行态事件
- **则** 必须清理 active turn 的开始时间
- **且** 输入框上方不再显示 active turn 提示行
