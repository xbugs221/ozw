# 设计：前端项目状态 Hook 拆分

## 关键决策

1. public hook 不改名。

调用方继续从 `frontend/hooks/useProjectsState.ts` 使用同一入口，降低迁移影响面。

2. 路由解析先做纯函数。

`resolveRouteSelection`、manual route index、workflow child session 查找应从 hook 中移出，便于用真实 `Project` read model 测试。

3. 刷新 merge 使用 reducer 风格。

项目 summary、overview、Provider session change 和 scoped invalidation 的 merge 规则放入独立模块，减少 effect 中的隐式状态修改。

## 风险

- 旧 session URL 和 workflow child session 都有兼容分支，拆分时容易改变优先级。
- 浏览器本地状态和 URL query 共同参与选择，必须保留历史恢复规则。

## 取舍

不拆 UI 组件，不引入新状态管理库；只把已有业务规则从 React hook 中剥离。
