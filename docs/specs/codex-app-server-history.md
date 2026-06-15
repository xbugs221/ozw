# 规格：Codex app-server 历史、顺序和恢复

约束 Codex 历史分页、read model、刷新恢复、Markdown 容错和 provider runtime 边界。

## 测试入口

- `pnpm exec tsx --test tests/specs/codex-history-message-order.spec.ts`
- `pnpm exec tsx --test tests/specs/codex-app-server-protocol-mapping.spec.ts`
- `pnpm exec tsx --test tests/specs/provider-runtime-boundary.spec.ts`

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

### 需求：Provider runtime 主路径边界清晰

#### 场景：Codex 只能通过 app-server runtime

- **给定** 用户在手动聊天页选择 Codex
- **当** 后端处理 `codex-command`
- **则** 命令必须进入 Codex app-server facade
- **并且** 生产源码不得导入 `@openai/codex-sdk`

### 需求：Route session 与 provider session 绑定单一职责

#### 场景：cN route 与 provider session 绑定集中管理

- **给定** 一个 cN route session 已绑定 provider session id
- **当** websocket、messages API、complete reconcile 和 abort 查询绑定
- **则** 都必须通过 `provider-session-binding` 模块
- **并且** 不允许多个模块各自拼装绑定字段

### 需求：运行态恢复和完成清理可推理

#### 场景：active-turn overlay 与 live snapshot 生命周期分离

- **给定** provider turn 正在运行并产生 live transcript
- **当** 页面刷新、complete、abort 或 error 发生
- **则** active-turn overlay 和 live snapshot 必须按各自生命周期清理
- **并且** complete 后 JSONL 读到真实历史时 live snapshot 不再作为权威历史

对应规格测试：`tests/specs/provider-runtime-boundary.spec.ts`、`tests/specs/codex-app-server-protocol-mapping.spec.ts`、`tests/specs/codex-app-server-steer-runtime.spec.ts`、`tests/spec/pi-provider-integration.spec.ts`，并生成 `test-results/provider-runtime/source-audit.json`、`test-results/provider-runtime/binding-state.json`、`test-results/provider-runtime/active-turn-runtime.log`。
