# 提案：移除项目域runtime-compat后备

## 背景

项目域现在已经具备 discovery、config、manual route、overview、delete、search 等 focused modules，但这些模块仍可能通过 `project-domain-runtime-compat.js` 或 `project-domain-legacy-runtime.js` 取得真实实现。这类文件是旧运行体，TypeScript 只能通过宽泛 `.d.ts` 看到它，审查者无法在源码层面可靠判断业务规则归属。

## 变更

1. 把旧运行体当前仍承载的公共入口迁入对应 TypeScript modules。
2. 删除 `project-domain-runtime-compat.*` 和 `project-domain-legacy-runtime.*`。
3. 将 `project-domain-core.ts` 收敛为无业务转出的兼容入口，或删除后改由 `project-domain-service.ts` 直接聚合。
4. 更新边界测试，禁止 focused modules 重新导入旧运行体。

## 验收标准

- 项目域源码中不存在 runtime compat/legacy runtime 文件。
- `backend/domains/projects/*.ts` 不再从旧运行体导入。
- `backend/projects.ts` 和 `project-domain-service.ts` 继续暴露核心业务入口。
- 手动 `cN` route、Provider session list、聊天搜索和 rename/delete 回归通过。

## 风险

compat 文件可能仍隐藏少量历史宽容逻辑。执行阶段必须用真实 JSONL、真实项目配置和既有业务回归验证迁移，而不能只做 source audit。
