# 规格：项目域核心类型化拆分

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence | 真实数据来源 | 入口路径 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 项目域迁移核心必须类型化收敛 | 迁移核心不再使用 suppression 且体量受控 | `contract-project-domain-boundary` | `source-audit-snapshot` | tracked 源码 | `backend/domains/projects/project-domain-core.ts` | 无 TS suppression，行数受控，主要入口不再定义在 core | 行数阈值不能替代代码评审 |
| 项目域迁移核心必须类型化收敛 | focused modules 拥有真实实现而不是薄 re-export | `contract-project-domain-boundary` | `module-ownership-snapshot` | tracked 源码 | `backend/domains/projects/*.ts` | 关键模块不再 `from './project-domain-core.js'` 转出业务 | 允许 facade re-export，但不能是业务模块 |
| 公共 facade 必须保持稳定 | `backend/projects.ts` 和 project-domain service 导出兼容 | `contract-project-domain-boundary`, `existing-backend-boundary` | `source-audit-snapshot` | tracked 源码 | `backend/projects.ts`, `project-domain-service.ts` | 既有入口仍可导入，service 不直连迁移 core | 未覆盖所有历史导出消费者 |
| 手动 cN 路由行为必须不退化 | draft、start、bind、finalize 后 route runtime 稳定 | `contract-project-domain-business` | `manual-route-snapshot` | 临时 HOME、真实项目配置、Codex JSONL | `createManualSessionDraft`, `initManualSessionRoute`, `bindManualSessionProvider`, `finalizeManualSessionRoute` | `cN` 保留 routeIndex，finalize 后绑定真实 provider session | 并发多 tab 仍依赖既有回归 |
| Provider 会话归属必须稳定 | 已绑定 cN 隐藏底层 provider session | `contract-project-domain-business`, `existing-provider-session-list` | `manual-route-snapshot` | 临时 HOME、真实 Codex JSONL | `getCodexSessions`, `buildProviderSessionListReadModel` | 用户看到 `cN`，不重复看到底层 provider id | Pi 深层格式由既有测试覆盖 |
| 聊天搜索必须独立于项目清单 | 搜索能找到真实 transcript 且不污染首页路径 | `contract-project-domain-business` | `search-snapshot` | 临时 HOME、真实 Codex JSONL | `searchChatHistory` | 搜索结果包含 sessionId、projectName 和命中文本 | 性能预算需执行阶段补充 runtime log |
| Provider transcript 读取必须保留增量语义 | Codex/Pi afterLine 不退回全文件读取 | `existing-session-incremental-read` | `incremental-read-log` | 既有规格临时 HOME JSONL | `getCodexSessionMessages`, `getPiSessionMessages` | cache hit 从旧 EOF 后读取新增内容 | cache miss 允许安全回退 |
| 项目清单必须保持轻量 | 首页项目列表不深读搜索、删除或完整 transcript | `contract-project-domain-boundary`, `existing-project-list-summary` | `project-list-runtime-log` | tracked 源码和 QA runtime log | `GET /api/projects`, `getProjects` | 默认路径不依赖 search/delete/transcript 深读模块 | 需要执行阶段用 runtime log 补证 |
| 重命名和删除必须迁出迁移核心 | rename/delete 由服务模块协调且行为兼容 | `contract-project-domain-boundary`, `existing-backend-boundary` | `module-ownership-snapshot` | tracked 源码、既有后端测试 | `renameSession`, `renameProject`, `deleteSession`, `deleteProject` | service ownership 清晰，公共导出不变 | 删除真实 provider 文件风险需回归覆盖 |
| 类型检查和构建边界必须收敛 | 项目域拆分后 node/web/test 类型检查通过 | `root-typecheck`, `server-smoke` | `typecheck-log`, `server-smoke-log` | 仓库默认测试入口 | `pnpm run typecheck`, `pnpm run test:server:smoke` | 无 TS suppression 回退，无核心 smoke 退化 | 完整浏览器回归不在最小验收内 |

### 需求：项目域迁移核心必须类型化收敛

#### 场景：迁移核心不再使用 suppression 且体量受控

`backend/domains/projects/project-domain-core.ts` 不得继续包含 `@ts-nocheck`、`@ts-ignore` 或 `@ts-expect-error`。该文件不得继续作为 5000 行级业务仓库；执行阶段应把主体规则迁出，使其成为短兼容层或删除。

对应测试：`docs/changes/18-项目域核心类型化拆分/tests/project-domain-boundary.acceptance.test.ts`。

#### 场景：focused modules 拥有真实实现而不是薄 re-export

项目发现、手动路由、overview、搜索、删除和 Provider transcript/index 模块必须承载真实实现。业务模块不得只通过 `export { ... } from './project-domain-core.js'` 伪装成边界，也不得用 `export const xxxEntry = true` 这类哨兵充当实现。

对应测试：`docs/changes/18-项目域核心类型化拆分/tests/project-domain-boundary.acceptance.test.ts`。

### 需求：公共 facade 必须保持稳定

#### 场景：`backend/projects.ts` 和 project-domain service 导出兼容

后端路由和现有测试继续从 `backend/projects.ts` 或 `project-domain-service.ts` 导入项目域入口。拆分后必须保留 `getProjects`、`getSessionMessages`、`createManualSessionDraft`、`finalizeManualSessionRoute`、`renameProject`、`renameSession`、`searchChatHistory`、`indexProviderSessionFile` 等公共入口。

对应测试：`docs/changes/18-项目域核心类型化拆分/tests/project-domain-boundary.acceptance.test.ts` 和 `tests/specs/backend-type-module-boundary.spec.ts`。

### 需求：手动 cN 路由行为必须不退化

#### 场景：draft、start、bind、finalize 后 route runtime 稳定

给定用户在真实项目中创建 Codex 手动会话草稿，当 route start、provider session binding 和 finalize 依次发生后，`cN` route 必须保留 route index，runtime 查询必须能定位真实 provider session，项目配置必须记录最终绑定。

对应测试：`docs/changes/18-项目域核心类型化拆分/tests/project-domain-business.acceptance.test.ts`。

### 需求：Provider 会话归属必须稳定

#### 场景：已绑定 cN 隐藏底层 provider session

给定真实 Codex JSONL 已经绑定到手动 `cN` route，当后端构建项目 Codex 会话列表时，用户应看到 `cN` route；同一个底层 provider session id 不得作为第二条普通会话重复出现。

对应测试：`docs/changes/18-项目域核心类型化拆分/tests/project-domain-business.acceptance.test.ts` 和 `tests/specs/provider-session-list-read-model.spec.ts`。

### 需求：聊天搜索必须独立于项目清单

#### 场景：搜索能找到真实 transcript 且不污染首页路径

给定临时 HOME 中存在真实 Codex JSONL 用户消息，当调用 `searchChatHistory` 搜索唯一业务短语时，结果必须包含对应 sessionId、projectName 和命中文本。搜索实现必须留在搜索服务边界，不能重新进入项目清单默认路径。

对应测试：`docs/changes/18-项目域核心类型化拆分/tests/project-domain-business.acceptance.test.ts`。

### 需求：Provider transcript 读取必须保留增量语义

#### 场景：Codex/Pi afterLine 不退回全文件读取

拆分 Provider transcript reader 后，Codex/Pi 长会话仍应支持 afterLine 增量读取。cache hit 时只读取新增尾部，不能因为模块拆分恢复全文件读取。

对应测试：`tests/specs/session-incremental-read.spec.ts`。

### 需求：项目清单必须保持轻量

#### 场景：首页项目列表不深读搜索、删除或完整 transcript

默认项目列表入口只返回项目摘要和有界 Provider-only 候选，不得调用聊天全文搜索、删除服务或完整 transcript 深读。执行阶段需要保留 source audit，并补充 runtime log 证明 `/api/projects` 没有等待重索引或搜索路径。

对应测试：`docs/changes/18-项目域核心类型化拆分/tests/project-domain-boundary.acceptance.test.ts`。

### 需求：重命名和删除必须迁出迁移核心

#### 场景：rename/delete 由服务模块协调且行为兼容

项目重命名、会话重命名、Codex session 删除、Pi/manual route 删除和空项目删除必须由服务模块协调。公共入口保持不变，但 `project-domain-core.ts` 不得继续定义这些主体实现。

对应测试：`docs/changes/18-项目域核心类型化拆分/tests/project-domain-boundary.acceptance.test.ts` 和 `tests/specs/backend-type-module-boundary.spec.ts`。

### 需求：类型检查和构建边界必须收敛

#### 场景：项目域拆分后 node/web/test 类型检查通过

执行完成后，`pnpm run typecheck` 必须通过，关键后端 smoke 测试必须通过。不得通过重新添加 suppression、扩大 `any` 公共类型或移除测试入口来换取通过。

对应测试：`pnpm run typecheck` 和 `pnpm run test:server:smoke`。
