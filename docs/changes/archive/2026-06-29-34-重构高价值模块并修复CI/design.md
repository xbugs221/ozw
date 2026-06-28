# 设计：重构高价值模块并修复 CI

## 模块拆分原则

```text
入口文件
  |
  +-- 只保留组合、参数传递、渲染入口
  |
  +-- 业务规则进入 controller / reducer / runtime
        |
        +-- 可单测
        +-- 可被规格测试审计
        +-- 不反向依赖 UI 巨型组件
```

## 目标边界

| 入口 | 当前风险 | 目标 |
|---|---|---|
| `ChatInterface.tsx` | 会话状态、搜索定位、网络状态和 UI 接线混杂 | 降为聊天页面编排层 |
| `ChatMessagesPane.tsx` | 虚拟滚动、测量、历史提示和消息渲染集中 | 拆出虚拟窗口/历史 UI 控制 |
| `useProjectsState.ts` | 项目刷新、选择状态、会话索引和副作用集中 | 拆出刷新控制器和 reducer |
| `.github/workflows/ci.yml` | 远端质量门与本地脚本容易漂移 | 由 `test:ci` 或等价脚本锁定 |

## 建议新增模块

| 模块 | 业务目的 |
|---|---|
| `chatInterfaceSearchNavigation.ts` | 解析搜索目标、加载目标消息、触发定位 |
| `chatInterfaceStatusReconcile.ts` | 生成会话状态校准请求和去重 key |
| `chatMessagesPaneLayoutController.ts` | 管理可见消息窗口、测量、跟随底部策略 |
| `projectsStateRefreshController.ts` | 项目列表刷新、失效和 scoped 更新 |
| `projectsStateReducers.ts` | 项目选择、会话索引和 UI 状态 reducer |

执行阶段可以用等价命名，但必须满足契约测试中的业务职责和入口行数预算。

## CI 质量门

建议增加：

```text
pnpm run test:ci
  |
  +-- pnpm run typecheck
  +-- pnpm run test:vitest
  +-- pnpm run test:server
  +-- pnpm run test:spec:node
```

GitHub `node-checks` 可以拆步骤执行这些命令，或直接调用 `pnpm run test:ci`。无论采用哪种形式，package scripts 与 workflow 不得表达不同质量门。

## 风险和取舍

| 风险 | 处理 |
|---|---|
| 行数预算过硬导致机械拆分 | 契约同时要求职责模块和默认测试，不只看行数 |
| CI 远端失败无法在本地复现 | 必须记录 GitHub run 元数据，并用同入口本地命令收敛 |
| 当前工作区已有其他实现改动 | 提案执行时必须只改本提案范围，避免混入未提交书签实现 |
| 旧规格与新边界冲突 | 按编号更大的提案意图更新旧测试和 durable docs |
