# 提案：偿还历史测试与会话债务

## 背景

最近一次归档提案 `27-重构高风险核心模块` 将高风险巨型模块拆成可审查边界，但执行记录显示完整测试门禁仍有历史失败：

- `pnpm run typecheck` 失败于 `typecheck:test` 的类型债务。
- `pnpm run test:server` 失败于 Codex 历史读模型、项目发现/归档/删除、Provider-only 项目、manual route、Claude 移除合同等历史断言。
- `pnpm run test:spec:node` 失败于 conf v2、manual route 状态持久化和 timing profile 合同。
- `tests/manual/browser-history` 中大量历史 browser 资产仍是人工保留状态，默认门禁不能声称已经覆盖。

这些债务如果继续被“后续专项”口头保留，会让后续提案无法判断失败是新回归还是旧问题。

## 范围

- 修复或按最新提案意图更新 `typecheck:test`、`test:server`、`test:spec:node` 的失败合同。
- 为每类历史失败补充 durable specs 或更新现有 specs，使新意图有文档、测试和验收合同共同支撑。
- 收敛 `manual/browser-history` 资产清单，把默认门禁应覆盖的风险迁入 `tests/spec` 或 `tests/e2e`。
- 保留并复跑 27 号高风险模块边界合同，防止偿债时把拆分结构合回旧入口。

## 优先级

| 优先级 | 债务 | 用户风险 | 成功标准 |
| --- | --- | --- | --- |
| P0 | `typecheck:test` 失败 | 测试源码类型不可信，后续重构可能隐藏类型错误 | `pnpm run typecheck` 通过 |
| P0 | Codex/session/project 后端合同失败 | 历史消息、项目首页、删除/归档、manual route 可能对用户显示错误状态 | `pnpm run test:server` 通过 |
| P0 | conf v2 与 manual route spec 失败 | 会话 UI 状态、模型、推理深度和 finalize/delete 状态可能丢失 | `pnpm run test:spec:node` 通过 |
| P1 | manual browser-history 人工保留过多 | 默认门禁没有覆盖真实历史回归 | 可自动化风险迁入默认门禁，剩余人工项有明确原因 |
| P1 | 27 号边界回归风险 | 偿债时可能撤销最新拆分意图 | 27 号合同继续通过 |

## 非目标

- 不接受通过删除测试、添加 `test.skip`、放宽断言、移除失败文件、修改脚本排除失败测试来完成。
- 不接受把 27 号拆出的边界模块重新合并到巨型文件。
- 不要求一次性把真实外部 Provider 长链路全部变成默认门禁；但必须明确哪些保留为人工项，以及为什么不能自动化。

## 成功标准

- 创建阶段契约测试全部通过。
- `pnpm run typecheck`、`pnpm run test:server`、`pnpm run test:spec:node` 全部通过。
- `docs/testing/manual-history-inventory.md` 不再只有笼统“人工保留”，每个保留项都有当前业务价值、前置条件和证据路径，能自动化的已迁入默认入口。
- 最新编号意图优先原则被写入 durable spec，并在执行记录中说明哪些旧断言按新意图更新。
