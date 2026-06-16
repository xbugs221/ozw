# 任务：项目域核心类型化拆分

## 0. 契约基线

- [x] 1. 运行 `pnpm exec tsx --test docs/changes/18-项目域核心类型化拆分/tests/project-domain-boundary.acceptance.test.ts`，确认初始失败来自目标架构缺失。
- [x] 2. 运行 `pnpm exec tsx --test docs/changes/18-项目域核心类型化拆分/tests/project-domain-business.acceptance.test.ts`，确认真实业务路径测试可执行。
- [x] 3. 保存初始 source audit 和业务 evidence 到 `test-results/18-project-domain-*`。
- [x] 4. 运行 `pnpm exec tsx --test tests/specs/backend-type-module-boundary.spec.ts` 记录现有边界状态。

## 1. 盘点和拆分顺序

- [x] 5. 列出 `project-domain-core.ts` 当前导出的所有公共入口和内部 helper。
- [x] 6. 将 helper 按项目配置、项目发现、手动路由、Provider transcript、Provider index、overview、搜索、rename、delete 分组。
- [x] 7. 标注每组入口的现有测试覆盖和缺口。
- [x] 8. 确认 `backend/projects.ts` 的公共导出在拆分期间不变。
- [x] 9. 确认 `project-domain-service.ts` 只做聚合 facade，不承载业务规则。

## 2. 类型和共享模型

- [x] 10. 定义 `ProjectConfig`、`ProjectChatRecord`、`ManualSessionRouteRecord` 等项目配置类型。
- [x] 11. 定义 Codex/Pi provider session header 的 typed 输出。
- [x] 12. 定义 `ProjectSummary`、`ProjectOverview` 和 `SearchResult` 的窄类型。
- [x] 13. 把 provider 原生 JSON 输入统一收敛为 `unknown` parser。
- [x] 14. 移除新模块公共 API 中不必要的 `any`。
- [x] 15. 为每个新增或重写函数补充解释业务意图的 docstring。

## 3. 项目配置边界

- [x] 16. 把 config key、schema version、legacy key 读取迁入 `project-config-read-model.ts`。
- [x] 17. 把 displayName、session summary、workflow metadata、ui state、model state 归一化迁入配置模块。
- [x] 18. 保留旧配置读取兼容，但写回只使用当前 schema。
- [x] 19. 为 config 保存路径和 XDG state 行为保留既有回归。
- [x] 20. 确认项目配置模块不从 `project-domain-core.ts` 导入业务实现。

## 4. 手动 cN 路由边界

- [x] 21. 把 draft 创建、route counter、route index 分配迁入 `manual-session-route-read-model.ts`。
- [x] 22. 把 start lock、provider binding 和 runtime 查询迁入同一边界。
- [x] 23. 把 finalize 行为迁入同一边界，保持 `cN` route 与真实 provider id 的映射。
- [x] 24. 保留 workflow-owned draft 过滤和普通手动会话过滤规则。
- [x] 25. 运行本提案业务测试验证 manual route evidence。

## 5. Provider transcript 和索引边界

- [x] 26. 把 JSONL tail window、afterLine、cursor cache 迁入 `provider-transcript-read-model.ts`。
- [x] 27. 把 Codex transcript header 和 message mapping 迁入 Codex provider 子模块。
- [x] 28. 把 Pi transcript header 和 message mapping 迁入 Pi provider 子模块。
- [x] 29. 把 Codex/Pi session index cache 和 projectPath 归属迁入 provider index 模块。
- [x] 30. 保留 `indexProviderSessionFile` 和 `deleteProviderSessionIndexFile` 的公共入口。
- [x] 31. 运行 `tests/specs/session-incremental-read.spec.ts` 验证增量读取不退化。

## 6. Overview、搜索、rename 和 delete

- [x] 32. 把单项目 overview 聚合迁入 `project-overview-service.ts`，只调用 focused modules。
- [x] 33. 把 `searchChatHistory` 主体迁入 `chat-history-search-service.ts`。
- [x] 34. 确认项目清单默认路径不会调用搜索服务或完整 transcript 深读。
- [x] 35. 把 `renameProject`、`renameSession`、`renameCodexSession` 迁入 rename service。
- [x] 36. 把 `deleteSession`、`deleteCodexSession`、`deleteProject`、`isProjectEmpty` 迁入 delete service。
- [x] 37. 保留 Provider 文件删除、manual route 删除和归档索引清理语义。
- [x] 38. 运行既有 rename/delete 后端测试覆盖真实文件状态。

## 7. 迁移核心收敛

- [x] 39. 删除 focused modules 中所有 `from './project-domain-core.js'` 的业务 re-export。
- [x] 40. 删除 `projectDiscoveryReadModelEntry` 等只用于证明模块存在的哨兵常量。
- [x] 41. 将 `project-domain-core.ts` 收敛到 1200 行以内或删除。
- [x] 42. 移除 `project-domain-core.ts` 的 `@ts-nocheck`。
- [x] 43. 确认 core 不再定义主要业务入口函数。
- [x] 44. 确认 `project-domain-service.ts` 不直接从 core 导出业务入口。

## 8. 性能和并发

- [x] 45. 为项目清单、overview 和搜索补齐业务 scope 合并策略。
- [x] 46. 确认同 scope 并发读取只执行一次真实重任务。
- [x] 47. 确认失败 scope 不缓存错误，下一次可重试。
- [x] 48. 生成 `/api/projects` runtime log，证明默认项目清单不等待搜索或完整 transcript 深读。
- [x] 49. 记录 Provider index 慢路径不会阻塞手动项目列表。

## 9. 回归和验收

- 2026-06-16 执行记录：`tests/specs/backend-type-module-boundary.spec.ts` 的项目域边界断言原先要求 `*Entry = true` 哨兵常量；本提案验收明确禁止用哨兵代替真实实现，因此已将该历史断言同步为检查真实业务入口导出。

- [x] 50. 运行 `pnpm exec tsx --test docs/changes/18-项目域核心类型化拆分/tests/project-domain-boundary.acceptance.test.ts`。
- [x] 51. 运行 `pnpm exec tsx --test docs/changes/18-项目域核心类型化拆分/tests/project-domain-business.acceptance.test.ts`。
- [x] 52. 运行 `pnpm exec tsx --test tests/specs/provider-session-list-read-model.spec.ts`。
- [x] 53. 运行 `pnpm exec tsx --test tests/specs/session-incremental-read.spec.ts`。
- [x] 54. 运行 `pnpm exec tsx --test tests/specs/backend-type-module-boundary.spec.ts`。
- [x] 55. 运行 `pnpm run typecheck`。
- [x] 56. 运行 `pnpm run test:server:smoke`。
- [x] 57. 核对 `acceptance.json` 中 required evidence 均可重新生成。
- [x] 58. 更新必要的 `docs/specs/` 长期规格和测试导读。
- [x] 59. 确认本变更没有修改 ignored 运行态、缓存、依赖或构建产物。
- [x] 60. 汇总剩余风险和未纳入本提案的后续优化点。
