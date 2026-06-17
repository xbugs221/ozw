# 设计：偿还历史测试与会话债务

## 总体策略

本提案不是继续重构结构，而是把被 27 号提案记录为“既有失败”的门禁债务转成硬交付合同。执行阶段先复现失败，再按业务域分组修复，最后用同一批命令证明债务已经偿还。

## 意图优先级

当历史测试断言和最近提案意图冲突时，以编号更大的提案为准。本提案编号为 28，因此可以要求更新旧断言以匹配 27 号已经确认的模块拆分和当前 Provider 口径；但不能借此撤销 27 号的拆分目标。

## 债务分组

### 类型债务

`typecheck:test` 当前暴露的类型债务属于测试基础设施问题。执行阶段应优先用最小类型声明、正确测试 helper 类型或局部类型收窄解决，避免扩大 `skipLibCheck` 或新增 `any` 扫尾。

### 后端业务合同债务

`test:server` 失败分布在多个用户路径：

- Codex JSONL/read model：增量 cursor、工具卡、phase metadata、首页摘要。
- Project discovery/archive/delete：临时项目过滤、缺失项目归档、Provider-only 项目删除。
- Session rename/manual route：Claude 移除拒绝、Codex/Pi manual draft 可见性、route 编号、delete/finalize 清理。

执行阶段可以按测试文件分批修复，但最终不能只跑单文件；必须跑完整 `test:server`。

### Node spec 债务

`test:spec:node` 失败集中在 conf v2 和 project chat config v2。执行阶段必须判断失败是实现退化还是旧规格过期。如果旧规格过期，必须同步更新 `docs/specs`、测试标题和验收解释，不能只改 expected 值。

### manual 历史资产债务

`tests/manual/browser-history` 的价值不能只靠“人工保留”四个字维持。执行阶段应逐个分类：

- 默认门禁：当前业务价值高、可稳定 fixture 化。
- 人工保留：真实 Provider、长链路、人工视口或性能观察不可替代。
- 待删除：只覆盖旧 `co` 路径且无当前 Provider 价值。

## 防偷懒约束

- 不新增无条件或条件 `test.skip`。
- 不把失败测试从 `package.json` 脚本、`scripts/list-node-spec-tests.mjs` 或 Playwright 配置中移除。
- 不删除创建阶段契约测试。
- 不把 27 号提案拆出的模块重新合并。
- 允许更新旧测试，但必须在相关 spec 或测试注释里说明新意图来源。

## 风险控制

- 每修一组债务先跑对应单文件，再跑完整入口。
- 更新旧断言时同时检查 durable specs，避免测试和文档分叉。
- manual 历史资产迁移时优先复用现有 `tests/spec`、`tests/e2e` fixture，不引入新框架。
