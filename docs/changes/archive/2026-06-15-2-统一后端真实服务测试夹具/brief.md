# 简报：统一后端真实服务测试夹具

## 用户问题

后端测试里多处重复启动真实 server、创建临时数据库、注册用户和打开 WebSocket。每次安全或认证契约变化，都需要在多个测试文件里同步修改，容易出现 URL token、JWT_SECRET、DATABASE_PATH 隔离等口径漂移。

## 交付目标

新增共享后端测试夹具，统一真实服务测试的启动、用户注册、认证 WebSocket 和清理流程，并迁移现有重复测试调用方。

## 非目标

- 不 mock Express server 或 WebSocket
- 不绕过认证中间件
- 不把所有后端单元测试改成集成测试

## 验收入口

- 契约测试：`pnpm exec tsx --test docs/changes/2-统一后端真实服务测试夹具/tests/backend-service-fixture.contract.test.ts`
- 回归测试：`pnpm test:server`

## 执行默认上下文

优先在 `tests/backend/helpers/` 下新增 helper。保留现有测试语义，迁移时只删除重复启动和认证样板，不降低真实 HTTP/WS 覆盖。
