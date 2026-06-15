# 设计：项目域 JS 核心迁移为 TS 边界

## 关键决策

1. 先保 facade，再迁实现。

`backend/projects.ts` 继续作为兼容入口，执行阶段不得要求调用方一次性改完所有 import。

2. 先迁稳定契约，再迁边缘兼容。

优先迁移项目列表、overview、session route、rename、Provider session index；历史迁移分支只有在已有测试覆盖时保留。

3. 类型来自业务结构，不用大号 `Record<string, any>` 代替。

外部 JSON、JSONL、配置文件可以先进入 `unknown` 解析边界，再归一化为 `ProjectDomainConfig`、`ProviderSessionRecord`、`ManualSessionRouteRecord` 等业务类型。

## 风险

- 项目域聚合了旧配置兼容、Provider 历史扫描和 route index，迁移时最容易出现字段遗漏。
- 迁移后构建产物变化较大，必须同时覆盖 typecheck、后端业务测试和发布构建。

## 取舍

不追求一次拆成最理想的目录结构；先让关键实现进入 TS 编译和可审查类型边界，再逐步减小模块体量。
