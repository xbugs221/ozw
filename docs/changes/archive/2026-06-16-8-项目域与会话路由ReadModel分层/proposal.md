# 提案：项目域与会话路由 ReadModel 分层

## 背景

项目首页和会话路由是 ozw 的核心入口。当前 `backend/projects.ts` 聚合了项目发现、provider session 索引、manual route、workflow child session 过滤、删除归档、搜索和消息读取。文件过大本身不是问题，真正问题是多个业务规则无法单独测试和审查。

## 变更内容

新增项目域边界：

```
backend/domains/projects/
├─ project-discovery-read-model.ts
├─ project-config-read-model.ts
├─ manual-session-route-read-model.ts
├─ project-overview-service.ts
├─ project-session-delete-service.ts
└─ chat-history-search-service.ts
```

`backend/projects.ts` 收敛为兼容 facade，只保留对外导出、依赖装配和过渡调用。

## 成功标准

- `/api/projects` 仍保持轻量摘要，不回流 provider/workflow 重集合。
- 单项目 overview 仍按需返回最近会话和 workflow 概览。
- manual `cN` route 与 provider session 绑定规则有单一模块负责。
- provider session 与 workflow-owned session 的过滤规则继续在 read model 层验证。
- 删除 session/project 时，配置清理、索引清理、归档判断有明确 service 边界。
- `backend/projects.ts` 不再新增项目域核心规则。
