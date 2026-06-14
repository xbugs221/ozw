# 提案：统一后端真实服务测试夹具

## 背景

`tests/backend/co-idle-status.test.ts`、`tests/backend/pi-websocket-behavior.test.ts`、`tests/backend/pi-cli-diagnostics.test.ts` 等测试都需要启动真实 ozw server。它们目前各自维护端口选择、子进程环境、注册用户、WebSocket token 传递和清理逻辑。

这种重复导致两个问题：

- 安全契约变化时，个别测试容易继续使用过期鉴权方式
- 本地未跟踪数据库或 `.env` 可能影响测试隔离

## 变更内容

新增共享测试 helper，至少提供：

- `startIsolatedBackendServer(options)`
- `registerTestUser(fixture, user?)`
- `openAuthenticatedWebSocket(fixture, token)`
- `stopBackendServerFixture(fixture)`

迁移真实 server 测试后，测试文件不再直接调用 `spawn(process.execPath, [tsx, backend/index.ts])`，也不再在 WebSocket URL query 里传 token。

## 为什么现在做

最近 CI 修复已经暴露了认证和数据库隔离漂移。把这些样板集中到 helper 能降低后续安全边界变更的维护成本。
