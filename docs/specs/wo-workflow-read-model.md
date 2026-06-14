# 规格：oz flow 工作流 read model

### 需求：oz flow 工作流 read model 必须按业务概念分层

#### 场景：stage、session、artifact、DAG 和 summary 迁出巨型文件

- **给定** ozw 后端工作流 read model 源码
- **当** 审查 `backend/domains/workflows/read-model/` 模块边界
- **那么** 必须存在 `stage-taxonomy.ts`、`session-refs.ts`、`artifact-reader.ts`、`dag-read-model.ts` 和 `status-summary.ts`
- **并且** 每个模块必须导出自身业务概念的读模型规则
- **并且** 这些 typed 模块不得使用 TypeScript suppression、throwing boundary stub、反向导入 `legacy-core.js` 或把已分层规则委托回 `builder-internals.js`
- **并且** `workflow-read-model.ts` 必须保持薄入口，不得重新膨胀成巨型无类型文件
- **并且** `legacy-core.js` 和 `builder-internals.js/.d.ts` 不得继续声明已迁出的 stage/session/artifact/DAG/summary 实现
- **剩余风险**：源码边界不能单独证明所有历史 runner state 兼容，必须与后端 workflow 回归和浏览器 workflow detail 回归共同验证

### 需求：ozw 正确展示 oz flow v1.3.0 合并后的计划/验收阶段

#### 场景：v1.3.0 run 不再包含独立 acceptance stage

- 假设 oz flow sealed `state.json` 的运行阶段包含 `execution`、`review_1`、`qa_1`、`fix_1`、`review_2`、`qa_2`、`archive`
- 并且该状态没有 `stages.acceptance`
- 并且该状态没有 acceptance session 或 acceptance artifact
- 当 ozw 构建工作流 read model
- 那么前端主路径必须把 `planning` 作为计划/验收合同合并阶段展示
- 并且不得渲染空的独立 `acceptance` 角色行
- 并且 `qa_1`、`qa_2` 不得产生 unknown stage 诊断

#### 场景：历史 v1.2.0 run 明确包含 acceptance 数据

- 假设旧 oz flow sealed `state.json` 包含 `stages.acceptance`
- 或者包含 acceptance session、acceptance summary artifact
- 当 ozw 构建工作流 read model
- 那么 ozw 仍应保留独立 acceptance 行和 artifact 链接
- 并且不得为了 v1.3.0 适配破坏旧运行态可读性

### 需求：QA 阶段 JSON 文件像审核 JSON 一样可点击

#### 场景：run directory 中存在 `qa-2.json`

- 假设 v1.3.0 run 已完成 `qa_1`，当前或最近阶段是 `qa_2`
- 并且 run directory 中存在 `qa-2.json`
- 当用户打开 ozw 工作流详情页
- 那么 QA 角色行必须显示 `qa-2.json` 链接
- 并且 QA 角色行必须显示已经发生的 QA 次数
- 当用户点击 `qa-2.json`
- 那么 ozw 必须打开该 JSON 文件
- 并且行为应与点击 `review-2.json` 审核产物一致

#### 场景：QA JSON 文件缺失

- 假设 state 指向或推断出 `qa-2.json`
- 但是文件尚未生成或已丢失
- 当用户打开工作流详情页
- 那么 ozw 不得渲染会打开失败的链接
- 并且后端 diagnostics 应包含缺失路径提示

---

### 需求：ozw 把 oz flow graph JSON 转成可审查 workflow DAG read model

#### 场景：读取 DAG 节点、边、gate 和 artifact

- **给定** 项目存在 sealed `state.json`
- **并且** `oz flow graph --change <change-name> --format json` 返回 `nodes`、`edges`、`artifacts`、`gates`
- **当** ozw 调用 `listWorkflowReadModels(projectPath)`
- **那么** 对应 workflow 必须包含 `workflowDag.nodes`
- **并且** `workflowDag.edges` 必须保留条件边 label
- **并且** `workflowDag.gates` 必须保留 gate stage 和 iteration
- **并且** `workflowDag.artifacts` 必须保留 `node_id` 绑定关系

#### 场景：所有 DAG artifact 都能进入审查

- **给定** `oz flow graph.artifacts` 指向 `parallel-planning_context.json`、`review-1.json`、`qa-1.json`、`fix-1-summary.md`
- **并且** run directory 中存在这些文件
- **当** ozw 构建 `workflowDag`
- **那么** 每个 artifact 都必须生成 `reviewTargets[kind=artifact]`
- **并且** target 必须包含可打开 path
- **并且** target 必须标记 `exists=true`

#### 场景：oz flow graph 不可用时保留旧详情页能力

- **给定** `oz flow graph` 命令不可用或返回错误
- **并且** sealed `state.json` 仍可读取
- **当** ozw 构建 workflow read model
- **那么** workflow 仍必须返回 `stageInspections`
- **并且** `workflowDag.source.available` 必须是 `false`
- **并且** diagnostics 必须说明 graph 不可用原因

### 需求：工作流详情页必须使用单棵 oz flow status 阶段树承载审查入口

#### 场景：页面显示阶段树而不是独立 DAG 审查面板

- **给定** Playwright fixture 项目中存在一个 `oz flow` run
- **并且** run state 包含 execution、review、qa、fix、archive 会话和产物
- **当** 用户登录 ozw、打开项目、点击工作流详情
- **那么** 工作流标题必须以纯文本 heading 显示，标题内部不得包含链接或按钮
- **并且** 页面必须显示 `workflow-status-tree`
- **并且** 阶段行必须显示阶段名称、执行状态和耗时
- **并且** 页面不得显示 `DAG 审查`、`workflow-dag-view` 或 `workflow-review-panel`
- **并且** 阶段树不得继续显示独立会话 id 列

#### 场景：阶段、子代理和产物名称本身就是检查入口

- **给定** run state 中 execution、review、qa 绑定了 workflow child session
- **并且** review 阶段下存在内部子代理会话
- **并且** run directory 中存在 `review-1.json`、`qa-1.json` 和修正摘要
- **当** 用户点击阶段树中的阶段名称
- **那么** 页面必须进入 workflow child session 路由
- **当** 用户点击阶段树中的子代理名称
- **那么** 页面必须进入该 workflow 的内部子代理会话路由
- **当** 用户点击阶段树中的 `review-1.json`
- **那么** ozw 必须打开该产物文件
- **并且** 阶段树不得用额外的 `会话`、`查看` 或 `打开` 按钮替代名称本身的点击行为
- **并且** 执行阶段产物如 `SUMMARY.md` 必须能从文件名直接打开真实文件内容

#### 场景：规划阶段展示真实 oz change 顶层产物

- **给定** active 或 archived oz change 目录包含 `brief.md`、`proposal.md`、`design.md`、`spec.md`、`task.md`、`acceptance.json`、`tests/` 和其他顶层文件或目录
- **当** ozw 构建工作流 read model 并展示规划阶段
- **那么** 规划阶段必须显示这些真实顶层产物
- **并且** `brief.md`、`proposal.md`、`design.md`、`spec.md`、`task.md`、`acceptance.json`、`tests/` 必须按优先级排序
- **并且** 其他顶层文件或目录必须按名称追加
- **并且** 文件名和目录名本身必须是可点击入口

#### 场景：多轮阶段按轮次分组

- **给定** oz flow run state 包含 `review_1`、`qa_1`、`fix_1` 和 `review_2`
- **当** 用户查看 workflow 详情页
- **那么** 页面必须显示 `第 1 轮` 和 `第 2 轮`
- **并且** `review_1`、`qa_1`、`fix_1` 位于第 1 轮下，`review_2` 位于第 2 轮下
- **并且** 每个阶段下的当前轮次产物仍可点击

#### 场景：内部子代理名称精简且可点击

- **给定** workflow read model 提供内部子代理会话，名称类似 `review subagent: 目标核对审核员`
- **当** 用户查看审核阶段资源区
- **那么** 页面只显示 `目标核对审核员`
- **并且** 不显示 `review subagent`、`subagent:` 或长 session id
- **并且** 点击该中文名进入 workflow 内部子代理会话路由

#### 场景：DAG reviewTargets 被阶段树吸收

- **给定** `oz flow graph` 返回的 `reviewTargets` 包含只能从 graph 获得的 session 或 artifact target
- **并且** 这些 target 可以归属到具体 stage
- **当** ozw 构建 workflow read model
- **那么** 对应 target 必须合并进 `stageInspections`
- **并且** artifact target 必须保留可打开 path、相对路径和 exists 状态
- **并且** session target 必须保留 provider-aware workflow child session route
- **并且** 用户不需要打开独立 DAG 审查面板也能从阶段树进入这些 target

---

### 需求：状态摘要必须使用 oz flow runtime JSON

ozw 必须把工作流详情页顶部摘要改成与 `oz flow status` / `oz flow watch` 同语义的角色摘要。后端数据来源必须是 sealed `state.json`、`oz flow status --run-id <run-id> --json` 或等价 runner JSON，不能解析人类文本，也不能从 `max_review_iterations` 推导轮次。

#### 场景：状态摘要只统计真实发生轮次

- **给定** active oz change 目录包含 `proposal.md`、`design.md`、`spec.md`、`task.md`、`acceptance.json` 和 `tests/`
- **并且** sealed `state.json` 包含 `engine=go-dag`
- **并且** `workflow_config.max_review_iterations=30`
- **并且** `stages` 只包含 `execution`、`review_1`、`fix_1`、`review_2`、`fix_2`、`review_3`、`qa_3`、`archive`
- **当** ozw 构建工作流 read model
- **那么** 状态摘要必须显示 `引擎 go-dag`
- **并且** 审查行必须是 3 次真实审查，等价于 `✓✓✓`
- **并且** 修复行必须是 2 次真实修复，等价于 `✓✓`
- **并且** 归档行必须显示当前运行标记 `→`
- **并且** 状态摘要不得出现来自配置上限的 `30`

#### 场景：oz flow status json 不可用时回退 sealed state

- **给定** `oz flow status --run-id <run-id> --json` 失败
- **并且** sealed `state.json` 可读
- **当** ozw 构建工作流 read model
- **那么** 状态摘要必须回退到 sealed state 中的 sessions 和 stages
- **并且** diagnostics 必须记录 oz flow status json 不可用的原因

#### 场景：dag_nodes 完成状态补充 markers

- **给定** sealed `stages` 是稀疏字段（如仅有 `review_1: running`）
- **并且** `dag_nodes.execution.status=success` 且 `finished_at` 存在
- **当** ozw 构建工作流 read model
- **那么** execution 行必须显示 `✓`
- **并且** 当前 reviewer 行必须显示 `→`
- **并且** 不得暴露未来模板轮次

### 需求：DAG 审查不得展示模板-only 轮次

`oz flow graph` 可以返回完整 30 轮模板，但 ozw 展示的 DAG 审查必须按运行态证据裁剪。没有 state、session、artifact、dag_nodes 或 gate evidence 的未来节点不得进入主审查区域。

#### 场景：30 轮 graph 模板被真实运行态裁剪

- **给定** `oz flow graph` 返回 `review_1` 到 `review_30`、`qa_1` 到 `qa_30`、`fix_1` 到 `fix_30`
- **并且** sealed `state.json` 只证明 `review_1..3`、`fix_1..2`、`qa_3`、`archive`
- **当** ozw 构建 `workflowDag`
- **那么** `workflowDag.nodes` 必须保留 `review_1`、`review_2`、`review_3`、`fix_1`、`fix_2`、`qa_3`、`archive`
- **并且** 不得包含 `qa_1`、`qa_2`、`fix_3`、`review_4`、`gate_review_30`、`qa_30`、`fix_30`
- **并且** `workflowDag.edges` 不得引用已裁剪节点
- **并且** `workflowDag.gates` 不得包含已裁剪轮次

#### 场景：pending 阶段不进入 DAG

- **给定** sealed state 中 review、fix、archive 均为 pending
- **并且** 无 artifact、child session 或 dag_nodes 证据
- **当** ozw 构建 `workflowDag`
- **那么** pending 阶段节点不得出现在可见 DAG 中
- **并且** pending 阶段角色行不得出现在状态摘要中

### 需求：手动会话清单必须过滤新版 oz flow 并行子代理会话

新版 `oz flow` 的并行 subagent 会话属于工作流内部审查/上下文收集线程。即使 provider JSONL 中存在这些 session，ozw 前端在项目主页和侧栏显示普通 `手动会话` 清单时，也必须把它们过滤掉，只允许用户从 workflow DAG 审查入口进入。

#### 场景：DAG review target session 不进入普通手动会话

- **给定** `ProjectWorkflow.workflowDag.nodes` 中存在 `type=subagent` 节点
- **并且** 该节点的 `reviewTargets` 包含 `kind=session`、`sessionId=parallel-review-agent-thread`、`provider=codex`
- **并且** provider JSONL 发现同一个 session
- **当** 前端构建普通手动会话清单
- **那么** `codex:parallel-review-agent-thread` 不得出现在 `手动会话` 分组
- **并且** 同名但不同 provider 的 session（如 `pi:parallel-review-agent-thread`）不得被误过滤
- **并且** 普通 CLI 会话仍然保留在手动会话清单
- **并且** workflow DAG 审查入口仍可保留该 session target

#### 场景：项目列表摘要传递 provider-aware 会话引用

- **给定** DAG reviewTargets 和 runner process 包含 workflow-owned session
- **当** ozw 构建项目列表摘要
- **那么** `workflowOwnedSessionRefs` 必须包含 `{sessionId, provider}` 对
- **并且** pi session 不得被错误标记为 codex
- **并且** 前端过滤必须同时比较 sessionId 和 provider

### 审核 gate 范围约定

本提案的 review/QA gate 只判断实现是否满足合同。阻断项必须满足至少一个条件：

- 由本提案新增或修改的代码、测试、文档直接引入
- 与本提案 required_tests、required_evidence 或用户可见行为直接相关
- 属于本提案实现必须触达的既有代码路径，且本提案改动造成回归

既有全仓安全债、质量债、测试债、架构债不属于本提案 gate 的阻断范围，除非它们被本提案改动引入、放大，或会导致本提案验收场景无法成立。

并行审核产物必须按规范表达范围：
- `findings[]` 只放当前提案阻断项，显式写 `scope=current_change`、`scope=acceptance_contract` 或 `scope=introduced_regression`
- `non_blocking_findings[]` 只放合同外既有债务，显式写 `scope=out_of_scope_existing`
