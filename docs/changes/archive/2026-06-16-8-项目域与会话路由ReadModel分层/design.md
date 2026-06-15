# 设计：项目域与会话路由 ReadModel 分层

## 决策

1. 保留 `backend/projects.ts` 作为兼容 facade，避免一次性改动所有调用点。
2. 优先迁移纯 read model 和 service 逻辑，不改变 HTTP API、WebSocket payload 或前端字段。
3. manual route、provider session list、workflow-owned 过滤必须由小模块提供纯函数入口。
4. 删除和归档路径使用 service 包装副作用，避免 read model 内直接修改索引和配置。

## 取舍

短期会存在 facade 转发和新模块并行。这个过渡比一次性重写更稳定，因为现有测试可以逐步绑定新入口，前端不需要同步改 URL。

## 风险

- 历史 project config v1/v2 迁移分支容易被误删。
- provider-only 项目发现和真实工作区项目合并顺序可能改变。
- 删除 session 时同时涉及 JSONL、provider index 和本地 config，必须用真实文件测试覆盖。

## 验证策略

先写边界契约测试，再迁移已有规格测试到新入口。浏览器路径只需要验证用户可见首页、overview、打开会话和删除/重命名仍正常。
