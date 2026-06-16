# 提案：项目域核心类型化拆分

## 为什么做

项目域是 ozw 的高频核心：首页项目清单、单项目 overview、Provider 会话归属、手动 `cN` 会话、聊天搜索、重命名、删除和归档都会经过它。当前 `project-domain-core.ts` 仍承担迁移仓库职责，既包含大量业务规则，也包含 Provider JSONL 解析、缓存、配置兼容、搜索和删除协调。这个形态让任何小修都容易变成跨域回归。

现有 `project-domain-service.ts` 已经暴露出目标边界，但很多子模块仍只是从 core 转出口。继续在这个基础上添加逻辑，会把复杂度藏在 facade 后面，而不是减少复杂度。

## 做什么

1. 把项目发现、项目配置、手动会话路由、Provider transcript/index、单项目 overview、搜索、重命名和删除拆成真实实现模块。
2. 移除 `project-domain-core.ts` 的 TypeScript suppression，把 core 收敛为短期兼容 shim 或彻底删除。
3. 保持 `backend/projects.ts` 和 `backend/domains/projects/project-domain-service.ts` 的公共导出稳定。
4. 保持项目清单轻量，不因 Provider 历史、workflow 或搜索路径重新深读全量 JSONL。
5. 用真实临时 HOME、真实项目配置和真实 Codex/Pi JSONL 样例验证业务路径。
6. 补充 source audit evidence，确保执行者不能只把函数搬到另一个巨型文件或新增薄 wrapper 通过验收。

## 成功标准

- `project-domain-core.ts` 不再含 `@ts-nocheck`、`@ts-ignore` 或 `@ts-expect-error`。
- focused modules 不再通过 `from './project-domain-core.js'` 转出核心业务。
- 手动 `cN` 路由从 draft、start、provider binding 到 finalize 的配置状态保持稳定。
- Provider 会话列表继续隐藏已绑定的底层 provider session，并保留用户可点击的 `cN` route。
- 聊天搜索仍能找到真实 Codex/Pi transcript 中的用户可见内容。
- 项目清单默认路径继续有界，搜索、删除和 Provider 深读不污染首页刷新。
- `pnpm run typecheck` 与关键后端/规格回归通过。

## 约束

执行阶段不得通过放宽测试、跳过 TypeScript 检查、重命名测试文件、保留空壳模块或修改 `acceptance.json` 来绕过本提案合同。确有需求变更时，必须同步更新 `spec.md`、`task.md`、`acceptance.json` 和 tests/，并说明原因。
