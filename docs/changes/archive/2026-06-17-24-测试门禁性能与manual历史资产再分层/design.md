# 设计：测试门禁性能与manual历史资产再分层

## Timing profile

建议新增脚本：

```json
{
  "qa:test:timing:fast": "CBW_TEST_TIMING_PROFILE=fast tsx scripts/collect-test-timings.ts",
  "qa:test:timing:smoke": "CBW_TEST_TIMING_PROFILE=smoke tsx scripts/collect-test-timings.ts",
  "qa:test:timing:full": "CBW_TEST_TIMING_PROFILE=full tsx scripts/collect-test-timings.ts"
}
```

脚本按 profile 选择命令集合，并写入 `test-results/test-performance/<profile>.json`。失败命令必须保留非零退出码。

## Manual inventory

`docs/testing/manual-history-inventory.md` 每个 browser-history 文件使用标准状态：

- `人工保留`：需要真实环境、长链路、人工观察或历史审计。
- `已迁移`：当前业务门禁已由 spec/e2e/backend 覆盖。
- `默认门禁候选`：仍是当前业务风险，应该迁入默认门禁。
- `待删除`：已确认无当前或历史价值，需单独删除提案处理。

## 取舍

不在本提案中实际优化慢测试实现。先建立可度量 baseline 和资产分类，后续再按数据拆分或优化慢测试。

## 风险控制

契约测试检查 scripts、inventory 和 taxonomy；执行阶段需要真实运行至少 fast/smoke profile 生成 evidence。
