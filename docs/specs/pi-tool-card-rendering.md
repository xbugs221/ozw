# 规格：Pi 工具卡片和思考块渲染

约束 Pi/Codex 工具卡片、思考块折叠、实时顺序、命令输出和 Edit 卡片。

## 测试入口

- `pnpm exec tsx --test tests/e2e/pi-session-input-tool-rendering.spec.ts`
- `pnpm exec tsx --test tests/manual/node-history/pi-tool-card-rendering-contract.test.ts`
- `pnpm exec tsx --test tests/manual/node-history/pi-thinking-block-render-contract.test.ts`
- `pnpm exec tsx --test tests/specs/chat-tool-message-types.spec.ts`

## 需求：Pi 工具调用获得 Codex 风格卡片渲染

### 场景：Pi Bash 工具调用显示标题栏和可折叠区域

- **给定** Pi 会话触发了 Bash 命令执行
- **且** 该工具已执行完成
- **当** 用户查看消息列表中的该工具调用
- **则** 必须显示标题栏包含 Bash 图标和名称
- **且** 工具输入和输出区域通过 `<details>` 可折叠/展开
- **且** 刷新后折叠状态保持一致

### 场景：Pi Read 工具调用使用 Read 卡片渲染

- **给定** Pi 会话触发了 Read 文件读取
- **当** 用户查看消息列表中的该工具调用
- **则** 必须使用 Read 配置渲染（显示文件路径、内容预览）
- **不得** 折叠在 bash 样式块中

### 场景：流式过程中工具执行完毕后保持展开

- **给定** Pi/Codex 智能体正在回复
- **且** 一个工具调用从 running 变为 completed（exitCode 有值、status 非 running）
- **当** 用户查看消息列表
- **则** 该工具卡片必须保持展开状态
- **且** 工具输入命令和输出结果必须可见
- **且** 用户可以手动折叠

### 场景：Pi 运行中工具保持展开状态

- **给定** Pi 会话正在执行一个工具且该工具尚未完成（status === 'running'）
- **当** 用户查看消息列表
- **则** 该工具调用必须保持展开状态（`data-collapsed="false"`）
- **且** 显示运行中标记（如 spinner 或 "Running..." 文案）
- **且** 刷新后运行中工具仍保持展开

### 场景：工具卡片不得显示重复外层标题

- **给定** 手动会话收到 bash、`command_execution`、`exec_command` 或同类工具调用事件
- **当** 前端渲染工具卡片
- **则** `MessageComponent` 不得额外在卡片左上角显示 `bash`、`Tool` 或工具名标题
- **且** 命令文本、参数、输出折叠和错误信息必须由具体 `ToolRenderer` 卡片展示
- **且** 删除外层标题不得导致命令文本或运行中状态不可见

### 场景：工具卡片命令摘要始终可见

- **给定** 已完成或运行中的 Bash/Read/Grep 工具调用
- **当** 刷新页面或首次加载
- **则** 工具卡片外层必须为 `<div>`（非 `<details>`）
- **且** 命令摘要行（含工具名与参数）必须始终可见
- **且** 工具卡片外层不再有 `data-collapsed` 属性

### 场景：工具输出默认折叠在独立区域内

- **给定** 已完成的 Bash/Read/Grep/失败工具调用
- **当** 用户查看该工具卡片
- **则** 输出区域包裹在独立的 `<details>` 中，默认不展开（无 `open` 属性）
- **且** 该 `<details>` 有摘要行显示 "Output" 标签
- **且** Bash 输出（stdout/stderr）初始不可见
- **且** Read 文件内容初始不可见
- **且** Grep 结果列表初始不可见
- **且** 失败工具的错误输出初始不可见
- **且** 用户点击摘要行后输出可见

### 场景：工具输出折叠区可通过锚点跳转展开

- **给定** 工具调用有输出结果
- **且** Grep 结果等链接指向 `#tool-result-{toolId}` 锚点
- **当** 用户点击"跳转到结果"链接
- **则** 浏览器滚动到目标工具卡片位置
- **且** 该工具的输出折叠区自动展开

### 场景：大小写不敏感工具名匹配

- **给定** Pi SDK 返回小写工具名（如 `bash`, `read`, `write`）
- **当** ToolRenderer 查找工具配置
- **则** 必须通过首字母大写化后进行大小写不敏感匹配
- **且** getToolConfig 和 getToolCategory 均支持小写输入

### 场景：工具卡配置按业务 family 拆分

- **给定** shell、file、codex 和 subagent 工具卡配置共同服务聊天渲染
- **当** 审计 `frontend/components/chat/tools/configs/`
- **则** `toolConfigs.ts` 必须退化为注册表或兼容导出，不再承载巨型配置
- **且** shell/file/codex/subagent 配置必须存在独立 family 模块
- **且** family 模块必须说明工具配置业务目的并导出可审查入口
- **且** `TODO TOOLS` 残留不得出现在工具配置入口中

对应规格测试：`tests/specs/chat-tool-message-types.spec.ts`，并生成 `test-results/chat-tool-message-types/source-audit.json`。

## 需求：思考块不得显示无意义块标题

### 场景：Codex/Pi 流式思考直接按正文样式展示

- **给定** 手动会话正在从 Codex 或 Pi 接收 `reasoning` 或 `thinking` live 事件
- **当** 前端渲染思考消息
- **则** 思考正文必须直接可见
- **且** 左上角不得额外显示 `思考中` 这类块标题
- **且** 不得使用灰色左竖线、额外缩进或斜体弱化思考正文
- **且** 思考正文的字号和颜色必须与助手正文一致
- **且** `showThinking` 仍只控制 assistant 消息内联 `reasoning` 的显示开关，不得隐藏独立思考消息

## 需求：Pi 思考块默认折叠仅展示最新 3 行

### 场景：Pi 会话流式返回长思考内容

- **给定** Pi 会话正在进行并返回超过 3 行的思考文本
- **当** 思考块在前端渲染
- **则** 默认仅展示最新 3 行文本
- **且** 显示展开/折叠按钮（`thinking.expand` / `thinking.collapse` i18n 文案）
- **且** 点击展开后显示完整思考内容
- **且** 展开状态在流式更新中不丢失（同一消息 `messageKey` 不变时状态保持）

### 场景：Pi 思考内容不足 3 行

- **给定** Pi 返回的思考内容不超过 3 行
- **当** 思考块在前端渲染
- **则** 直接展示全部内容，不显示展开/折叠控件

### 场景：showThinking=false 不影响思考消息

- **给定** `showThinking` prop 为 `false`
- **当** 思考块渲染
- **则** 思考块必须仍以独立卡片展示
- **且** `showThinking` 只控制 `message.reasoning` 内联区展示
- **且** 不存在 `shouldHideThinkingMessage` 全局隐藏逻辑

## 需求：Pi 思考过程中工具调用独立渲染

### 场景：Pi 会话在思考过程中执行工具调用

- **给定** Pi 会话在 thinking 阶段触发了 `tool_execution_start` 事件
- **当** 前端收到 `pi-response` 事件（itemType: `tool_call`）
- **则** 工具调用应渲染为独立的 `ToolRenderer` 卡片
- **且** 不应混入任何思考块的文本内容中

### 场景：Pi 会话 JSONL 历史记录中思考与工具调用正确分离

- **给定** Pi 会话已完成并存有 JSONL 历史
- **当** 前端请求会话消息
- **则** `mapPiEntryToMessages` 应将 `type: 'thinking'` 的 content part 转换为 `isThinking: true` 的 ChatMessage
- **且** `type: 'toolCall'` 的 content part 应转换为 `isToolUse: true` 的 ChatMessage
- **且** 两者不应合并为同一条消息

### 场景：Pi 思考块和工具调用在 JSONL 读取路径正确分离

- **给定** Pi SDK 返回 `thinking_delta` 事件（itemType: `reasoning`，`isReasoning: true`）
- **当** `mapPiEntryToMessages` 处理 JSONL 条目
- **则** 支持 `item.type === 'thinking' && item.thinking`（Pi 标准格式）
- **且** 支持 `item.type === 'reasoning_content' || item.reasoning_content`（DeepSeek 格式）
- **且** 工具调用（`item.type === 'tool_use'`）始终独立渲染

## 需求：流式工具卡片必须按事件顺序插入

### 场景：思考之间发生 bash 命令

- **给定** provider 按顺序推送 `reasoning A`、`command_execution bash`、`reasoning B`
- **当** `reduceNativeRuntimeEvent` 在响应未完成时更新聊天消息
- **则** 运行中的 transcript 顺序必须是 `reasoning A`、`bash 卡片`、`reasoning B`
- **且** `reasoning B` 不得合并回 `reasoning A` 导致 bash 卡片停留在底部
- **且** 响应完成或刷新页面后，持久化 transcript 不能改变这个相对顺序

### 场景：同一个工具的输出 delta 继续更新原卡片

- **给定** 同一个 bash/command 工具先后推送 input、running output 和 final result
- **当** 前端实时接收这些事件
- **则** 同一个 `toolCallId`/`itemId` 的工具事件必须更新同一张工具卡片
- **且** 修复思考顺序时不得重新引入重复工具 result 卡片

### 场景：无稳定 itemId 的 reasoning 块生成唯一 messageKey

- **给定** provider 推送多个被工具卡片分隔的 reasoning/thinking 块，且这些块没有稳定的 itemId
- **当** `reduceNativeRuntimeEvent` 将它们创建为独立消息
- **则** 每个 reasoning 块必须获得唯一且稳定的 messageKey（如 `provider:thinking-1`、`provider:thinking-2`）
- **且** 同 provider 的 thinking 序号按消息数组中已有 thinking 块数量递增
- **且** messageKey 跨 render 确定，不与有 itemId 的消息 key 冲突

### 场景：provider live allowlist 包含 thinking itemType

- **给定** 手动会话 WebSocket 推送 `itemType: "thinking"` 事件
- **当** 前端 useChatRealtimeHandlers 处理该消息
- **则** Codex 和 Pi 的 live item allowlist 必须包含 `"thinking"`
- **且** `thinking` 事件不被 filter 拦截，到达 `reduceNativeRuntimeEvent` 并渲染为独立思考块

## 需求：Pi persisted transcript 必须保持 native content 顺序

Pi native JSONL 中同一条 assistant message 的 `content[]` 是 provider 输出顺序，ozw read model 不得按类型重新分组。

### 场景：text、thinking 和 toolCall 在同一 assistant message 中交错

- **给定** Pi JSONL 中一条 assistant message 的 content 顺序是 `text A -> thinking B -> text C -> toolCall D`
- **当** ozw 通过 `/messages` 或 `getPiSessionMessages` 读取该会话
- **则** raw messages 的可见顺序必须保持 `text A -> thinking B -> text C -> toolCall D`
- **且** `text A` 和 `text C` 不得被合并后移动到 `thinking B` 或 `toolCall D` 之后

### 场景：工具结果附着到原工具卡片

- **给定** Pi JSONL 在 `toolCall D` 之后写入匹配的 `toolResult D`
- **当** 前端把 raw messages 转成聊天消息
- **则** 工具结果必须附着到 `toolCall D` 对应的工具卡片
- **且** 工具卡片仍显示在 `toolCall D` 的原始位置
- **且** 工具结果不得把工具卡片移动到后续 assistant 正文之后

## 需求：手动会话流式工具卡片实时渲染

Codex 和 Pi 手动会话运行中，前端必须把实时 provider item（`tool_call`、`tool_result`、`command_execution`）转成可渲染聊天消息，而不是等持久化 JSONL/read model 刷新后才出现。

### 场景：Codex 工具调用实时显示

- **给定** 用户发起 Codex 手动会话
- **且** 后端通过 WebSocket 推送 `codex-response`，其中 `data.type = "item"` 且 `itemType = "tool_call"` 或 `itemType = "tool_result"`
- **当** 前端处理该 WebSocket 消息
- **则** 该 item 必须进入 `reduceNativeRuntimeEvent`
- **且** 聊天区出现 `isToolUse = true` 的 assistant 工具卡片
- **且** 不需要等待 `/messages` 接口回读持久化 transcript

### 场景：Pi 工具调用实时显示

- **给定** 用户发起 Pi 手动会话
- **且** 后端通过 WebSocket 推送 `pi-response` 的 `tool_call` 和 `tool_result`
- **当** 前端处理该 WebSocket 消息
- **则** 聊天区必须显示同一张工具卡片
- **且** 工具名称、输入和输出与 Codex 同类工具保持同一渲染契约

### 场景：Pi nested tool_call 位于两个 thinking 块之间

- **给定** Pi WebSocket 按顺序推送 `thinking A -> tool_call B -> tool_result B -> thinking C`
- **且** `tool_call B` 的工具名和参数位于 `data.item` 内
- **当** 前端处理这些 `pi-response` item
- **则** 聊天区必须按 `thinking A -> 工具卡片 B -> thinking C` 展示
- **且** 工具卡片必须显示真实工具名和命令/参数
- **且** `tool_result B` 必须附着到工具卡片 B，不得生成第二张工具卡片
- **且** 工具后的 `thinking C` 不得合并回 `thinking A`

### 场景：命令输出 delta 不清空命令卡片

- **给定** 手动会话已经收到一个 `command_execution` item，命令是 `pnpm test`
- **且** 聊天区已显示该命令工具卡片
- **当** 同一 `itemId` 后续收到只包含 `output`、不包含 `command` 的输出 delta
- **则** 工具卡片仍显示 `pnpm test`
- **且** 新输出内容进入该卡片的可折叠输出区域
- **且** 该卡片不会消失或变成空工具卡

### 场景：空 read model 刷新不吞掉 live 卡片

- **给定** 手动会话运行中已经显示 live assistant 或 live tool 卡片
- **当** `/messages` 因持久化尚未完成而短暂返回空数组
- **则** 前端仍保留当前 live 消息卡片
- **且** 后续持久化消息到达后再按身份去重合并

## 需求：命令工具卡片不出现外层嵌套 Output 组

### 场景：Codex Bash 命令直接展示

- **给定** 用户发起 Codex 手动会话
- **且** Codex 执行 `pnpm test`
- **当** 前端渲染该工具调用卡片
- **则** `pnpm test` 命令文本直接可见
- **且** 工具卡标题栏只是工具标签，不显示 chevron 折叠图标
- **且** 命令文本不需要展开外层 `<details>` 才能看到

### 场景：命令输出默认折叠但不重复工具名

- **给定** 上述命令已产生 stdout/stderr
- **当** 前端渲染命令输出
- **则** 输出默认折叠
- **且** 输出折叠区属于同一张命令工具卡
- **且** 不再出现第二个显示 `Bash / Output` 或 `exec_command / Output` 的独立折叠组

### 场景：Pi 命令工具与 Codex 一致

- **给定** 用户发起 Pi 手动会话
- **且** Pi 执行同类 shell 命令工具
- **当** 前端渲染工具调用和输出
- **则** 命令直接可见、输出默认折叠
- **且** Pi 不会因为 provider 不同而回退到旧的嵌套折叠样式

### 场景：命令工具卡片不显示额外 Result 行

- **给定** Codex 或 Pi persisted transcript 中有一张命令类工具卡片
- **且** 该工具卡片已经显示命令文本和可展开输出
- **当** 用户查看聊天区
- **则** 卡片底部不得出现单独一行 `Result`
- **且** 用户仍能展开并看到工具输出
- **且** `tool-result-*` 锚点和输出检查入口不得丢失

### 场景：工具执行失败输出仍可检查

- **给定** 工具结果标记为错误
- **当** 前端渲染工具卡片
- **则** 错误内容仍必须可见或可展开
- **且** 可以保留错误状态文案，但不得为了普通输出重新显示通用 `Result`

## 需求：失败态与重复操作的状态一致性

### 场景：model-state 持久化失败后前端记录警告

- **给定** Pi 会话模型状态 HTTP PUT 请求返回 500
- **当** 持久化失败
- **则** 前端必须记录可诊断的 `Failed to persist session model state: 500` 控制台警告

### 场景：失败深度持久化不污染刷新后状态

- **给定** Pi 会话选择了 off 深度并成功持久化
- **且** 用户尝试切换到 high 深度但持久化失败（PUT 返回 500）
- **当** 用户刷新浏览器后
- **则** 深度下拉框必须回退到最近成功持久化的 off 状态
- **且** 界面不得显示失败的 high 深度

### 场景：断线失败后重试不重复指令

- **给定** Pi 会话在发送指令时断线
- **当** 重试同一指令
- **则** 该指令仅发送一次（piCommandCount=1）

### 场景：重复提交去重

- **给定** 用户快速重复提交同一输入
- **当** 刷新页面
- **则** 同一输入仅显示一次，不做重复显示

## 需求：Edit 工具卡片详情可检查且不触发前端错误

### 场景：Pi 手动会话中展开 Edit 卡片

- **给定** 用户打开一个包含 `Edit` 工具调用的 Pi 手动会话
- **当** 用户点击 `Edit` 工具卡片检查具体编辑内容
- **则** 卡片必须展开并展示 old/new diff 内容
- **且** 浏览器不得出现 `pageerror`、React runtime error 或 console `TypeError`
- **且** 文件路径或文件名仍必须可见，方便用户确认被编辑对象

### 场景：Codex 手动会话中展开 Edit 卡片

- **给定** 用户打开一个包含 `Edit` 工具调用的 Codex 手动会话
- **当** 用户点击 `Edit` 工具卡片检查具体编辑内容
- **则** 卡片必须展开并展示 old/new diff 内容
- **且** 浏览器不得出现 `pageerror`、React runtime error 或 console `TypeError`

### 场景：点击 Edit 卡片文件入口打开编辑器

- **给定** `Edit` 工具卡片已经展示可点击文件入口
- **当** 用户点击 `open` 或等价的文件打开入口
- **则** 前端必须打开编辑器侧栏或保持可检查状态
- **且** 传递 diffInfo 时不得因为缺少字段、payload 为字符串或 provider 差异而抛出异常

## 需求：工具卡片不显示内部工具分组名

### 场景：文件和命令工具卡片展示给用户

- **给定** transcript 包含 `Read`、`Edit`、`exec_command` 或 `functions.exec_command` 工具调用
- **当** 前端渲染工具卡片
- **则** 可见主标签不得显示 `Read`
- **且** 可见主标签不得显示 `Edit /` 或单独的 `Edit` 分组名
- **且** 可见文本不得显示 `exec_command` 或 `functions.exec_command`
- **且** 文件路径、文件名、命令文本、diff 和输出折叠入口仍必须可见

### 场景：工具输出折叠行为保持不变

- **给定** 工具调用已有成功或失败输出
- **当** 前端渲染工具结果
- **则** 输出内容仍默认折叠
- **且** 用户点击输出折叠入口后才能看到具体输出
- **且** 移除工具分组名不得新增重复卡片或恢复外层工具标题
