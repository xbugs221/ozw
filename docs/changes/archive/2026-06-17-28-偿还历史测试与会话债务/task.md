# 任务：偿还历史测试与会话债务

## 1. 先运行创建阶段契约测试

- [x] 运行 `pnpm exec tsx --test docs/changes/28-偿还历史测试与会话债务/tests/*.test.ts`
- [x] 确认失败原因是当前历史债务入口仍未通过，或 manual 历史资产仍未妥善处置
- [x] 不得通过删除、跳过、排除或放宽契约测试让红灯变绿

## 2. P0 修复类型债务

- [x] 复现 `pnpm run typecheck` 失败
- [x] 修复 `react-syntax-highlighter` 类型声明或依赖类型问题
- [x] 修复 `tests/specs/project-index-db-backed.spec.ts` 的测试类型问题
- [x] 跑通 `pnpm run typecheck`

## 3. P0 修复后端历史合同

- [x] 复现 `pnpm run test:server` 失败清单
- [x] 修复 Codex JSONL/read model 的 cursor、工具卡、phase metadata 和首页摘要合同
- [x] 修复 project discovery/archive/delete 中 Provider-only、临时项目和缺失项目归档合同
- [x] 修复 session rename/manual route/delete/finalize 中 Codex、Pi 和 Claude 移除合同
- [x] 跑通 `pnpm run test:server`

## 4. P0 修复 Node spec 历史合同

- [x] 复现 `pnpm run test:spec:node` 失败清单
- [x] 修复或按最新意图更新 conf v2 和 project chat config v2 合同
- [x] 修复 timing profile 合同，使脚本和规格一致
- [x] 更新相关 durable specs，说明哪些旧断言按 28 号意图调整
- [x] 跑通 `pnpm run test:spec:node`

## 5. P1 处置 manual/browser-history 历史资产

- [x] 审计 `tests/manual/browser-history/*`
- [x] 将可稳定自动化的当前业务风险迁入 `tests/spec` 或 `tests/e2e`
- [x] 对必须人工保留的资产补充当前业务价值、运行前置条件和 evidence 路径
- [x] 删除或标记待删除无当前 Provider 价值的旧资产
- [x] 更新 `docs/testing/manual-history-inventory.md`

## 6. 保持 27 号提案意图

- [x] 运行 `pnpm exec tsx --test docs/changes/archive/2026-06-17-27-重构高风险核心模块/tests/*.test.ts`
- [x] 确认 Project overview、Chat runtime、Backend server 边界仍保持拆分
- [x] 若旧测试与新意图冲突，只能按编号更大的提案同步更新测试和文档，不得静默绕过

## 7. 最终验证

- [x] `pnpm run typecheck`
- [x] `pnpm run test:server`
- [x] `pnpm run test:spec:node`
- [x] `pnpm exec tsx --test docs/changes/28-偿还历史测试与会话债务/tests/*.test.ts`
- [x] `oz validate 28-偿还历史测试与会话债务 --json`
