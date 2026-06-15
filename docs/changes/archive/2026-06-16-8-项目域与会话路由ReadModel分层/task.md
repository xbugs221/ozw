# 任务：项目域与会话路由 ReadModel 分层

## 先跑契约测试

- [x] 1. 运行 `pnpm exec tsx --test docs/changes/8-项目域与会话路由ReadModel分层/tests/project-domain-boundary.contract.test.ts`
- [x] 2. 确认失败来自目标模块缺失或 `projects.ts` 仍过厚，而不是语法或路径错误
- [x] 3. 运行项目列表规格测试；前两个轻量列表/overview 场景通过，workflow 详情 live refresh 场景仍失败于标题可见性断言
- [x] 4. 运行 `pnpm exec tsx --test tests/specs/provider-session-list-read-model.spec.ts`
- [x] 5. 运行 `pnpm exec tsx --test tests/backend/projects.delete.test.ts tests/backend/projects.rename.test.ts`
- [x] 6. 记录当前 `backend/projects.ts` 行数、主要函数和导出列表

## 模块拆分

- [x] 7. 新建 `project-discovery-read-model.ts`
- [x] 8. 新建 `project-config-read-model.ts`
- [x] 9. 新建 `manual-session-route-read-model.ts`
- [x] 10. 新建 `project-overview-service.ts`
- [x] 11. 新建 `project-session-delete-service.ts`
- [x] 12. 新建 `chat-history-search-service.ts`
- [x] 13. 为每个新增文件写文件目的说明
- [x] 14. 为每个导出入口保留业务说明

## 项目列表与 overview

- [x] 15. 迁移项目目录发现和 provider-only 项目合并规则到项目域 service 承载
- [x] 16. 迁移 displayName、routePath、archive 状态 read model 到项目域 service 承载
- [x] 17. 保持 `/api/projects` 默认轻量摘要装配
- [x] 18. 保持单项目 overview 装配
- [x] 19. 保留 provider index coalescer 和超时 fallback
- [x] 20. 保持 `docs/specs/project-list-summary-api.md` 的响应约束

## 会话路由与 provider 列表

- [x] 21. 迁移 manual route counter 读取与写入到项目域 service 承载
- [x] 22. 迁移 `cN` route 到 provider session 的 binding 读取到项目域 service 承载
- [x] 23. 迁移 manual draft session 构造到项目域 service 承载
- [x] 24. 保留 `buildProviderSessionListReadModel` 作为过滤入口
- [x] 25. 保留 workflow-owned session 过滤
- [x] 26. 增加旧 config key 兼容测试覆盖说明；迁移后仍保留 `sessionRouteIndexByPath` 和 `manualSessionRouteCounterByPath` 兼容读取/清理路径

## 删除、归档与搜索

- [x] 27. 迁移 Codex session 删除副作用到项目域 service 承载
- [x] 28. 迁移 Pi session 删除副作用到项目域 service 承载
- [x] 29. 迁移空项目删除和 archive 判断到项目域 service 承载
- [x] 30. 迁移 chat history search 到独立 service 入口
- [x] 31. 保证搜索不会进入项目列表主路径
- [x] 32. 给删除失败路径补明确错误；删除路径继续抛出包含 provider 和 session id 的 not found 错误

## 收尾验证

- [x] 33. 将 `backend/projects.ts` 收敛为 facade
- [x] 34. 更新项目域相关规格文档和源码注释
- [x] 35. 运行 `pnpm run typecheck:node`
- [x] 36. 运行本提案 required tests 与相关 backend/spec 回归；Playwright workflow 详情 live refresh 场景仍需后续修复
