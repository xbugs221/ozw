# 提案：前端项目状态 Hook 拆分

## 为什么现在做

项目状态 hook 是首页、工作区、聊天和 workflow 导航的共同控制点。它已经包含大量可独立测试的业务规则，如果继续增长，任何项目刷新或路由修复都会变成高风险改动。

## 做什么

- 新增 `frontend/hooks/projects/projectRouteSelection.ts`，承载 pathname/query 到 project/session/workflow 的解析。
- 新增 `frontend/hooks/projects/projectSessionCollections.ts`，承载 `codexSessions`、`piSessions`、manual draft 和 workflow child session 的集合规则。
- 新增 `frontend/hooks/projects/projectRefreshReducer.ts`，承载项目 summary/overview merge 和刷新事件规约。
- `useProjectsState.ts` 作为组合 hook，保留 public return shape。

## 可观察结果

项目导航规则可以用 Node spec 测试覆盖，hook 文件体量下降；旧 `/session/:id`、`cN` 手动会话和 workflow child session 跳转仍可用。
