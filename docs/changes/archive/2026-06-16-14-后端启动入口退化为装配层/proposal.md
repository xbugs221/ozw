# 提案：后端启动入口退化为装配层

## 为什么现在做

后端入口已经有边界测试防止退化，但 `server-bootstrap.ts` 仍是最大风险文件之一。它混合了路由、WebSocket、启动输出、系统更新和依赖装配，导致小改动也需要审阅大量无关上下文。

## 做什么

- 新增 `backend/server/http/system-routes.ts` 承载 `/api/system/update`。
- 新增 `backend/server/websocket-gateway.ts` 承载 WebSocket path auth 与分派。
- 新增 `backend/server/startup-banner.ts` 或同等模块承载启动输出格式。
- `server-bootstrap.ts` 只保留 app/server 创建、模块注册、watcher 启停和 shutdown 顺序。

## 可观察结果

维护者调整 HTTP API 或 WebSocket 行为时可以进入明确模块；启动入口行数、直接 route 数和 `any` 使用明显下降。
