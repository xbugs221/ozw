# 规格：测试基线与 Fixture 真实化

## 验收矩阵

| 场景 | required_tests | required_evidence |
| --- | --- | --- |
| `typecheck:test` 成为可信基线 | `test-typecheck-baseline-contract` | `typecheck-test-log` |
| Codex JSONL fixture 可被真实项目 API 发现 | `codex-fixture-discovery-contract` | `codex-fixture-discovery-state` |
| browser spec 复用共享 provider WebSocket harness | `provider-harness-source-boundary` | `provider-harness-source-audit` |

### 需求：测试类型基线可作为合并门禁

#### 场景：`typecheck:test` 成为可信基线

- **给定** 仓库使用 `tsconfig.test.json` 检查测试代码
- **当** 执行 `pnpm run typecheck:test`
- **则** 命令必须通过
- **并且** 不能通过删除测试、放宽根 tsconfig 或全局禁用 test typecheck 达成
- **测试文件**：`docs/changes/4-测试基线与Fixture真实化/tests/test-baseline-and-fixtures.contract.test.ts`
- **真实数据来源**：真实 `package.json`、`tsconfig.test.json` 和测试源码
- **入口路径**：`pnpm run typecheck:test`
- **关键断言**：脚本仍存在；`pnpm run typecheck` 仍包含 `typecheck:test`；新增共享类型声明覆盖 provider/browser harness
- **剩余风险**：不要求每个测试文件完全 strict，只要求当前基线可执行

### 需求：Codex fixture discovery 稳定

#### 场景：Codex JSONL fixture 可被真实项目 API 发现

- **给定** browser spec 写入一个 Codex JSONL fixture session
- **当** 测试打开项目页并等待项目 API 发现该 session
- **则** helper 必须返回 session id、routeIndex、providerSessionId 和消息 endpoint
- **并且** 失败时必须输出候选 session 诊断
- **测试文件**：`docs/changes/4-测试基线与Fixture真实化/tests/test-baseline-and-fixtures.contract.test.ts`
- **真实数据来源**：Playwright 临时 HOME 下的真实 `.codex/sessions` JSONL 文件
- **入口路径**：`tests/spec/helpers/codex-jsonl-fixture.ts` 与 `fixture-session-discovery.ts`
- **关键断言**：共享 helper 文件存在；关键 browser specs 使用 helper；不再硬编码 throw `Codex fixture session ... not found`
- **剩余风险**：不真实调用外部 Codex 服务

### 需求：Provider browser harness 统一

#### 场景：browser spec 复用共享 provider WebSocket harness

- **给定** 多个 browser spec 需要注入 provider runtime event
- **当** 测试安装 FakeWebSocket
- **则** 必须复用共享 harness
- **并且** harness 必须记录 sent messages、runtime events、console/network 证据
- **测试文件**：`docs/changes/4-测试基线与Fixture真实化/tests/test-baseline-and-fixtures.contract.test.ts`
- **真实数据来源**：真实 `tests/spec/*.spec.ts` 源码
- **入口路径**：源码边界审计
- **关键断言**：重复 FakeWebSocket 定义被迁移；共享 helper 暴露 accepted/status/response/complete/error builder
- **剩余风险**：完整 e2e 的真实 WebSocket 仍由现有 e2e 覆盖
