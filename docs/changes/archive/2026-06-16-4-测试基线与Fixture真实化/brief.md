# 简报：测试基线与 Fixture 真实化

## 用户问题

`typecheck:test` 目前不能作为可信合并门禁，Codex fixture discovery 也存在历史失败。多个 Playwright/spec 文件各自复制 FakeWebSocket、Codex JSONL 写入和 provider event 构造，导致修复聊天实时渲染时必须反复处理夹具差异。

## 交付目标

把测试类型基线、Codex JSONL fixture、provider WebSocket harness 和关键 browser spec 的 fixture discovery 收敛成共享能力，让后续 Provider 与聊天 UI 变更能依赖稳定测试地基。

## 非目标

- 不修改真实 Codex/Pi 外部服务行为
- 不引入新的测试框架
- 不把所有测试一次性迁移到 strict
- 不要求 `test-results/` 进入 git

## 验收入口

- 契约测试：`pnpm exec tsx --test docs/changes/4-测试基线与Fixture真实化/tests/test-baseline-and-fixtures.contract.test.ts`
- 回归命令：`pnpm run typecheck && pnpm run test:spec`

## 执行默认上下文

优先保留现有测试目录分工：`tests/spec` 继续覆盖 browser spec 与 node spec，`tests/e2e` 继续覆盖完整用户流。重构测试夹具时应让失败诊断更清楚，而不是只隐藏现有错误。
