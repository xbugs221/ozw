# 简报：重构高风险核心模块

## 用户问题

仓库中仍有若干高风险、高价值模块承载过多职责。典型例子包括：

- `ProjectOverviewPanel.tsx` 同时负责项目总览布局、会话卡片、workflow 分组、操作入口和部分排序规则。
- `useChatSessionStateImpl.ts`、`useChatComposerStateImpl.ts`、`useChatRealtimeHandlersImpl.ts` 仍是聊天页最核心的长 hook，承载 session 加载、提交、实时事件和状态协调。
- `server-bootstrap.ts`、`chat-command-dispatcher.ts`、`file-routes.ts` 仍处于启动装配、协议分发和文件 API 边界的高风险区。

这些模块一旦继续膨胀，后续修复会话路由、workflow 展示、聊天实时状态或后端边界时，改动影响面会很难判断。

## 交付目标

按风险和价值拆分三条主线：

1. P0：拆分 `ProjectOverviewPanel.tsx`，把 project overview 的会话卡片、workflow 分组和操作入口迁到明确模块。
2. P0：拆分聊天核心 hook，把 session lifecycle、composer submit runtime、realtime event routing 和 streaming merge 迁到可单测控制器。
3. P1：拆分后端启动和边界模块，把 chat client scope、chat command routing、file tree/mutation/download/helper 从巨型文件中抽出。

执行阶段必须同步更新默认测试和 durable docs，不能只搬代码。

## 非目标

- 不改变用户可见功能和路由。
- 不重写 UI 样式。
- 不引入新状态管理库或新测试框架。
- 不把上一个提案 `26-补齐低状态业务测试覆盖` 的补测任务合并进本提案；本提案可依赖其思路，但目标是重构模块边界。

## 验收入口

创建阶段契约测试：

```bash
pnpm exec tsx --test docs/changes/27-重构高风险核心模块/tests/*.test.ts
```

这些测试预计在创建后失败，失败原因应是目标拆分尚未完成。

执行阶段最终回归：

```bash
pnpm run typecheck
pnpm run test:vitest
pnpm run test:server
pnpm run test:spec:node
```

## 执行阶段默认上下文

执行器应先读本目录 `spec.md`、`design.md`、`acceptance.json` 和 `tests/`。优先让创建阶段契约测试从“目标模块缺失/行数超预算”失败，推进到全部通过；再运行默认测试入口。
