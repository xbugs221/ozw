# 简报：Workflow 读模型与详情页边界重构

## 用户问题

Workflow 详情链路横跨后端 oz flow read model、DAG/status summary、前端详情页、artifact/session 路由和操作按钮。当前 `WorkflowDetailView.tsx` 约一千六百行，后端 read model 也存在大文件，状态推断和渲染混在一起，后续改 workflow 阶段或 artifact 规则风险较高。

## 交付目标

拆分 workflow 后端 projection、前端 view model 和 UI 组件，让七阶段状态、artifact、child session、runner process、diagnostics 和 continue 操作都能单独验证。

## 非目标

不改变 oz flow 文件格式，不改变 workflow API URL，不移除历史 run fallback，不重写工作流启动流程。

## 验收入口

- `pnpm exec tsx --test docs/changes/10-Workflow读模型与详情页边界重构/tests/workflow-boundary.contract.test.ts`
- `pnpm exec tsx --test tests/specs/workflow-dag-read-model.spec.ts tests/specs/wo-read-model-layering.spec.ts tests/spec/workflow-presentation.spec.ts`
- `pnpm exec tsx --test tests/spec/project-workflow-control-plane.spec.ts tests/spec/project-workflow-child-session-isolation.spec.ts`

## 执行默认上下文

先读取 `backend/domains/workflows/read-model/*`、`frontend/components/main-content/view/subcomponents/WorkflowDetailView.tsx`、`docs/specs/wo-workflow-read-model.md` 和 workflow 相关规格测试。先保留现有行为，再逐步拆 projection 与 view model。
