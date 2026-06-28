# 规格：聊天渲染反馈一致性

## 验收矩阵

| 需求 | 场景 | 规格测试 | 真实数据来源 | 入口路径 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- |
| Codex live assistant 不显示冗余元信息 | WebSocket assistant 只显示响应正文 | `tests/specs/chat-rendering-parity.spec.tsx` | 真实 `MessageComponent` SSR 渲染 | `MessageComponent` assistant 分支 | 正文可见，provider 标题 `Codex` 和行时间戳不可见 | Node SSR 不验证最终浏览器排版 |
| Codex 响应必须晚于绿色用户气泡 | 用户气泡仍为 sent 时隐藏同 turn live response | `tests/specs/chat-rendering-parity.spec.tsx` | 真实 `mergePersistedAndOptimisticMessages` 和 `reduceNativeRuntimeEvent` | session message merge、native runtime reducer | sent 阶段不显示 live assistant；persisted echo 到达后 user 为 persisted 且 assistant 排在其后 | 多窗口 late duplicate 继续由聊天归并内核规格覆盖 |
| Pi 与 Codex 命令工具卡结构一致 | 相同命令工具共享卡片结构 | `tests/specs/chat-rendering-parity.spec.tsx` | 真实 `MessageComponent` 和 `ToolRenderer` SSR 渲染 | MessageComponent 工具分支、ToolRenderer | 两者都渲染为 `data-testid="codex-tool-card"`，命令、输出 anchor 和结构指纹一致 | 其它工具族需按风险补充专门规格 |
| 文件型工具卡片路径统一可打开 | view_image/Read/Edit/FileChanges 路径复用 open-file 配置 | `tests/specs/chat-rendering-parity.spec.tsx`、`tests/spec/chat-composer-runtime.spec.ts` | 真实 `ToolRenderer`、tool config 和浏览器文件预览 | `openFileToolConfig`、`ToolRenderer`、workspace file open | 路径渲染为可点击控件，点击后调用 workspace 文件打开；图片路径打开图片预览 | 文件不存在时沿用现有 editor error UI |
| 回复正文开始后折叠非正文内容 | 工具调用及其间的过程说明进入 turn 级折叠组，纯工具调用合并为工具次数折叠组 | `tests/specs/chat-rendering-parity.spec.tsx` | 真实 `ChatMessage` 字段组合和 turn display block 构建入口 | `buildTurnDisplayBlocks`、`ChatMessagesPane`、`TurnNonBodyGroup` | 正文出现后非正文组默认折叠，正文直接可见；工具调用前后夹杂的过程说明也折叠；仅 live 执行默认展开，历史或非 live 执行默认折叠；纯工具块只显示“工具调用N次”汇总按钮，展开后平铺工具卡且不重复 Codex/时间戳；子任务步骤不显示具体工具类型 | 浏览器截图证据保留在对应归档提案中，长期规格测试固定核心状态合同 |

### 需求：Codex live assistant 不显示冗余元信息

#### 场景：WebSocket assistant 只显示响应正文

- 给定前端收到一条 `source: "codex-live"` 或 `source: "codex-realtime"` 的 assistant 消息
- 当 `MessageComponent` 渲染这条实时响应
- 那么用户可见内容必须包含响应正文
- 并且不得显示 provider 标题 `Codex`
- 并且不得显示该响应行的时间戳文本

### 需求：Codex 响应必须晚于绿色用户气泡

#### 场景：用户气泡仍为 sent 时隐藏同 turn live response

- 给定 transcript 中有一条 `deliveryStatus: "sent"` 的 Codex 用户消息
- 并且同 turn 的 `source: "codex-live"` assistant 已通过 WebSocket 到达
- 当生成可见 transcript
- 那么 assistant 响应不得出现在用户气泡变为 persisted 之前
- 当 persisted 用户 echo 到达
- 那么可见 transcript 必须先显示 `deliveryStatus: "persisted"` 的用户气泡，再显示同 turn live assistant
- 并且首轮或新 turn 只有 `clientRequestId`、没有 durable `turnAnchorKey` 时也必须遵守同一规则

### 需求：Pi 与 Codex 命令工具卡结构一致

#### 场景：相同命令工具共享卡片结构

- 给定 Pi 与 Codex 各有一条语义相同的命令工具消息
- 当使用真实 `MessageComponent` 和 `ToolRenderer` 渲染两条消息
- 那么两者都必须渲染为 `data-testid="codex-tool-card"` 工具卡片
- 并且命令文本、`tool-result-*` 输出 anchor、折叠结果和核心结构必须一致
- 并且 Pi 不得走 provider 专属的另一套命令工具卡样式

### 需求：文件型工具卡片路径统一可打开

#### 场景：view_image/Read/Edit/FileChanges 路径复用 open-file 配置

- 给定 Codex/Pi 输出 view_image、Read、Edit 或 FileChanges 工具卡片
- 当工具参数或结果中包含 workspace 文件路径
- 那么路径必须通过共享 open-file 配置渲染为可点击控件
- 并且点击时必须把原始路径交给 workspace `onFileOpen`
- 并且图片路径必须打开右侧图片预览，而不是退化成普通文本或 JSON 展示

### 需求：回复正文开始后折叠非正文内容

#### 场景：思考折叠，纯工具调用合并为工具次数折叠组

- 给定同一用户回合中先后出现思考、工具调用、批量命令和最终助手正文
- 当最终助手正文已经开始
- 那么思考、工具调用、以及工具调用前后夹杂的过程说明必须归入同一个 turn 级非正文组
- 并且非正文组默认折叠，最终助手正文直接可见
- 并且当同一回合存在工具或思考过程时，只有最后一段 assistant 正文可以作为最终正文直接展示
- 当最终助手正文尚未出现时
- 那么只有 websocket live 思考和工具执行过程必须默认展开可见
- 并且历史回放或非 live 的未完成执行过程必须默认折叠
- 当一个非正文块内部只有工具调用时
- 那么页面必须只显示一个“工具调用N次”汇总按钮，不显示“思考与工具调用”外壳
- 并且点击汇总按钮后，工具卡必须上下串联平铺展示
- 并且组内工具卡不得重复显示 provider 标题 `Codex` 或单条消息时间戳
- 并且子任务内部步骤不得显示具体工具类型标签
- 并且同一批量工具组的摘要必须展示真实命令数量
- 并且历史回放中的字符串 `toolInput`、拆分的 `tool_use` / `tool_result` 形态不得导致命令数量少算或多算

## 契约测试

### `tests/specs/chat-rendering-parity.spec.tsx`

- 覆盖核心业务契约：Codex live assistant 隐藏冗余 provider/时间戳、Codex live response 等待 persisted 用户气泡、clientRequestId-only 首轮也受 gating 保护、Pi/Codex 命令工具卡结构一致、view_image 文件路径渲染为直接可点击 open-file 控件、回复正文开始后 turn 级非正文内容默认折叠。
- 真实数据来源：通过 Vite SSR 加载生产 `MessageComponent`、`ThemeProvider`、生产 `sessionMessageMerge`、`nativeRuntimeTranscript` 和 `buildTurnDisplayBlocks`，输入使用真实 `ChatMessage` 字段组合与真实 Codex runtime event shape。
- 入口路径：`pnpm exec tsx --test tests/specs/chat-rendering-parity.spec.tsx`
- 用户可见断言：以 SSR HTML 和 transcript 顺序检查用户能看到的正文、元信息、气泡顺序、工具卡 anchor 与卡片结构。
