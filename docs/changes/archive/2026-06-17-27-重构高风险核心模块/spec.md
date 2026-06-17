# 规格：重构高风险核心模块

## 验收矩阵

| 优先级 | 需求 / 场景 | required_tests | required_evidence | 剩余风险 |
| --- | --- | --- | --- | --- |
| P0 | Project overview 组合层瘦身 / 总览页面拆成 view model、workflow groups、session cards 和 actions | `change-project-overview-refactor` | 无 | 不验证真实浏览器布局 |
| P0 | Chat runtime hook 瘦身 / session、composer、realtime 业务规则迁到控制器 | `change-chat-runtime-refactor` | 无 | 不覆盖真实 WebSocket 时序 |
| P1 | Backend server 边界瘦身 / bootstrap、dispatcher、file routes 降为装配层 | `change-backend-boundary-refactor` | 无 | 不启动真实 HTTP/WebSocket 服务 |
| P1 | 测试和文档同步 / 默认测试和 durable docs 覆盖新边界 | `change-refactor-tests-docs` | 无 | 不证明完整浏览器 e2e 已覆盖 |

### 需求：P0 Project overview 组合层必须瘦身

#### 场景：总览页面拆成 view model、workflow groups、session cards 和 actions

- **测试文件**：`docs/changes/27-重构高风险核心模块/tests/project-overview-refactor-contract.test.ts`
- **真实数据来源**：仓库真实 `ProjectOverviewPanel.tsx` 和执行阶段新增的 `frontend/components/main-content/project-overview/*` 模块。
- **入口路径**：`ProjectOverviewPanel.tsx`、`projectOverviewViewModel.ts`、`ProjectOverviewWorkflowGroups.tsx`、`ProjectOverviewSessionCards.tsx`、`ProjectOverviewActions.tsx`
- **关键断言**：
  - `ProjectOverviewPanel.tsx` 不超过 700 行。
  - 新 project overview 模块存在并说明业务目的。
  - `ProjectOverviewPanel.tsx` 导入这些模块，而不是继续内联大段业务逻辑。
  - 页面文件不再手写内联 SVG icon 组件。
- **剩余风险**：不检查像素级布局；需要配合现有项目页面 e2e。

### 需求：P0 Chat runtime hook 必须拆出可单测控制器

#### 场景：session、composer、realtime 业务规则迁到控制器

- **测试文件**：`docs/changes/27-重构高风险核心模块/tests/chat-runtime-refactor-contract.test.ts`
- **真实数据来源**：仓库真实 chat hook 源码和执行阶段新增的 chat session/composer/realtime 控制器模块。
- **入口路径**：`useChatSessionStateImpl.ts`、`useChatComposerStateImpl.ts`、`useChatRealtimeHandlersImpl.ts`、`chatSessionLifecycleController.ts`、`composerSubmitRuntime.ts`、`chatRealtimeEventRouter.ts`、`streamingMessageController.ts`
- **关键断言**：
  - 三个核心 hook 分别低于行数预算。
  - session lifecycle、submit runtime、realtime routing 和 streaming merge 都有独立模块和导出入口。
  - hook 源码导入控制器模块。
  - `reloadCodexSessionMessages`、`appendStreamingChunk`、`finalizeStreamingMessage` 不再作为 hook 文件私有重逻辑存在。
- **剩余风险**：不模拟真实浏览器 WebSocket；执行阶段应补 `tests/unit/chat-runtime-controllers.test.ts`。

### 需求：P1 Backend server 边界必须降为装配层

#### 场景：bootstrap、dispatcher、file routes 降为装配层

- **测试文件**：`docs/changes/27-重构高风险核心模块/tests/backend-boundary-refactor-contract.test.ts`
- **真实数据来源**：仓库真实后端 server 源码和执行阶段新增的 `backend/server/realtime/*`、`backend/server/files/*` 模块。
- **入口路径**：`server-bootstrap.ts`、`chat-command-dispatcher.ts`、`file-routes.ts`、`chat-client-scope-store.ts`、`chat-command-router.ts`、`file-route-helpers.ts`、`file-tree-routes.ts`、`file-mutation-routes.ts`、`file-download-routes.ts`
- **关键断言**：
  - `server-bootstrap.ts`、`chat-command-dispatcher.ts`、`file-routes.ts` 降到行数预算内。
  - client scope store、command router 和 file route 子模块存在并导出业务入口。
  - `server-bootstrap.ts` 不再直接拥有文件分类、chat request id 或 URL auto-open helper 的重逻辑。
- **剩余风险**：不启动真实服务；执行阶段应补 `tests/backend/server-boundary-refactor.test.ts`。

### 需求：P1 测试和文档必须同步更新

#### 场景：默认测试和 durable docs 覆盖新边界

- **测试文件**：`docs/changes/27-重构高风险核心模块/tests/refactor-tests-docs-contract.test.ts`
- **真实数据来源**：执行阶段新增的默认测试文件和 `docs/specs/high-risk-module-refactor.md`。
- **入口路径**：`tests/unit/project-overview-view-model.test.ts`、`tests/unit/chat-runtime-controllers.test.ts`、`tests/backend/server-boundary-refactor.test.ts`、`tests/specs/high-risk-module-refactor.spec.ts`、`docs/specs/high-risk-module-refactor.md`
- **关键断言**：
  - 默认测试文件存在并引用真实源码模块。
  - durable spec 说明三条重构主线、运行命令和剩余风险。
  - spec 不只描述结构，还说明用户风险和测试入口。
- **剩余风险**：不要求执行完整 e2e；是否补浏览器回归由执行阶段按影响面判断。
