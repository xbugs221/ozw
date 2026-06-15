# 规格：Workflow 读模型与详情页边界重构

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence | 真实数据来源 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- |
| 后端 projection 独立 | artifact/session/process/diagnostics 可单测 | workflow-boundary、workflow-dag-read-model | workflow-readmodel-snapshot | 真实 workflow read model 源码 | projection 模块存在并导出纯入口 | oz 新版本字段需后续样例 |
| 前端 view model 独立 | 详情页不直接承载所有状态推断 | workflow-boundary | workflow-viewmodel-audit | 真实 `WorkflowDetailView.tsx` | 视图行数和 helper 数收敛 | UI 细节需截图 |
| 七阶段与 legacy fallback 不回退 | v1.2 七阶段和旧 run 都能展示 | workflow-dag-read-model、workflow-presentation | workflow-detail-screenshot | 现有 workflow fixtures | 阶段进度、artifact、fallback 保持 | 真实 oz CLI 输出需 QA |
| child session 路由稳定 | provider-aware 子会话可点击 | workflow-control-plane、workflow-child-session-isolation | workflow-route-trace | 现有浏览器/规格测试 | 点击 Pi/Codex child session 加载正确消息 | 浏览器 trace 需执行阶段补充 |
| runner process 语义清晰 | process 与 session 编号不混用 | workflow-boundary、workflow-presentation | workflow-process-snapshot | 真实 read model 字段 | 没有 pid 不伪造 process | 历史数据字段稀疏 |
| 详情页操作稳定 | continue/resume/abort 状态由 view model 生成 | workflow-boundary | workflow-action-log | 真实 WorkflowDetailView 控制逻辑 | UI 组件不自行推断执行状态 | 后续控制面变更需同步测试 |

### 需求：后端 projection 独立

#### 场景：artifact/session/process/diagnostics 可单测

- **给定** 后端读取 oz flow run 目录
- **当** 构建 workflow read model
- **则** artifact、child session、runner process 和 diagnostics projection 必须有独立模块
- **对应测试**：`docs/changes/10-Workflow读模型与详情页边界重构/tests/workflow-boundary.contract.test.ts`、`tests/specs/workflow-dag-read-model.spec.ts`
- **入口路径**：`pnpm exec tsx --test docs/changes/10-Workflow读模型与详情页边界重构/tests/workflow-boundary.contract.test.ts`
- **关键断言**：projection 模块存在并导出业务入口，read model 规格继续通过
- **剩余风险**：oz 新版本字段需要新增 fixture

### 需求：前端 view model 独立

#### 场景：详情页不直接承载所有状态推断

- **给定** 开发者审查 workflow 详情页
- **当** 重构完成
- **则** `WorkflowDetailView.tsx` 只组合 view model 和子组件，不直接包含大量状态推断、artifact 选择和 session 路由函数
- **对应测试**：`docs/changes/10-Workflow读模型与详情页边界重构/tests/workflow-boundary.contract.test.ts`
- **入口路径**：同上
- **关键断言**：前端 view model 与组件模块存在，详情页行数/helper 数收敛
- **剩余风险**：视觉回归由截图补充

### 需求：七阶段与 legacy fallback 不回退

#### 场景：v1.2 七阶段和旧 run 都能展示

- **给定** oz flow v1.2 七阶段 run 和旧 run
- **当** 用户打开 workflow 详情
- **则** 阶段进度、artifact、fallback 展示行和旧 run 兼容读取保持稳定
- **对应测试**：`tests/specs/workflow-dag-read-model.spec.ts`、`tests/spec/workflow-presentation.spec.ts`
- **入口路径**：`pnpm exec tsx --test tests/specs/workflow-dag-read-model.spec.ts tests/spec/workflow-presentation.spec.ts`
- **关键断言**：七阶段主路径展示，缺少新字段时 fallback 仍可读
- **剩余风险**：真实 oz CLI 输出需要执行阶段运行证据

### 需求：child session 路由稳定

#### 场景：provider-aware 子会话可点击

- **给定** workflow 子会话包含 Codex 或 Pi provider session
- **当** 用户点击 role row 或 stage session 链接
- **则** 前端进入正确 route，并请求带 provider 的消息
- **对应测试**：`tests/spec/project-workflow-control-plane.spec.ts`、`tests/spec/project-workflow-child-session-isolation.spec.ts`
- **入口路径**：`pnpm exec tsx --test tests/spec/project-workflow-control-plane.spec.ts tests/spec/project-workflow-child-session-isolation.spec.ts`
- **关键断言**：不串用旧子会话消息，不跨 provider fallback
- **剩余风险**：真实浏览器 trace 由 QA 补充

### 需求：runner process 语义清晰

#### 场景：process 与 session 编号不混用

- **给定** workflow read model 存在 sessions-only 状态或真实 process metadata
- **当** 前端渲染 runner processes
- **则** 无 pid 不伪造 process，session 编号和 process 编号在 UI 上语义分离
- **对应测试**：`docs/changes/10-Workflow读模型与详情页边界重构/tests/workflow-boundary.contract.test.ts`、`tests/spec/workflow-presentation.spec.ts`
- **入口路径**：同上
- **关键断言**：process projection 和 runner process 组件存在，视图不混写 pid 推断
- **剩余风险**：历史数据字段稀疏时需人工检查

### 需求：详情页操作稳定

#### 场景：continue/resume/abort 状态由 view model 生成

- **给定** workflow 处于 running、blocked、completed 或 failed 状态
- **当** 用户打开详情页
- **则** continue/resume/abort 按钮状态由 view model 统一生成，组件不重复推断执行状态
- **对应测试**：`docs/changes/10-Workflow读模型与详情页边界重构/tests/workflow-boundary.contract.test.ts`
- **入口路径**：同上
- **关键断言**：continue state 模块化，UI 组件只消费明确状态
- **剩余风险**：后续 workflow 控制面扩展需新增场景
