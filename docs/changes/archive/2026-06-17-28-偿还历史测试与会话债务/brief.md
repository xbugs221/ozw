# 简报：偿还历史测试与会话债务

## 用户问题

`27-重构高风险核心模块` 已完成高风险入口拆分，但执行记录明确留下了完整门禁中的既有失败：`typecheck:test`、`test:server`、`test:spec:node` 仍有历史断言失败。与此同时，`tests/manual/browser-history` 仍保留大量人工历史资产，默认门禁没有证明这些风险已经被妥善覆盖。

用户要求新建专项提案偿还这些历史债务，并约束执行器不能偷懒：不得用 skip、删除断言、放宽合同或回退 27 号提案的拆分意图来制造通过。

## 交付目标

1. 让 `pnpm run typecheck`、`pnpm run test:server`、`pnpm run test:spec:node` 全部通过。
2. 按真实业务语义修复或更新历史测试合同：如果旧断言已经不符合编号更大的最新提案意图，必须同步更新规格、测试和验收说明，而不是静默绕过。
3. 处理 `manual/browser-history` 资产：能稳定自动化的迁入默认门禁；必须人工保留的写清前置条件、证据路径和当前业务价值；无当前 Provider 价值的删除或标为待删除。
4. 保持 27 号提案的边界拆分意图：不得把 Project overview、Chat runtime、Backend server 边界重新合并成巨型文件。

## 非目标

- 不重做 27 号提案已经完成的模块拆分。
- 不引入新测试框架。
- 不用 mock 成功结果替代真实业务入口。
- 不把历史失败简单移出默认脚本。

## 验收入口

创建阶段契约测试：

```bash
pnpm exec tsx --test docs/changes/28-偿还历史测试与会话债务/tests/*.test.ts
```

创建后预期失败，失败原因应是当前历史债务入口仍未修复，或 manual 历史资产仍有未处置项。

执行阶段最终回归：

```bash
pnpm run typecheck
pnpm run test:server
pnpm run test:spec:node
pnpm exec tsx --test docs/changes/28-偿还历史测试与会话债务/tests/*.test.ts
```

## 执行阶段默认上下文

执行器必须先读本目录 `spec.md`、`design.md`、`acceptance.json` 和 `tests/`，再对照 `27-重构高风险核心模块` 的 durable spec。编号更大的提案意图优先；本提案只允许修复历史债务，不允许撤销 27 号提案对模块边界的约束。
