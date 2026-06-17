# 设计：重构高风险核心模块

## 总体策略

本次重构采用“组合层瘦身 + 控制器/视图模型提取 + 默认测试补齐”的方式。先把业务决策迁到可单测模块，再让原组件或 hook 只负责组合和生命周期接线。

```text
ProjectOverviewPanel.tsx
  -> project-overview/projectOverviewViewModel.ts
  -> project-overview/ProjectOverviewWorkflowGroups.tsx
  -> project-overview/ProjectOverviewSessionCards.tsx
  -> project-overview/ProjectOverviewActions.tsx

chat hooks
  -> session/chatSessionLifecycleController.ts
  -> composer/composerSubmitRuntime.ts
  -> realtime/chatRealtimeEventRouter.ts
  -> realtime/streamingMessageController.ts

backend server boundary
  -> realtime/chat-client-scope-store.ts
  -> realtime/chat-command-router.ts
  -> files/file-route-helpers.ts
  -> files/file-tree-routes.ts
  -> files/file-mutation-routes.ts
  -> files/file-download-routes.ts
```

## 关键决策

### Project overview 保留页面组合层

`ProjectOverviewPanel.tsx` 应继续作为页面组合入口，但不再直接承载 workflow 分组、manual session card 选择、会话操作选择和长按/排序规则。业务数据投影进入 `projectOverviewViewModel.ts`，可视区域拆成小组件。

### Chat hook 拆成控制器

三个 hook 的 React 生命周期保持在 hook 内，纯业务规则迁到控制器：

- session lifecycle：加载计划、可见消息窗口、恢复和重载结果。
- composer submit runtime：提交前校验、pending user message、请求上下文、断线提示。
- realtime event router：运行态事件分类、session queue、streaming chunk 和最终消息合并。

这样可以用 `tests/unit` 验证行为，而不是只能通过 e2e 观察。

### 后端边界拆分不改变协议

`server-bootstrap.ts` 只做依赖注入、生命周期和网关装配。`chat-command-dispatcher.ts` 继续保留对外创建函数，但具体命令路由和 client scope store 独立。`file-routes.ts` 继续保留注册入口，但 tree、mutation、download 和 helper 拆分到 `backend/server/files/`。

## 风险控制

- 每次拆分后先跑对应新增 unit/backend 测试，再跑 typecheck。
- 不同时改业务语义和 UI 文案。
- 对外入口函数名尽量保持兼容，让调用点逐步迁移。
- 创建阶段契约测试采用源码边界检查，执行阶段必须用真实默认测试覆盖行为语义。
