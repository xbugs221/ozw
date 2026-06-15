# 规格：历史口径文档与测试资产收敛

## 验收矩阵

| 场景 | required_tests | required_evidence |
| --- | --- | --- |
| 活跃文档使用当前 Provider 口径 | `legacy-wording-boundary-contract` | `legacy-wording-audit` |
| 测试文件名和标题不误导维护者 | `test-asset-naming-contract` | `test-asset-audit` |
| manual/browser-history 资产完成处置 | `manual-history-asset-contract` | `manual-history-inventory` |

### 需求：活跃文档不再传播旧 Provider 口径

#### 场景：活跃文档使用当前 Provider 口径

- **给定** 当前 Codex 主路径是 app-server，Pi 主路径是 native SDK
- **当** 开发者搜索 active docs 和生产源码
- **则** 不得看到 Codex 当前路径被称为 Codex SDK Thread/runStreamed
- **并且** 不得看到 manual chat 当前路径被称为 co 文件协议
- **测试文件**：`docs/changes/7-历史口径文档与测试资产收敛/tests/legacy-wording-assets.contract.test.ts`
- **真实数据来源**：真实源码、active docs、package scripts
- **入口路径**：源码/文档全文审计
- **关键断言**：active docs 禁止旧口径；archive 和否定断言允许
- **剩余风险**：历史 archive 保留原始事实

### 需求：测试资产命名与当前行为一致

#### 场景：测试文件名和标题不误导维护者

- **给定** 当前测试覆盖的是 Codex app-server 与 Pi SDK
- **当** 开发者查看测试文件名、test 标题和文件头 PURPOSE
- **则** 名称必须反映当前主路径
- **并且** 旧 `native-sdk` 文件名不得继续用于 Codex app-server 测试
- **测试文件**：`docs/changes/7-历史口径文档与测试资产收敛/tests/legacy-wording-assets.contract.test.ts`
- **真实数据来源**：真实 `tests/` 源码
- **入口路径**：测试资产命名审计
- **关键断言**：误导性文件名被重命名；标题和 PURPOSE 同步
- **剩余风险**：少数第三方名词按原文保留

### 需求：旧测试资产完成归类

#### 场景：manual/browser-history 资产完成处置

- **给定** `tests/manual/browser-history` 中存在历史 browser 规格
- **当** 执行本提案后
- **则** 每个资产必须被迁移、保留并说明原因、或删除
- **并且** 当前主回归 README 必须说明 manual/browser-history 不作为默认门禁
- **测试文件**：`docs/changes/7-历史口径文档与测试资产收敛/tests/legacy-wording-assets.contract.test.ts`
- **真实数据来源**：真实测试目录和 README
- **入口路径**：测试资产 inventory 审计
- **关键断言**：有 inventory 文件；每个 manual/browser-history spec 有处置结果；有价值测试迁移到当前结构
- **剩余风险**：无法判断价值的资产需要用户确认后再删
