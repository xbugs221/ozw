# 任务：统一后端真实服务测试夹具

## 1. 契约测试先行

- [x] 运行 `pnpm exec tsx --test docs/changes/2-统一后端真实服务测试夹具/tests/backend-service-fixture.contract.test.ts`
- [x] 确认初始失败原因是 helper 或迁移缺失，而不是测试路径错误

## 2. 新增共享 helper

- [x] 新增 `tests/backend/helpers/backend-service-fixture.ts`
- [x] 封装端口申请、server 子进程启动、健康检查、注册用户、认证 WebSocket 和清理
- [x] helper 统一写入测试 JWT_SECRET 和临时 DATABASE_PATH

## 3. 迁移重复测试

- [x] 迁移 `tests/backend/co-idle-status.test.ts`
- [x] 迁移 `tests/backend/pi-websocket-behavior.test.ts`
- [x] 迁移 `tests/backend/pi-cli-diagnostics.test.ts`
- [x] 保留每个测试原有业务断言

## 4. 验证

- [x] `pnpm exec tsx --test docs/changes/2-统一后端真实服务测试夹具/tests/backend-service-fixture.contract.test.ts`
- [x] `pnpm test:server`
- [x] 保存 `test-results/backend-service-fixture/source-audit.json`
