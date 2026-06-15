# 提案：Workflow 读模型与详情页边界重构

## 背景

Workflow 是 ozw 区分普通聊天工具的核心能力。当前实现已经支持 DAG、七阶段状态、planner/execute/review 子会话、artifact、runner processes 和 UI 路由，但这些规则分布在大 read model 和大 React 视图里，难以判断一次改动影响哪类用户路径。

## 变更内容

新增后端 projection：

```
backend/domains/workflows/read-model/
├─ artifact-projection.ts
├─ session-projection.ts
├─ process-projection.ts
└─ diagnostics-projection.ts
```

新增前端 workflow detail 边界：

```
frontend/components/main-content/workflow-detail/
├─ workflowDetailViewModel.ts
├─ workflowStageTableViewModel.ts
├─ workflowArtifactLinks.ts
├─ WorkflowStageTable.tsx
├─ WorkflowArtifactList.tsx
└─ WorkflowRunnerProcesses.tsx
```

## 成功标准

- 后端 read model 输出字段保持兼容。
- `WorkflowDetailView.tsx` 只负责组合 view model 和组件。
- 七阶段状态、artifact 挂载、child session 路由和 runner process 语义各自有测试。
- 历史 run fallback 和 provider-aware child session 不回退。
- workflow 详情页截图和 trace 能证明 UI 行为稳定。
