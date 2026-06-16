# 测试分类

## 非专业审阅者阅读顺序

非专业审阅者可以先读本页了解测试集边界，再依次查看五个分类导读：

1. `tests/backend/README.md`：理解后端 API、读模型和运行态合同保护哪些服务端业务风险。
2. `tests/unit/README.md`：理解 Vitest 快速业务逻辑测试适合哪些前端或共享纯逻辑。
3. `tests/spec/README.md`：理解规格验收如何拆成 Node 入口和浏览器入口。
4. `tests/e2e/README.md`：理解端到端测试如何覆盖真实页面、WebSocket 和持久化用户流程。
5. `tests/manual/README.md`：理解手动历史回归为什么保留，以及它们为什么不等同于默认 CI 覆盖。

这些测试覆盖真实业务需求，新增或维护时不要只做组件冒烟检查。测试失败时应能对应到用户会遇到的风险，例如页面无法进入会话、消息丢失、Provider 状态不一致或历史回归重新出现。

## 分类职责

- `tests/backend`：后端 API、读模型、运行态路径、Provider、文件系统和无需浏览器的业务契约测试。
- `tests/unit`：由 Vitest 运行的快速业务逻辑测试，覆盖共享纯函数、展示前数据归一化和不依赖后端运行态的模块行为。
- `tests/spec`：规格来源的回归测试。顶层非 `.spec.ts` 文件由 Node 运行，`*.spec.ts` 由 Playwright 运行。
- `tests/e2e`：跨前后端、真实页面导航、WebSocket 或持久化链路的端到端业务流。
- `tests/manual`：需要人工环境、长链路确认、不适合默认 CI，或与当前默认入口业务边界冲突但仍需留档的历史回归；`tests/manual/browser-history` 不作为默认门禁。

## 运行命令

- `pnpm run test:server`：运行 `tests/backend/*.test.ts`。
- `pnpm run test:vitest`：运行 `tests/unit/**/*.test.ts`，用于快速验证真实业务逻辑。
- `pnpm run test:spec:node`：运行 `tests/spec/*.ts`。
- `pnpm run test:spec:browser`：运行 `tests/spec/**/*.spec.ts`。
- `pnpm run test:e2e`：运行 `tests/e2e/**/*.spec.ts`。
- `pnpm run qa:test:timing:fast|smoke|full`：分别采集 fast、smoke、full 质量门耗时，输出到 `test-results/test-performance/<profile>.json`。
- `pnpm run test:manual:codex-resume`：运行手动 Codex resume 回归。
- `pnpm exec tsx --test tests/manual/node-history/*.test.ts`：按需审计旧 Node 历史回归，不进入默认测试入口。
- `pnpm exec playwright test tests/manual/browser-history/*.spec.ts`：按需审计旧浏览器历史回归，不进入默认测试入口，也不作为默认门禁。
  每个 `tests/manual/browser-history/*.spec.ts` 的标准处置状态记录在 `docs/testing/manual-history-inventory.md`。

## 新增规则

新增测试应先判断业务层级和运行入口，再放入对应分类目录。不要直接放在 tests/ 根目录。
