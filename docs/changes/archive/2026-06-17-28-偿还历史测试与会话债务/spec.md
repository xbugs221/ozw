# 规格：偿还历史测试与会话债务

## 验收矩阵

| 优先级 | 需求 / 场景 | required_tests | required_evidence | 剩余风险 |
| --- | --- | --- | --- | --- |
| P0 | 完整类型与 Node 门禁必须转绿 / 类型、后端和 Node spec 历史失败全部修复 | `historical-debt-gates-pass` | `historical-debt-command-log` | 不覆盖浏览器像素布局 |
| P0 | 执行器不得用跳过或排除测试偿债 / 默认脚本和测试源码不得新增偷懒绕过 | `no-debt-shortcuts` | 无 | 静态检查不能证明所有断言语义充分 |
| P1 | manual browser-history 资产必须处置 / 自动化、人工保留和删除状态必须可复查 | `manual-history-disposition` | `manual-history-disposition-snapshot` | 真实 Provider 长链路仍可能保留为人工 |
| P1 | 不得违背 27 号最新边界意图 / 高风险模块拆分合同继续有效 | `latest-intent-precedence` | 无 | 不单独验证浏览器 WebSocket 时序 |

### 需求：完整类型与 Node 门禁必须转绿

#### 场景：类型、后端和 Node spec 历史失败全部修复

- **测试文件**：`docs/changes/28-偿还历史测试与会话债务/tests/historical-debt-gates-contract.test.ts`
- **真实数据来源**：仓库真实 `package.json` 脚本、真实 TypeScript 配置、真实后端和 Node spec 测试。
- **入口路径**：`pnpm run typecheck`、`pnpm run test:server`、`pnpm run test:spec:node`
- **关键断言**：
  - `pnpm run typecheck` 退出码为 0。
  - `pnpm run test:server` 退出码为 0。
  - `pnpm run test:spec:node` 退出码为 0。
  - 命令输出写入 `test-results/historical-debt/command-results.json`，便于审阅失败原因。
- **剩余风险**：不执行浏览器 spec；浏览器覆盖由 manual 资产处置和现有 e2e/spec 入口补充。

### 需求：执行器不得用跳过或排除测试偿债

#### 场景：默认脚本和测试源码不得新增偷懒绕过

- **测试文件**：`docs/changes/28-偿还历史测试与会话债务/tests/historical-debt-gates-contract.test.ts`
- **真实数据来源**：`package.json`、`scripts/list-node-spec-tests.mjs`、`tests/`、`docs/changes/28-偿还历史测试与会话债务/tests/`
- **入口路径**：创建阶段契约测试读取真实源码。
- **关键断言**：
  - `package.json` 仍包含 `typecheck`、`test:server`、`test:spec:node` 的真实入口。
  - `scripts/list-node-spec-tests.mjs` 不得专门排除当前失败债务文件。
  - 默认测试目录不得新增 `test.skip`、`describe.skip`、`.only(` 或 `todo(`。
  - 本提案契约测试不得被删除或弱化。
- **剩余风险**：静态检查无法证明每个旧断言都足够强，但能阻止最明显的绕过。

### 需求：manual browser-history 资产必须处置

#### 场景：自动化、人工保留和删除状态必须可复查

- **测试文件**：`docs/changes/28-偿还历史测试与会话债务/tests/manual-history-disposition-contract.test.ts`
- **真实数据来源**：`docs/testing/manual-history-inventory.md` 和 `tests/manual/browser-history/*`
- **入口路径**：创建阶段契约测试读取真实清单和真实 manual browser-history 文件列表。
- **关键断言**：
  - 每个 manual browser-history 文件必须出现在清单中。
  - 处置状态只能是 `已迁移`、`默认门禁候选`、`人工保留`、`待删除`。
  - `人工保留` 项必须写明当前业务价值、运行前置条件和证据路径。
  - `默认门禁候选` 不能在执行完成后残留。
- **剩余风险**：真实 Provider 长链路可能仍保留为人工，但必须有可复查说明。

### 需求：不得违背 27 号最新边界意图

#### 场景：高风险模块拆分合同继续有效

- **测试文件**：`docs/changes/28-偿还历史测试与会话债务/tests/latest-intent-precedence-contract.test.ts`
- **真实数据来源**：`docs/specs/high-risk-module-refactor.md`、27 号归档提案、当前源码入口。
- **入口路径**：创建阶段契约测试读取真实源码和 27 号 durable spec。
- **关键断言**：
  - 28 号提案文档写明编号更大的意图优先。
  - `ProjectOverviewPanel.tsx`、chat hook、backend server 边界仍委托 27 号拆出的模块。
  - 27 号 change contract 仍可作为执行阶段回归命令。
- **剩余风险**：本场景不验证真实浏览器布局，只保护最新提案的结构意图不被偿债改动破坏。
