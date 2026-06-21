# 规格：收敛核心架构债和性能边界

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence | 真实数据来源 | 入口路径 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Provider transcript shared 边界 | 后端不再导入前端 chat reducer | T29-CORE-BOUNDARY | E29-CORE-AUDIT | 当前源码 | `backend/domains/provider-runtime/*` | 后端只依赖 `shared/provider-runtime-transcript.ts` | reducer 行为仍需现有消息合并测试兜底 |
| Provider transcript shared 边界 | active/live store 移除类型逃逸 | T29-CORE-BOUNDARY | E29-CORE-AUDIT | 当前源码 | `backend/domains/provider-runtime/*` | 无 `@ts-nocheck`，共享类型可编译 | 需要执行 TypeScript 全量检查 |
| Chat runtime 拆分 | session runtime 只负责装配 | T29-CORE-BOUNDARY | E29-CORE-AUDIT | 当前源码 | `frontend/components/chat/session/*` | 主 hook 低于规模预算，loader/hydration/scroll 控制器存在 | 拆分后 closure 依赖可能遗漏 |
| Chat runtime 拆分 | realtime handler 拆成生命周期和事件控制器 | T29-CORE-BOUNDARY | E29-CORE-AUDIT | 当前源码 | `frontend/components/chat/realtime/*` | 主 hook 低于规模预算，provider event controller 存在 | 需要端到端覆盖 streaming |
| Chat runtime 拆分 | composer dispatch 和附件状态分离 | T29-CORE-BOUNDARY | E29-CORE-AUDIT | 当前源码 | `frontend/components/chat/composer/*` | 主 hook 低于规模预算，attachment/dispatch 控制器存在 | 附件上传失败流需回归 |
| Project overview runtime 拆分 | 面板 runtime 不再混合所有职责 | T29-CORE-BOUNDARY | E29-CORE-AUDIT | 当前源码 | `frontend/components/main-content/project-overview/*` | 主 runtime 低于规模预算，section/controller 模块存在 | UI 行为需 Playwright 验证 |
| Project overview runtime 拆分 | 批量操作保持 provider-aware | T29-PROJECT-OVERVIEW-E2E | E29-OVERVIEW-REPORT | 真实项目列表和 session 数据 | `ProjectOverviewPanel` | 批量 stop/delete 不跨 provider 误操作 | 依赖本地项目状态 |
| Agent route 安全拆分 | route 只做 HTTP 绑定 | T29-CORE-BOUNDARY | E29-CORE-AUDIT | 当前源码 | `backend/routes/agent.ts` | 认证、路径、GitHub、runner、writer 模块存在 | 需要覆盖错误码兼容 |
| Agent route 安全拆分 | GitHub token 不进入 URL 或进程参数 | T29-AGENT-ROUTE | E29-AGENT-LOG | 真实 clone/pull 参数 | `backend/domains/agent/github-operations.ts` | token 使用受控凭证注入 | 日志脱敏仍需人工抽查 |
| Server runtime 拆分 | server lifecycle 模块化 | T29-CORE-BOUNDARY | E29-CORE-AUDIT | 当前源码 | `backend/server/server-runtime.ts` | 主 runtime 低于规模预算，watcher/backfill/route deps 拆出 | 启动顺序需集成验证 |
| Server runtime 拆分 | HTTP route deps 类型化 | T29-CORE-BOUNDARY | E29-CORE-AUDIT | 当前源码 | `backend/server/http/*` | route deps 不再是 `any` | 第三方类型可能需要局部 adapter |
| Tool registry 拆分 | 工具族配置分离 | T29-CORE-BOUNDARY | E29-CORE-AUDIT | 当前源码 | `frontend/components/chat/toolConfigRegistry*` | registry 低于规模预算，family modules 存在 | UI 文案差异需快照验证 |
| Tool registry 拆分 | payload config 不公开 `any` | T29-TOOL-RUNTIME | E29-TOOL-REPORT | 工具调用样例 | `toolConfigRegistry` | 使用 `unknown` 和类型守卫 | 复杂 provider payload 仍需样例补齐 |
| 性能边界 | 全量消息改为分块加载 | T29-PERF-BOUNDARY | E29-PERF-AUDIT | 当前源码和大 session 样例 | `loadAllMessages` | 不使用 `limit=null` 无限拉取，有 page size | 大 session 需要运行时计时 |
| 性能边界 | 项目刷新用稳定签名 | T29-PERF-BOUNDARY | E29-PERF-AUDIT | 当前源码和项目列表样例 | `projectRefreshReducer` | 不用 `JSON.stringify` 深比较 sessions/workflows | 签名字段遗漏会造成刷新不及时 |
| 性能边界 | 保留文件提及和消息虚拟化保护 | T29-PERF-BOUNDARY | E29-PERF-AUDIT | 当前源码 | `useFileMentions`、`ChatMessagesPane` | 提及按需 depth<=2，消息窗口有上限 | UI 体验仍需手测极端项目 |
| 工作流 validation 边界 | oz flow validation 锁定验收命令和系统健康检查 | T29-CORE-BOUNDARY | E29-CORE-AUDIT | 当前源码 | `oz-flow.yaml` | validation 包含提案校验、契约测试、类型检查、目标回归、Playwright 和 build | 长耗时测试可能需要 CI 资源 |

### 需求：Provider transcript shared 边界

#### 场景：后端不再导入前端 chat reducer

给定 provider runtime 需要维护 active turn 和 live transcript 状态，当后端模块构建 overlay 状态时，必须从 `shared/provider-runtime-transcript.ts` 导入纯 reducer 和类型，而不是从 `frontend/components/chat/*` 导入。

#### 场景：active/live store 移除类型逃逸

给定 active turn store 和 live transcript store 是后端运行时核心模块，当 TypeScript 编译这些模块时，模块不得使用 `@ts-nocheck` 避开类型检查。

### 需求：Chat runtime 拆分

#### 场景：session runtime 只负责装配

给定用户打开一个已有会话，当 session runtime 需要加载历史、合并消息、滚动定位和处理 hydration 时，这些职责必须分散到专门 controller 或 loader，主 hook 保持装配层规模。

#### 场景：realtime handler 拆成生命周期和事件控制器

给定 provider 正在推送实时事件，当前端处理 session lifecycle、provider event 和工具调用事件时，事件分发必须由独立 controller 管理，主 hook 不直接承载完整事件状态机。

#### 场景：composer dispatch 和附件状态分离

给定用户在 composer 中输入消息、添加附件并提交，当 composer 判断可提交状态和执行 dispatch 时，附件状态和提交动作必须由独立 controller 管理。

### 需求：Project overview runtime 拆分

#### 场景：面板 runtime 不再混合所有职责

给定用户进入项目概览，当页面展示手动 session、workflow 和批量操作时，面板 runtime 只组合 section 和 controller，不再把请求、选择状态、分组渲染和动作实现写在同一个巨型文件中。

#### 场景：批量操作保持 provider-aware

给定项目存在 codex session、PI session 和 workflow session，当用户批量停止或删除时，系统必须按 session 来源调用对应后端行为，不能把不同 provider 的 session 混用同一动作。

### 需求：Agent route 安全拆分

#### 场景：route 只做 HTTP 绑定

给定用户通过 agent route 启动或维护会话，当请求进入 `backend/routes/agent.ts` 时，route 文件只负责 HTTP 绑定、参数传递和错误映射，认证、路径解析、GitHub 操作、session runner 和响应写入都在领域模块中完成。

#### 场景：GitHub token 不进入 URL 或进程参数

给定用户配置 GitHub token，当后端执行 clone、pull 或相关 Git 操作时，token 不得拼入 URL、日志或命令行参数，必须通过受控凭证注入或脱敏环境传递。

### 需求：Server runtime 拆分

#### 场景：server lifecycle 模块化

给定后端服务启动，当系统初始化 watcher、项目索引、文件分类和 HTTP routes 时，`server-runtime.ts` 必须把生命周期阶段拆到独立模块，主 runtime 保持清晰启动顺序。

#### 场景：HTTP route deps 类型化

给定 HTTP route 模块需要访问项目 store、session store、provider runtime 和广播能力，当注册 route 时，deps 必须使用显式接口，不能以 `deps: any` 传入。

### 需求：Tool registry 拆分

#### 场景：工具族配置分离

给定 chat UI 需要展示 read、edit、exec、provider、workflow 等工具调用，当新增或修改工具展示配置时，配置必须位于对应工具族模块，registry 只负责组合和查找。

#### 场景：payload config 不公开 `any`

给定工具调用 payload 来自 provider runtime，当 UI 解析 payload 时，公开配置接口必须使用 `unknown` 加类型守卫或 parser，不得把 `any` 暴露为默认扩展点。

### 需求：性能边界

#### 场景：全量消息改为分块加载

给定一个包含大量消息的会话，当用户触发全量加载或定位目标消息时，前端必须按固定 page size 分块请求，不能使用 `limit=null` 一次拉取全部历史。

#### 场景：项目刷新用稳定签名

给定项目列表轮询刷新，当判断项目列表是否变化时，reducer 必须比较稳定签名或字段级版本，不得对完整项目对象和大型 session/workflow 数组做 `JSON.stringify` 深比较。

#### 场景：保留文件提及和消息虚拟化保护

给定用户输入文件提及或查看超长消息列表，当文件下拉未打开时不触发扫描，打开后扫描深度不超过 2 且不包含隐藏文件；消息列表必须保留虚拟化窗口上限。

### 需求：工作流 validation 边界

#### 场景：oz flow validation 锁定验收命令和系统健康检查

给定本提案将由 `oz flow run` 执行，当工作流进入 validation 阶段时，仓库 `oz-flow.yaml` 必须运行提案结构校验、新增源码契约测试、类型检查、目标回归、项目概览 Playwright 路径和 build，避免收益不明的拆分引入系统无法运行的回归。
