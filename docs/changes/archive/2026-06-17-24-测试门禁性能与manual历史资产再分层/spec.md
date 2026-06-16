# 规格：测试门禁性能与manual历史资产再分层

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence | 真实数据来源 | 入口路径 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 测试耗时必须支持 profile 化采集 | fast/smoke/full timing 可分别运行 | `contract-test-gate-performance` | `test-gate-fast-timing`, `test-gate-smoke-timing` | package scripts 和真实命令运行 | `scripts/collect-test-timings.ts` | profile scripts 存在，输出 profile JSON，失败不吞掉退出码 | full profile 耗时较长可合并前运行 |
| manual 历史资产必须标准化处置 | browser-history 每个文件有标准状态 | `contract-test-gate-performance`, `existing-test-suite-taxonomy` | `manual-history-inventory-audit` | tracked tests 和 docs | `docs/testing/manual-history-inventory.md` | 每个文件出现且状态属于标准枚举 | 状态正确性仍需人工判断 |
| 默认门禁不能缩水 | `pnpm test` 仍代表 full，迁移不能弱化业务覆盖 | `contract-test-gate-performance`, `existing-test-suite-taxonomy`, `root-typecheck` | `test-gate-regression-log` | package scripts 和测试分类规格 | `package.json`, `tests/README.md` | `pnpm test` 委托 full，taxonomy 通过 | 未直接证明所有慢测试必要性 |

### 需求：测试耗时必须支持 profile 化采集

#### 场景：fast/smoke/full timing 可分别运行

仓库必须提供 fast/smoke/full timing profile 脚本，`collect-test-timings.ts` 必须能根据 profile 选择命令集合并写入 profile 对应 JSON。

对应测试：`docs/changes/24-测试门禁性能与manual历史资产再分层/tests/test-gate-performance-contract.acceptance.test.ts`。

### 需求：manual 历史资产必须标准化处置

#### 场景：browser-history 每个文件有标准状态

`tests/manual/browser-history/*.spec.ts` 中每个文件必须在 manual history inventory 中出现，状态必须是 `人工保留`、`已迁移`、`默认门禁候选` 或 `待删除` 之一。

对应测试：`docs/changes/24-测试门禁性能与manual历史资产再分层/tests/test-gate-performance-contract.acceptance.test.ts` 和 `tests/spec/test_suite_taxonomy.ts`。

### 需求：默认门禁不能缩水

#### 场景：`pnpm test` 仍代表 full，迁移不能弱化业务覆盖

`pnpm test` 必须继续委托 full 测试入口。manual 迁移只能把当前业务风险迁入默认门禁，不能通过把用例留在 manual 来声称默认门禁已覆盖。

对应测试：`docs/changes/24-测试门禁性能与manual历史资产再分层/tests/test-gate-performance-contract.acceptance.test.ts`、`tests/spec/test_suite_taxonomy.ts`、`pnpm run typecheck`。
