# 任务：前端项目状态 Hook 拆分

## 1. 先运行创建阶段契约测试

- [x] 运行 `pnpm exec tsx --test docs/changes/15-前端项目状态Hook拆分/tests/project-state-hook-split.contract.test.ts`
- [x] 确认初始失败来自拆分模块缺失或 hook 体量/职责仍过大

## 2. 抽出纯业务模块

- [x] 新建 `projectRouteSelection.ts`
- [x] 新建 `projectSessionCollections.ts`
- [x] 新建 `projectRefreshReducer.ts`

## 3. 收敛 hook 职责

- [x] `useProjectsState.ts` 只保留 React state/effect、API 调用和 public return shape
- [x] 移除重复 route regex 和集合 merge 逻辑

## 4. 回归导航用户路径

- [x] 运行项目导航、Pi provider 和 browser spec 回归
- [x] 人工检查旧 `/session/:id`、手动 `cN`、workflow child session 跳转
