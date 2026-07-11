# 高价值模块重构与 CI 质量门规格

## 文件目的

记录聊天入口、消息面板、项目状态 hook 的长期边界，以及 GitHub CI `node-checks` 与本地质量门的同步要求，避免本次提案结束后边界再次膨胀。

## 模块边界

| 入口 | 职责 | focused module |
| --- | --- | --- |
| `ChatInterface.tsx` | 聊天页面编排 | `chatInterfaceSearchNavigation.ts`、`chatInterfaceStatusReconcile.ts` |
| `ChatMessagesPane.tsx` | 消息面板渲染入口 | `chatMessagesPaneLayoutController.ts` |
| `useProjectsState.ts` | 项目状态编排 | `projectsStateRefreshController.ts`、`projectsStateReducers.ts` |

入口文件不得新增 `@ts-nocheck`，复杂逻辑必须迁入 focused module 并保留默认测试覆盖。

## CI 质量门

GitHub 失败 run `28289064798` 的失败步骤为 `Node spec tests`。本地和 GitHub 必须共享 `test:ci` 语义：

```text
typecheck -> test:vitest -> test:server -> test:spec:node
```

`.github/workflows/ci.yml` 的 `node-checks` 必须使用 `.nvmrc`、`pnpm install --frozen-lockfile`，并运行 `pnpm run test:ci` 或等价命令；本地 pre-commit 钩子也必须使用同一入口，且不得修改暂存区。不得通过 skip、忽略错误或删除 Node spec tests 变绿。

## 默认测试

- `tests/specs/high-value-module-refactor.spec.ts`
- `tests/spec/ci-quality-gate-contract.ts`
- 提案合同测试位于 `docs/changes/34-重构高价值模块并修复CI/tests/`
