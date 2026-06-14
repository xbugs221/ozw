# 规格：后端安全边界

## 需求：认证默认安全

后端不得在生产路径使用弱默认 JWT secret，也不得签发永不过期 token。

### 场景：JWT 缺少强 secret 时 fail closed

- **给定** 后端认证模块加载配置
- **当** 未配置强 `JWT_SECRET`
- **则** 生产路径不得签发可用 token
- **且** token 签发必须包含有效期

## 需求：Agent 和 Git 路径必须限制在允许工作区

Agent API、Git route 和 provider runtime 不得把任意客户端传入路径交给 Codex 或 Git 操作。

### 场景：工作区外路径被拒绝

- **给定** 一个已注册项目路径
- **且** 请求传入 `/tmp`、`/etc`、父目录跳转或符号链接逃逸路径
- **当** 后端解析 `projectPath`
- **则** 请求必须被拒绝
- **且** 不得进入高权限执行或 Git 操作

## 需求：Codex 默认权限遵循本地 YOLO 预期

Codex app-server、SDK runtime 和 CLI fallback 的默认 sandbox/approval policy 必须保持 ozw 本地开发预期：`danger-full-access` 和 `never`。

### 场景：默认运行使用 YOLO 权限

- **给定** 用户以默认权限启动 Agent 或 Codex app-server
- **当** 后端构造 thread/start 或 CLI 参数
- **则** sandbox 必须为 `danger-full-access`
- **且** approval policy 必须为 `never`

## 需求：Token 和凭据不得通过易泄漏路径传播

认证 token、API key 和 GitHub token 不得出现在 URL query 或 Git 进程参数；新写入凭据不得明文持久化。

### 场景：URL query token 被移除且凭据不明文落库

- **给定** HTTP、WebSocket、SSE、Shell、Agent API 和 Git clone 入口
- **当** 用户登录、连接实时通道、保存 provider 凭据或使用已保存 GitHub token clone 项目
- **则** URL query 不得包含 `token`、`apiKey` 或 GitHub token
- **且** GitHub token 不得出现在 clone URL、进程参数或直接环境变量值中
- **且** 新增 API key 必须摘要保存，recoverable credential 必须加密保存
- **且** 旧明文或旧密文凭据读取后必须兼容迁移

对应规格测试：`tests/specs/backend-security-boundary.spec.ts`。
