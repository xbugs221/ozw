# 设计：统一后端真实服务测试夹具

## helper 位置

建议新增：

`tests/backend/helpers/backend-service-fixture.ts`

该文件只服务测试，不进入生产依赖。

## API 草案

```ts
type BackendServerFixture = {
  port: number;
  baseUrl: string;
  tempRoot: string;
  binDir: string;
  databasePath: string;
  child: ChildProcess;
  output: () => string;
};

async function startIsolatedBackendServer(options?: {
  env?: NodeJS.ProcessEnv;
  setupBinDir?: (binDir: string, tempRoot: string) => Promise<void>;
}): Promise<BackendServerFixture>;

async function registerTestUser(fixture: BackendServerFixture, user?: {
  username: string;
  password: string;
}): Promise<{ token: string; user: unknown }>;

async function openAuthenticatedWebSocket(fixture: BackendServerFixture, token: string): Promise<WebSocket>;

async function stopBackendServerFixture(fixture: BackendServerFixture): Promise<void>;
```

## 关键约束

- 子进程必须显式设置 `DATABASE_PATH`、`JWT_SECRET`、`HOST=127.0.0.1`、`SESSION_PATH_SCAN_INTERVAL_MS=0`
- WebSocket 认证必须使用 `Authorization: Bearer <token>` header
- helper 必须统一收集 stdout/stderr，失败时能把 server 输出带回断言消息
- 清理必须关闭子进程并删除 temp root

## 风险

迁移时如果一次改太多测试，可能掩盖原本测试的业务意图。执行阶段应分批迁移，并保持每个测试原有断言不变。
