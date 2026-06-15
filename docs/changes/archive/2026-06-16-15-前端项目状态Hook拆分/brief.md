# 简报：前端项目状态 Hook 拆分

## 用户问题

`frontend/hooks/useProjectsState.ts` 聚合了项目列表、会话集合、路由恢复、workflow child session、手动 `cN` 路由和刷新调度，文件超过 1700 行。项目导航是核心用户路径，继续堆在单个 hook 中会提高回归风险。

## 交付目标

把纯业务规则拆到可测试模块，hook 只负责 React state/effect 与 API 调用。保持项目工作区导航、旧 session 链接恢复、Provider 会话选择和 workflow child session 跳转行为不变。

## 非目标

不改 UI 布局，不改路由 URL，不改项目 API 响应字段。

## 验收入口

- `pnpm exec tsx --test docs/changes/15-前端项目状态Hook拆分/tests/project-state-hook-split.contract.test.ts`
- `pnpm run test:spec:browser`
- `pnpm exec tsx --test tests/spec/pi-provider-integration.spec.ts`

## 执行默认上下文

先抽纯函数和 reducer，再收敛 hook；拆分期间可以让旧 hook 继续作为唯一 public hook。
