# 规格：前端项目状态 Hook 拆分

## 验收矩阵

| 场景 | required_tests | required_evidence |
| --- | --- | --- |
| 项目路由选择规则从 hook 中移出并可测试 | project-state-hook-split | project-state-source-audit |
| 项目刷新和会话集合规则保持用户路径稳定 | project-state-hook-split, project-navigation-regressions | project-state-source-audit |

### 需求：项目路由选择规则必须可独立测试

#### 场景：项目路由选择规则从 hook 中移出并可测试

- 对应测试：`docs/changes/15-前端项目状态Hook拆分/tests/project-state-hook-split.contract.test.ts`
- 真实数据来源：生产 `Project` 类型、`useProjectsState.ts` 和拆分后的 route selection 模块
- 入口路径：`frontend/hooks/useProjectsState.ts`
- 关键断言：存在 `projectRouteSelection.ts`；hook 导入该模块；旧 `/session/:id`、`cN` 和 workflow child session 解析规则不再直接堆在 hook 主体中
- 剩余风险：静态源码测试不能证明浏览器历史栈行为，需要 browser spec 补充

### 需求：项目刷新和会话集合规则保持用户路径稳定

#### 场景：项目刷新和会话集合规则保持用户路径稳定

- 对应测试：`docs/changes/15-前端项目状态Hook拆分/tests/project-state-hook-split.contract.test.ts`、`tests/spec/project-workspace-navigation.spec.ts`
- 真实数据来源：生产项目 read model、Pi/Codex 会话样例和浏览器导航测试
- 入口路径：`frontend/hooks/projects/projectRefreshReducer.ts`
- 关键断言：项目 summary/overview merge、Provider session 集合和 scoped invalidation 规则位于独立模块；hook public return shape 不变
- 剩余风险：真实用户本地 localStorage 的历史组合需要手工抽样验证
