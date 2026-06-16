# 任务：测试门禁性能与manual历史资产再分层

## 0. 契约基线

- [x] 1. 运行 `pnpm exec tsx --test docs/changes/24-测试门禁性能与manual历史资产再分层/tests/test-gate-performance-contract.acceptance.test.ts`，确认初始失败来自 timing profile 或 inventory 状态未标准化。
- [x] 2. 记录 `test-results/24-test-gate-performance/source-audit.json`。

## 1. Timing profile

- [x] 3. 扩展 `scripts/collect-test-timings.ts` 支持 `CBW_TEST_TIMING_PROFILE`。
- [x] 4. 定义 fast/smoke/full profile 命令集合。
- [x] 5. 新增 `qa:test:timing:fast`、`qa:test:timing:smoke`、`qa:test:timing:full` scripts。
- [x] 6. 确认失败命令仍导致非零退出。
- [x] 7. 运行 fast 和 smoke profile 生成 evidence。

## 2. Manual inventory

- [x] 8. 统一 `docs/testing/manual-history-inventory.md` 状态枚举。
- [x] 9. 确认每个 `tests/manual/browser-history/*.spec.ts` 都在清单中。
- [x] 10. 标出默认门禁候选并迁入 spec/e2e 或写明后续提案。
- [x] 11. 更新 `tests/README.md` 和测试 taxonomy 规格。

## 3. 回归

- [x] 12. 运行本提案契约测试。
- [x] 13. 运行 `pnpm run qa:test:timing:fast`。
- [x] 14. 运行 `pnpm run qa:test:timing:smoke`。
- [x] 15. 运行 `pnpm exec tsx --test tests/spec/test_suite_taxonomy.ts`。
- [x] 16. 运行 `pnpm run typecheck`。

## 执行记录

- `qa:test:timing:smoke` 已修复并重新运行，生成 `test-results/test-performance/smoke.json`，timing 脚本记录 `exitCode: 0`。
- 修复记录：Playwright smoke 已同步到当前 `/api/projects` 轻量列表 + `/overview` 详情合同；`pnpm run test:e2e:smoke` 为 12 passed。
