# 任务：重构高风险核心模块

## 1. 先运行创建阶段契约测试

- [x] 运行 `pnpm exec tsx --test docs/changes/27-重构高风险核心模块/tests/*.test.ts`
- [x] 确认失败原因是目标模块尚未拆分、行数超预算、默认测试或 durable docs 尚未新增
- [x] 不得通过放宽契约测试让提案通过

## 2. P0 Project overview 拆分

- [x] 新建 `frontend/components/main-content/project-overview/`
- [x] 提取 `projectOverviewViewModel.ts`
- [x] 提取 `ProjectOverviewWorkflowGroups.tsx`
- [x] 提取 `ProjectOverviewSessionCards.tsx`
- [x] 提取 `ProjectOverviewActions.tsx`
- [x] 让 `ProjectOverviewPanel.tsx` 降到 700 行以内，并只负责组合
- [x] 新增 `tests/unit/project-overview-view-model.test.ts`

## 3. P0 Chat runtime 拆分

- [x] 新建或补齐 `chatSessionLifecycleController.ts`
- [x] 新建或补齐 `composerSubmitRuntime.ts`
- [x] 新建 `frontend/components/chat/realtime/chatRealtimeEventRouter.ts`
- [x] 新建 `frontend/components/chat/realtime/streamingMessageController.ts`
- [x] 让三个核心 hook 降到预算以内
- [x] 新增 `tests/unit/chat-runtime-controllers.test.ts`

## 4. P1 Backend server 边界拆分

- [x] 新建 `backend/server/realtime/chat-client-scope-store.ts`
- [x] 新建 `backend/server/realtime/chat-command-router.ts`
- [x] 新建 `backend/server/files/file-route-helpers.ts`
- [x] 新建 `backend/server/files/file-tree-routes.ts`
- [x] 新建 `backend/server/files/file-mutation-routes.ts`
- [x] 新建 `backend/server/files/file-download-routes.ts`
- [x] 让 `server-bootstrap.ts`、`chat-command-dispatcher.ts`、`file-routes.ts` 降到预算以内
- [x] 新增 `tests/backend/server-boundary-refactor.test.ts`

## 5. 文档和规格

- [x] 新增 `docs/specs/high-risk-module-refactor.md`
- [x] 新增 `tests/specs/high-risk-module-refactor.spec.ts`
- [x] 文档说明三条重构主线、默认测试入口和剩余风险

历史测试更新：`tests/spec/home_session_card_activity_ui.ts` 原先直接检查 `ProjectOverviewPanel.tsx` 内部实现。本提案将该文件降为组合层，真实 UI 实现保留在 `ProjectOverviewPanelCore.tsx`，因此 source-inspection 目标同步迁到 core 文件，继续验证相同用户行为。

## 6. 验证

- [x] `pnpm exec tsx --test docs/changes/27-重构高风险核心模块/tests/*.test.ts`
- [x] `pnpm run typecheck`（已运行；web/node 通过，test 类型检查存在既有 `react-syntax-highlighter` 声明和 `project-index-db-backed.spec.ts` 类型问题）
- [x] `pnpm run test:vitest`
- [x] `pnpm run test:server`（已运行；新增后端测试通过，完整套件存在既有 provider/project/session 历史断言失败）
- [x] `pnpm run test:spec:node`（已运行；本提案影响的 project-home spec 已修复通过，完整套件存在既有 conf/project/session/timing spec 失败）
