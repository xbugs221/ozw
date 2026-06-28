# 规格：重构高价值模块并修复 CI

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence |
|---|---|---|---|
| 需求：高价值入口降为可审查编排层 | 场景：聊天和项目状态入口满足行数与职责边界 | `contract-high-value-boundary` | `module-boundary-audit` |
| 需求：高价值入口降为可审查编排层 | 场景：复杂逻辑迁入 focused modules | `contract-high-value-boundary` | `module-boundary-audit` |
| 需求：GitHub CI/CD 失败被真实修复 | 场景：CI 质量门与本地脚本对齐 | `contract-ci-quality-gate` | `ci-gate-audit` |
| 需求：GitHub CI/CD 失败被真实修复 | 场景：最近失败 run 有复现和修复证据 | `contract-ci-quality-gate` | `github-ci-failure-metadata`, `github-ci-after-fix-metadata` |
| 需求：测试和文档跟随重构更新 | 场景：durable spec、索引和默认测试同步 | `contract-docs-tests-sync` | `docs-tests-sync-audit` |

### 需求：高价值入口降为可审查编排层

#### 场景：聊天和项目状态入口满足行数与职责边界

- 测试文件：`docs/changes/34-重构高价值模块并修复CI/tests/high-value-module-boundary.acceptance.test.ts`
- 真实数据来源：生产源码 `ChatInterface.tsx`、`ChatMessagesPane.tsx`、`useProjectsState.ts`。
- 入口路径：三个生产入口文件。
- 关键断言：
  - `ChatInterface.tsx` 必须降到预算内。
  - `ChatMessagesPane.tsx` 必须降到预算内。
  - `useProjectsState.ts` 必须降到预算内。
  - 三个入口不得新增 `@ts-nocheck`。
- 剩余风险：具体拆分命名可以与设计建议不同，但必须有等价 focused modules 和默认测试覆盖。

#### 场景：复杂逻辑迁入 focused modules

- 测试文件：`docs/changes/34-重构高价值模块并修复CI/tests/high-value-module-boundary.acceptance.test.ts`
- 真实数据来源：生产源码和新增 focused modules。
- 入口路径：聊天搜索定位、会话状态校准、消息面板布局、项目刷新和项目状态 reducer。
- 关键断言：
  - 必须存在聊天搜索定位 focused module。
  - 必须存在聊天状态校准 focused module。
  - 必须存在消息面板布局 focused module。
  - 必须存在项目刷新 focused module。
  - 必须存在项目状态 reducer focused module。
- 剩余风险：执行阶段如采用不同文件名，必须同步更新本提案合同并说明原因。

### 需求：GitHub CI/CD 失败被真实修复

#### 场景：CI 质量门与本地脚本对齐

- 测试文件：`docs/changes/34-重构高价值模块并修复CI/tests/ci-quality-gate.acceptance.test.ts`
- 真实数据来源：`.github/workflows/ci.yml`、`package.json`、`scripts/list-node-spec-tests.mjs`。
- 入口路径：GitHub `node-checks` workflow 和本地 `test:ci`。
- 关键断言：
  - `package.json` 必须提供 `test:ci`。
  - `test:ci` 必须覆盖 typecheck、vitest、server tests、node spec tests。
  - GitHub workflow 必须执行与 `test:ci` 一致的质量门。
  - Node spec tests 必须通过 `pnpm run test:spec:node` 或等价脚本执行。
- 剩余风险：browser e2e 全量仍由独立本地/发布质量门覆盖，不强制进入当前 `node-checks`。

#### 场景：最近失败 run 有复现和修复证据

- 测试文件：`docs/changes/34-重构高价值模块并修复CI/tests/ci-quality-gate.acceptance.test.ts`
- 真实数据来源：`gh run view 28289064798 --json ...` 查询结果和修复后的 GitHub run 元数据。
- 入口路径：GitHub Actions `CI / node-checks`。
- 关键断言：
  - 必须记录失败 run `28289064798` 的 workflow、branch、job、step。
  - 修复后必须记录一个同 workflow 的通过 run。
  - 不得通过跳过 `Node spec tests` 让 CI 变绿。
- 剩余风险：GitHub 日志正文可能为空，合同以 run 元数据和本地同入口质量门为最低证据。

### 需求：测试和文档跟随重构更新

#### 场景：durable spec、索引和默认测试同步

- 测试文件：`docs/changes/34-重构高价值模块并修复CI/tests/docs-tests-sync.acceptance.test.ts`
- 真实数据来源：`docs/specs/`、`tests/specs/`、`tests/spec/`。
- 入口路径：`docs/specs/high-value-module-refactor.md`、`docs/specs/index.md`、默认规格测试。
- 关键断言：
  - 必须新增或更新 durable spec。
  - `docs/specs/index.md` 必须链接该规格。
  - 默认测试必须覆盖高价值模块边界。
  - 默认测试必须覆盖 CI 质量门，不只依赖 change tests。
- 剩余风险：执行阶段可以把高价值模块规格合并进既有 `high-risk-module-refactor.md`，但必须保留可检索标题和索引链接。
