# High-risk module refactor

本规格记录 `27-重构高风险核心模块` 的 durable 边界。目标是让 ProjectOverviewPanel、聊天核心 hook 和后端 server 边界从高风险巨型文件降为可审查入口。

## 用户风险

ProjectOverviewPanel 同时承载 workflow 入口、手动 session 入口和 action menu。useChatSessionStateImpl、useChatComposerStateImpl、useChatRealtimeHandlersImpl 共同保护消息加载、提交、realtime 与 streaming 合并。server-bootstrap、chat-command-dispatcher、file-routes 则保护启动装配、WebSocket command 分发和文件 API 安全边界。

## 模块边界

- ProjectOverviewPanel 只组合 projectOverviewViewModel、ProjectOverviewWorkflowGroups、ProjectOverviewSessionCards 和 ProjectOverviewActions，并委托核心实现。
- useChatSessionStateImpl、useChatComposerStateImpl、useChatRealtimeHandlersImpl 保留原导入路径，组合 chatSessionLifecycleController、composerSubmitRuntime、chatRealtimeEventRouter 和 streamingMessageController。
- server-bootstrap、chat-command-dispatcher、file-routes 降为装配入口；chat-client-scope-store、chat-command-router、file-route-helpers、file-tree-routes、file-mutation-routes、file-download-routes 提供可单测边界。

## 业务契约

- Project overview 组合层必须低于 700 行，导入 view model、workflow groups、session cards 和 actions 模块，不再内联 SVG icon 组件。
- Chat session、composer、realtime 三个 hook 必须低于行数预算，并把 lifecycle、submit、realtime routing、streaming merge 规则迁入独立控制器。
- Backend bootstrap、chat dispatcher、file routes 必须低于行数预算，并把 client scope store、command router、file route helper 和 route 边界拆到独立模块。
- Provider transcript reducer 必须位于 `shared/provider-runtime-transcript.ts`，前端 adapter 和后端 provider runtime store 只能依赖 shared 纯逻辑，不得让后端重新导入前端 chat reducer。
- Chat session runtime、realtime handler、composer runtime 和 project overview runtime 必须保持装配层职责，历史加载、全量分块加载、hydration、scroll、realtime event、附件、dispatch、批量操作和 section 渲染必须由 focused modules 承载。
- Agent route 必须由认证、项目路径解析、GitHub 操作、session runner 和 response writer 领域模块承载敏感逻辑；HTTP route facade 不得重新使用 `@ts-nocheck` 或把 GitHub token 拼入 URL、日志、进程参数。
- Tool config registry 必须按 read、edit、exec、provider、workflow 等工具族拆分；公开 payload config 使用 `unknown`、`Record<string, unknown>` 或 parser/guard，不能把 `any` 作为默认扩展点。
- 默认测试必须覆盖新增的 view model、chat runtime controllers、backend boundary 和本规格文件，避免只保留一次性 change tests。
- 后续历史偿债或旧测试修复不得回退上述拆分边界；若旧测试和编号更大的提案意图冲突，必须按最新提案意图同步更新测试和规格。

## 验证命令

- `pnpm exec tsx --test tests/specs/core-architecture-boundary.spec.ts`
- `pnpm exec tsx --test docs/changes/27-重构高风险核心模块/tests/*.test.ts`
- `pnpm run test:vitest`
- `pnpm run test:server`
- `pnpm run test:spec:node`
- `pnpm run typecheck`

## 剩余风险

本次不改变用户可见路由、API URL、WebSocket message type 或文件 API 响应结构；浏览器布局仍依赖现有 e2e 回归覆盖。
不启动真实 HTTP/WebSocket 服务，不模拟真实浏览器 WebSocket 时序；完整 `test:server`、`test:spec:node` 和 `typecheck:test` 中的既有失败由后续专项提案处理。
