# 提案：测试门禁性能与manual历史资产再分层

## 背景

ozw 的测试集已经按 backend/unit/spec/e2e/manual 分层，但长期维护还需要两个能力：第一，知道 fast/smoke/full 质量门的耗时趋势；第二，明确 manual 历史资产哪些已经迁移、哪些仍需人工保留、哪些是当前默认门禁候选。没有这两个合同，测试优化很容易变成不可审计的删减。

## 变更

1. 为 `qa:test:timing` 增加 fast/smoke/full profile 脚本。
2. 扩展 `scripts/collect-test-timings.ts`，支持 `CBW_TEST_TIMING_PROFILE` 或等价 profile 参数。
3. 标准化 `docs/testing/manual-history-inventory.md` 状态枚举。
4. 更新测试 taxonomy，确保 manual 历史资产处置和默认门禁边界一致。

## 验收标准

- 可以分别运行 fast/smoke/full timing profile，并输出 `test-results/test-performance/<profile>.json`。
- manual browser-history 文件都有标准化状态。
- 当前业务门禁候选不能只停留在 manual 中而没有迁移计划。
- `pnpm test` 仍指向完整测试入口。

## 风险

测试性能优化不能牺牲业务覆盖。执行阶段需要用耗时报告作为证据，而不是只调整脚本名称。
