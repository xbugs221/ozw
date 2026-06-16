# 24-测试门禁性能与manual历史资产再分层

## 用户问题

仓库已经有 `test:fast`、`test:smoke`、`test:full` 和 `qa:test:timing`，但测试资产规模仍大，`tests/manual` 历史回归很多。当前文档说明了 manual 不进默认门禁，却缺少可复查的 profile 化耗时基线和 manual 资产再分层合同，后续优化容易变成“删测试换速度”。

## 交付目标

建立测试门禁性能 profile 和 manual 历史资产再分层合同。执行完成后，开发者能分别采集 fast/smoke/full 耗时基线，manual browser-history 每个文件都有标准化处置状态，当前业务门禁候选必须迁入 spec/e2e 或明确保留原因。

## 非目标

- 不削弱 `pnpm test` 的完整保护。
- 不把真实业务测试替换为组件冒烟。
- 不删除 manual 历史资产，除非有明确迁移或废弃证据。
- 不引入新的测试框架。

## 验收入口

- `pnpm exec tsx --test docs/changes/24-测试门禁性能与manual历史资产再分层/tests/test-gate-performance-contract.acceptance.test.ts`
- `pnpm run qa:test:timing:fast`
- `pnpm run qa:test:timing:smoke`
- `pnpm exec tsx --test tests/spec/test_suite_taxonomy.ts`
- `pnpm run typecheck`

## 执行阶段默认上下文

先运行本提案契约测试。创建阶段预期失败来自 profile 化 timing scripts 或标准化 manual inventory 状态尚未实现，而不是测试语法或路径错误。
