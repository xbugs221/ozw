# 规格：后端真实服务测试夹具

## 验收矩阵

| 场景 | 规格测试 | 运行时证据 |
| --- | --- | --- |
| 真实 server 测试通过共享 helper 启动 | `tests/specs/backend-service-test-fixture.spec.ts` | `test-results/backend-service-fixture/source-audit.json` |
| WebSocket 测试统一使用 Authorization header | `tests/specs/backend-service-test-fixture.spec.ts` | `test-results/backend-service-fixture/source-audit.json` |
| 子进程环境统一隔离数据库和 JWT 密钥 | `tests/specs/backend-service-test-fixture.spec.ts` | `test-results/backend-service-fixture/source-audit.json` |

### 需求：真实后端服务测试必须复用共享夹具

#### 场景：真实 server 测试通过共享 helper 启动

- **测试文件**：`tests/specs/backend-service-test-fixture.spec.ts`
- **真实数据来源**：读取真实测试源码和 helper 源码
- **入口路径**：`tests/backend/helpers/backend-service-fixture.ts`
- **关键断言**：helper 导出启动、注册用户、认证 WS 和停止函数；迁移后的目标测试不再直接 spawn 后端入口
- **来源提案**：`docs/changes/archive/2026-06-15-2-统一后端真实服务测试夹具`

#### 场景：WebSocket 测试统一使用 Authorization header

- **测试文件**：`tests/specs/backend-service-test-fixture.spec.ts`
- **真实数据来源**：读取 helper 源码和已迁移测试源码
- **入口路径**：`openAuthenticatedWebSocket`
- **关键断言**：helper 使用 `authorization: Bearer`，目标测试不得出现 `/ws?token=`
- **剩余风险**：浏览器端真实连接仍由现有 e2e 覆盖

### 需求：测试子进程必须隔离本机状态

#### 场景：子进程环境统一隔离数据库和 JWT 密钥

- **测试文件**：`tests/specs/backend-service-test-fixture.spec.ts`
- **真实数据来源**：读取 helper 源码
- **入口路径**：`startIsolatedBackendServer`
- **关键断言**：helper 显式设置 `DATABASE_PATH`、`JWT_SECRET`、`HOST`、`SESSION_PATH_SCAN_INTERVAL_MS`
- **剩余风险**：不覆盖外部 provider 真账号，仅保证测试 server 不读取本机默认 auth.db
