# 任务：Workflow 读模型与详情页边界重构

## 先跑契约测试

- [x] 1. 运行 `pnpm exec tsx --test docs/changes/10-Workflow读模型与详情页边界重构/tests/workflow-boundary.contract.test.ts`
- [x] 2. 确认失败来自 projection/view model 模块缺失或详情页过厚
- [x] 3. 运行 `pnpm exec tsx --test tests/specs/workflow-dag-read-model.spec.ts`
- [x] 4. 运行 `pnpm exec tsx --test tests/specs/wo-read-model-layering.spec.ts`
- [x] 5. 运行 `pnpm exec tsx --test tests/spec/workflow-presentation.spec.ts`
- [x] 6. 记录当前 workflow 详情页和 read model 热点函数

## 后端 projection

- [x] 7. 新建 `artifact-projection.ts`
- [x] 8. 新建 `session-projection.ts`
- [x] 9. 新建 `process-projection.ts`
- [x] 10. 新建 `diagnostics-projection.ts`
- [x] 11. 迁移 artifact 挂载规则
- [x] 12. 迁移 child session projection
- [x] 13. 迁移 runner process projection
- [x] 14. 迁移 diagnostics warning projection

## 前端 view model

- [x] 15. 新建 `workflowDetailViewModel.ts`
- [x] 16. 新建 `workflowStageTableViewModel.ts`
- [x] 17. 新建 `workflowArtifactLinks.ts`
- [x] 18. 迁移 visual progress 构造
- [x] 19. 迁移 continue/resume/abort 状态推断
- [x] 20. 迁移 session route option 构造

## UI 组件拆分

- [x] 21. 新建 `WorkflowStageTable.tsx`
- [x] 22. 新建 `WorkflowArtifactList.tsx`
- [x] 23. 新建 `WorkflowRunnerProcesses.tsx`
- [x] 24. 新建 `WorkflowDiagnosticsPanel.tsx`
- [x] 25. 新建 `WorkflowRoleSummary.tsx`
- [x] 26. 保持现有 data-testid 和可访问名称

## 兼容行为

- [x] 27. 保留 oz v1.2 七阶段读取
- [x] 28. 保留旧 run fallback 展示
- [x] 29. 保留 provider-aware child session 路由
- [x] 30. 保留 sessions-only 不伪造 process 的规则
- [x] 31. 保留 artifact 不存在时的可读提示
- [x] 32. 保留 workflow action dialog 现有 API

## 收尾验证

- [x] 33. 将 `WorkflowDetailView.tsx` 收敛为组合层
- [x] 34. 更新 `docs/specs/wo-workflow-read-model.md` 和 workflow 相关文档
- [x] 35. 运行 `pnpm run typecheck:web && pnpm run typecheck:node`
- [x] 36. 运行本提案 required tests 与关键 workflow browser/spec 回归
