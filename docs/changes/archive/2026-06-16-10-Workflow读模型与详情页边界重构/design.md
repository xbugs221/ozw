# 设计：Workflow 读模型与详情页边界重构

## 决策

1. 后端先抽 projection 纯函数，不改变 `buildWorkflowReadModel` 对外响应。
2. 前端先抽 view model，再拆 UI 组件，避免组件直接理解所有 read model 细节。
3. 七阶段状态和 legacy fallback 使用同一 view model 输出，减少 UI 分支。
4. artifact link 和 session route link 作为独立 utility，便于浏览器测试验证。

## 取舍

本提案不把 workflow 全部迁入新状态管理框架。当前主要问题是边界和测试可见性，保留 React 局部状态更符合低风险迁移。

## 风险

- artifact 挂载规则兼容历史目录和 oz v1.2 七阶段，容易误删 fallback。
- runner process 与 role session 不能混淆，否则 UI 会把 session id 当 pid。
- provider-aware child session 点击路径必须保持 provider 参数。

## 验证策略

用源码边界测试锁住拆分结果，用现有 workflow DAG/read-model/presentation specs 验证业务行为，用浏览器 e2e 保存详情页截图和 trace。
