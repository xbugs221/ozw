# 设计：收敛核心架构债和性能边界

## 架构原则

- 先提纯可共享逻辑，再拆运行时 orchestration。
- 运行时 hook 只负责装配 React 生命周期，不承载大段业务状态机。
- 后端入口只做路由绑定，认证、路径、GitHub、session 执行和响应写入各自成模块。
- 性能热点必须有可静态验证的边界，避免后续改动回到全量序列化或无限拉取。

## Provider transcript shared 核心

新增 `shared/provider-runtime-transcript.ts`，承载 native runtime transcript 的事件类型、overlay reducer、delta 合并和初始状态构造。前端 `nativeRuntimeTranscript` 保留为适配层，后端 provider runtime 只依赖 shared 模块。

这样可以避免 `backend/domains/provider-runtime/*` 反向导入 `frontend/components/chat/*`，也让 active turn store 与 live transcript store 可以在没有 React 和前端路径的环境中独立测试。

## Chat runtime 拆分

`useChatSessionStateRuntime.ts` 拆为 session history loader、hydration controller、scroll controller、message merge adapter。主 hook 只保留 React state wiring 和组合逻辑。

`useChatRealtimeHandlersRuntime.ts` 拆为 session lifecycle、provider event controller、tool call event controller、queue/flush coordinator。事件处理器使用明确的输入输出结构，减少 closure 中的隐式依赖。

`useChatComposerStateRuntime.ts` 拆为 attachment controller、dispatch controller、draft state reducer、submit eligibility selector。composer 主 hook 只组合外部 API 和 UI state。

## Project overview runtime 拆分

`ProjectOverviewPanelRuntime.tsx` 拆为 action controller、manual sessions section、workflow section、bulk selection state。面板 facade 继续保留现有 props 入口，但内部不再混合请求、选择、分组渲染和业务动作。

批量操作需要保留 provider-aware 和 session-source-aware 行为，避免把 codex session、PI session 和 workflow session 混为同一种删除或停止语义。

## Agent route 安全边界

`backend/routes/agent.ts` 拆为：

- `backend/domains/agent/agent-auth.ts`
- `backend/domains/agent/agent-project-resolver.ts`
- `backend/domains/agent/github-operations.ts`
- `backend/domains/agent/agent-session-runner.ts`
- `backend/domains/agent/agent-response-writer.ts`

route 文件只绑定 HTTP 方法和错误响应。GitHub token 不进入 clone URL、日志或进程参数；需要凭证时通过临时 credential helper 或受控环境变量注入。

## Server runtime 和 HTTP deps

`backend/server/server-runtime.ts` 拆出启动生命周期、watcher setup、项目索引回填、文件分类和 route deps 构造。HTTP route 模块不再接收 `deps: any`，改为显式接口。

这会让后续改动可以定位到具体生命周期阶段，不需要在一个千行 runtime 文件里同时判断 watcher、projects、routes 和 server startup 的交互。

## Tool config registry

`toolConfigRegistry.ts` 按工具族拆分为 read/edit/exec/provider/workflow 等配置模块。registry 负责组合、校验和别名归一化。工具 payload config 使用 `unknown` 输入和类型守卫，而不是公开 `any`。

别名从手写条件分支改为数据驱动 map，减少新增工具时遗漏 UI 文案、icon 或状态解析的风险。

## 性能边界

`loadAllMessages` 改为分块加载，使用固定 page size 和停止条件，不再通过 `limit=null` 拉全量。项目刷新 reducer 改为构建稳定签名，只比较项目列表 UI 真正需要的字段，避免对 sessions、workflows、codexSessions、piSessions 做深层 JSON 序列化。

文件提及扫描保持打开下拉时才请求，默认 depth 不超过 2，隐藏文件不扫描。消息列表继续保留虚拟化窗口上限。

## 测试策略

- 新增源码契约测试验证边界、文件规模、关键模块存在性和性能保护。
- 保留现有单元测试，覆盖消息合并、工具展示配置、后端类型模块和 agent route。
- 对 project overview 和 chat 关键业务流补真实端到端测试，验证用户能在真实项目数据上刷新、批量操作、发送消息和查看实时输出。

