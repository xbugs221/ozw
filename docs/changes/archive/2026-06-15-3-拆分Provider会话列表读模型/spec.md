# 规格：拆分 Provider 会话列表读模型

## 验收矩阵

| 场景 | required_tests | required_evidence |
| --- | --- | --- |
| 手动草稿绑定的 provider session 不重复显示 | `provider-session-list-read-model-contract` | `provider-session-list-output` |
| workflow-owned session 从普通会话列表过滤 | `provider-session-list-read-model-contract` | `provider-session-list-output` |
| `projects.ts` 不再内联核心列表组装规则 | `provider-session-list-source-boundary` | `provider-session-list-source-audit` |

### 需求：Provider 会话列表 read model 保持现有业务展示规则

#### 场景：手动草稿绑定的 provider session 不重复显示

- **给定** Provider JSONL 中存在 `provider-bound` 会话，项目配置中存在绑定该会话的手动 `c1` 路由
- **当** 后端构建项目首页普通 Provider 会话列表
- **则** 输出中必须保留 `c1`，并保留其 `routeIndex` 和 `providerSessionId`
- **且** 输出中不得再出现底层 `provider-bound` 原始会话
- **测试文件**：`docs/changes/3-拆分Provider会话列表读模型/tests/provider-session-list-read-model.contract.test.ts`
- **真实数据来源**：使用真实项目首页会话字段形状构造 provider session 和 cN draft
- **入口路径**：`buildProviderSessionListReadModel`
- **关键断言**：绑定到 cN 的 provider 原始 session 不出现在输出中；cN 记录保留 routeIndex 和 providerSessionId
- **剩余风险**：不覆盖 JSONL 文件扫描，扫描已有后端测试覆盖

#### 场景：workflow-owned session 从普通会话列表过滤

- **给定** workflow read model 标记 `workflow-child` 为工作流子会话
- **当** 后端构建项目首页普通 Provider 会话列表且启用 workflow child 过滤
- **则** 输出中不得出现 `workflow-child`
- **且** 非 workflow-owned 的普通 provider 会话必须继续显示
- **测试文件**：`docs/changes/3-拆分Provider会话列表读模型/tests/provider-session-list-read-model.contract.test.ts`
- **真实数据来源**：模拟 workflow read model 输出的 session id 集合
- **入口路径**：`buildProviderSessionListReadModel`
- **关键断言**：workflow-owned session id 不出现在普通手动会话列表
- **剩余风险**：workflow child session 详情页展示由现有 workflow 测试覆盖

### 需求：projects.ts 只协调依赖，不承载核心列表规则

#### 场景：`projects.ts` 不再内联核心列表组装规则

- **给定** Provider 会话列表 read model 已拆到 `backend/domains/projects/provider-session-list-read-model.ts`
- **当** 审查 `backend/projects.ts` 的项目首页会话组装代码
- **则** `projects.ts` 必须调用 `buildProviderSessionListReadModel`
- **且** 绑定 provider session 和 workflow-owned session 的核心过滤逻辑必须位于新模块
- **测试文件**：`docs/changes/3-拆分Provider会话列表读模型/tests/provider-session-list-read-model.contract.test.ts`
- **真实数据来源**：读取真实 `backend/projects.ts` 和新模块源码
- **入口路径**：源码边界审计
- **关键断言**：`projects.ts` 导入并调用新 read model；绑定过滤和 workflow-owned 过滤核心逻辑在新模块中
- **剩余风险**：本场景不要求一次性减少到固定行数，避免为了数字做无意义拆分
