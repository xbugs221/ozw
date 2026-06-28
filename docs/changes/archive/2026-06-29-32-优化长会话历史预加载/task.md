# 任务：优化长会话历史预加载

## 创建阶段验证记录

| 命令 | 结果 |
| --- | --- |
| `oz validate 32-优化长会话历史预加载 --json` | 通过 |
| `pnpm exec playwright test docs/changes/32-优化长会话历史预加载/tests/history-prefetch.acceptance.spec.ts --config=docs/changes/32-优化长会话历史预加载/playwright.config.ts` | 预期失败：`scrollTop > 100` 时没有等到更早页请求 |

## 执行阶段验证记录

| 命令 | 结果 |
| --- | --- |
| `pnpm exec playwright test docs/changes/32-优化长会话历史预加载/tests/history-prefetch.acceptance.spec.ts --config=docs/changes/32-优化长会话历史预加载/playwright.config.ts` | 通过 |
| `pnpm exec playwright test tests/e2e/history-scroll-preservation.spec.ts` | 通过：9 passed |
| `pnpm exec tsx --test tests/specs/session-incremental-read.spec.ts` | 通过：2 passed |
| `pnpm exec tsx --test tests/specs/chat-performance-boundary.spec.ts` | 通过：5 passed |
| `pnpm exec tsc --noEmit -p tsconfig.test.json` | 通过 |
| `oz flow run-acceptance --change 32-优化长会话历史预加载 --json` | 通过：4/4 required_tests，3/3 required_evidence |

## 1. 先跑创建阶段合同

- [x] 运行 `pnpm exec playwright test docs/changes/32-优化长会话历史预加载/tests/history-prefetch.acceptance.spec.ts --config=docs/changes/32-优化长会话历史预加载/playwright.config.ts`
- [x] 确认旧实现预期失败点是：`scrollTop > 100` 时没有提前发起更早页请求
- [x] 若失败于认证、夹具、路径或测试语法，先修合同测试，不进入实现

## 2. 梳理现有链路

- [x] 记录 `sessionRuntimeController` 中滚动事件、加载锁、`messagesOffsetRef` 和滚动锚点的协作方式
- [x] 确认后端 `/messages` 响应中的 `nextRawLineOffset` 仍是前端分页 cursor 来源
- [x] 确认 `ChatMessagesPane` 的虚拟列表窗口上限不需要放宽

## 3. 实现前端预加载

- [x] 将历史预加载判断抽成小型纯函数或等价可测逻辑
- [x] 用视口相关的预加载距离替换只在顶部附近触发的硬阈值
- [x] 保留加载中保护，避免同一 offset 重复请求
- [x] 保留 prepend 前后的滚动锚点恢复
- [x] 保留初始加载最新分页和显式“加载全部”入口的区别

## 4. 补根目录回归

- [x] 将提案合同测试中的关键场景迁移或复用到 `tests/e2e/history-scroll-preservation.spec.ts`
- [x] 如抽出纯函数，增加 `tests/unit/` 或 `tests/specs/` 中的边界测试
- [x] 不删除、不弱化本提案 `tests/` 下的合同测试

## 5. 验证

- [x] 运行合同测试并保存截图、network 和 trace 证据
- [x] 运行 `pnpm exec playwright test tests/e2e/history-scroll-preservation.spec.ts`
- [x] 运行 `pnpm exec tsx --test tests/specs/session-incremental-read.spec.ts`
- [x] 运行 `pnpm exec tsx --test tests/specs/chat-performance-boundary.spec.ts`
- [x] 运行必要的 TypeScript 检查

## 6. 交付

- [x] 更新 `docs/specs/session-incremental-read.md` 或新增持久规格，记录预加载体验契约
- [x] 确认 `acceptance.json` 保持原合同结构，验证结果记录在本文件
- [x] 提供复查 URL、截图、network、trace 和测试命令结果

## 7. 验收证据路径修复

- [x] 将 trace evidence 从目录路径修正为稳定 zip 文件路径
- [x] 合同测试显式输出 `test-results/32-history-prefetch/playwright/history-prefetch-trace.zip`
- [x] 重跑 `oz flow run-acceptance --change 32-优化长会话历史预加载 --json` 并通过
