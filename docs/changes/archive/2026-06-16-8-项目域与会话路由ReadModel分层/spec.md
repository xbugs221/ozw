# 规格：项目域与会话路由 ReadModel 分层

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence | 真实数据来源 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- |
| 项目域边界可审查 | 项目 facade 不再承载核心规则 | project-domain-boundary | project-domain-source-audit | 真实源码 | 新模块存在，`projects.ts` 控制在 facade 职责 | 历史兼容分支仍需人工审查 |
| 项目列表保持轻量 | 默认项目清单不回流重集合 | project-domain-boundary、project-list-summary-api | project-list-network-log | 现有 project-list 规格 | `/api/projects` 不包含 sessions/workflows/batches 重数组 | 真实大历史性能由 QA 补证据 |
| 会话路由集中 | manual route 绑定由单模块负责 | project-domain-boundary | route-state-snapshot | 真实 session route store 与源码 | facade 不重复实现 route index/binding 规则 | 老配置迁移需保留 |
| Provider 会话列表稳定 | provider/workflow child 过滤仍由 read model 承载 | provider-session-list-read-model | provider-list-state-snapshot | 现有 provider session read model 测试 | 手动 cN route 保留，重复底层 session 隐藏 | 新 provider 字段差异需后续样例 |
| 删除归档副作用清晰 | 删除路径通过 service 协调 | project-domain-boundary、projects-delete-regression | delete-runtime-log | 真实后端删除测试 | JSONL、provider index、本地 config 清理顺序明确 | 文件系统异常恢复需人工验证 |
| 搜索和消息读取按需 | 搜索不污染项目发现主路径 | project-domain-boundary | search-runtime-log | 真实 chat history search 入口 | 搜索 service 独立，项目列表不深读所有消息 | 大历史搜索性能需另案优化 |

### 需求：项目域边界可审查

#### 场景：项目 facade 不再承载核心规则

- **给定** 开发者审查 `backend/projects.ts`
- **当** 项目域分层完成
- **则** `backend/domains/projects/` 下必须存在项目发现、配置 read model、manual route、overview、删除和搜索服务
- **且** `backend/projects.ts` 只作为兼容 facade 与依赖装配层
- **对应测试**：`docs/changes/8-项目域与会话路由ReadModel分层/tests/project-domain-boundary.contract.test.ts`
- **入口路径**：`pnpm exec tsx --test docs/changes/8-项目域与会话路由ReadModel分层/tests/project-domain-boundary.contract.test.ts`
- **关键断言**：新模块存在并导出业务入口；`projects.ts` 中重复 route/provider/search 规则显著收敛
- **剩余风险**：历史兼容分支是否仍必要需要结合执行阶段代码审查

### 需求：项目列表保持轻量

#### 场景：默认项目清单不回流重集合

- **给定** 用户打开首页
- **当** 浏览器请求 `GET /api/projects`
- **则** 响应只返回项目摘要，不携带 `sessions`、`codexSessions`、`piSessions`、`workflows` 或 `batches` 重数组
- **对应测试**：`tests/spec/project-list-summary-api.spec.ts`
- **入口路径**：`JWT_SECRET=ozw-test-secret pnpm exec playwright test --config=playwright.spec.config.ts tests/spec/project-list-summary-api.spec.ts --grep "默认项目清单只返回轻量项目摘要|单项目 overview 按需返回最近会话和 workflow 概览"`
- **关键断言**：默认项目摘要有界；overview 仍按需加载最近会话和 workflow
- **剩余风险**：真实 provider 大历史下的耗时需要 `test-results/8-project-domain/project-list-network.json`

### 需求：会话路由集中

#### 场景：manual route 绑定由单模块负责

- **给定** 用户创建 `cN` 手动会话草稿
- **当** provider session 被绑定并 finalize
- **则** route index、providerSessionId、runtime 读取与写入必须由 `manual-session-route-read-model` 或 session route store 统一承载
- **对应测试**：`docs/changes/8-项目域与会话路由ReadModel分层/tests/project-domain-boundary.contract.test.ts`
- **入口路径**：同上
- **关键断言**：`projects.ts` 不重复实现 route counter、binding 和 runtime 读取核心规则
- **剩余风险**：旧 config key 迁移必须保留回归测试

### 需求：Provider 会话列表稳定

#### 场景：provider/workflow child 过滤仍由 read model 承载

- **给定** provider JSONL 中存在普通手动会话、已绑定 cN route 和 workflow child session
- **当** 后端构建单项目 provider 会话列表
- **则** 保留用户可点击的 cN route，隐藏重复底层 provider session，并过滤 workflow-owned session
- **对应测试**：`tests/specs/provider-session-list-read-model.spec.ts`
- **入口路径**：`pnpm exec tsx --test tests/specs/provider-session-list-read-model.spec.ts`
- **关键断言**：`buildProviderSessionListReadModel` 仍是核心过滤入口
- **剩余风险**：新增 provider 字段需要新增样例

### 需求：删除归档副作用清晰

#### 场景：删除路径通过 service 协调

- **给定** 用户删除 Codex/Pi 会话或空项目
- **当** 删除动作执行
- **则** JSONL 文件、provider index、本地 config、归档索引和 UI state 清理必须由删除 service 协调
- **对应测试**：`docs/changes/8-项目域与会话路由ReadModel分层/tests/project-domain-boundary.contract.test.ts`、`tests/backend/projects.delete.test.ts`
- **入口路径**：`pnpm exec tsx --test tests/backend/projects.delete.test.ts`
- **关键断言**：删除副作用有单一入口，失败时不静默遗留可见会话
- **剩余风险**：文件系统权限异常需要 QA runtime log

### 需求：搜索和消息读取按需

#### 场景：搜索不污染项目发现主路径

- **给定** 用户没有打开搜索
- **当** 首页刷新项目列表
- **则** 项目发现路径不得深读所有 JSONL 消息正文
- **且** 聊天搜索由独立 service 处理
- **对应测试**：`docs/changes/8-项目域与会话路由ReadModel分层/tests/project-domain-boundary.contract.test.ts`
- **入口路径**：同上
- **关键断言**：chat history search 模块独立；项目列表只用轻量索引
- **剩余风险**：全文搜索性能不在本提案内优化
