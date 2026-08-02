# 规格：后端安全边界

## 需求：认证默认安全

部署者必须配置固定 32 字符访问令牌；后端以恒定时间比较该令牌，并自动管理仅供内部会话使用的 JWT secret。

### 场景：固定访问令牌换取内部会话

- **给定** `.env` 中配置了恰好 32 个字符的 `OZW_ACCESS_TOKEN`
- **当** 用户在登录界面提交访问令牌
- **则** 后端必须以恒定时间比较并只在匹配时签发内部 JWT
- **且** 不得提供注册、用户名选择或 localhost 首用户绕过路径
- **且** 配置缺失或长度错误时必须明确拒绝认证

### 场景：JWT secret 自动安全生成

- **给定** 后端认证模块首次为当前数据库签发 token
- **当** 尚未生成 JWT secret
- **则** 运行时必须自动生成并以仅所有者可读写的权限持久化强 secret
- **且** 重启或多个服务进程必须复用同一 secret
- **且** token 签发必须包含有效期

## 需求：Agent 和 Git 路径必须限制在允许工作区

Agent API、Git route 和 provider runtime 不得把任意客户端传入路径交给 Codex 或 Git 操作。

### 场景：工作区外路径被拒绝

- **给定** 一个已注册项目路径
- **且** 请求传入 `/tmp`、`/etc`、父目录跳转或符号链接逃逸路径
- **当** 后端解析 `projectPath`
- **则** 请求必须被拒绝
- **且** 不得进入高权限执行或 Git 操作

## 需求：Codex 权限策略由独立系统服务负责

ozw 只作为 Codex app-server 客户端，不得覆盖独立系统服务的沙箱或审批策略。

### 场景：创建线程时不注入服务权限

- **给定** 用户通过 ozw 启动 Codex 会话
- **当** 后端构造 `thread/start` 或客户端 proxy 参数
- **则** 不得传入 sandbox 或 approval policy 覆盖
- **且** 系统管理员应在独立 Codex 服务侧维护所需权限策略

## 需求：Token 和凭据不得通过易泄漏路径传播

认证 token、API key 和 GitHub token 不得出现在 URL query 或 Git 进程参数。

### 场景：URL query token 被移除且 API key 摘要落库

- **给定** HTTP、WebSocket、SSE、Shell、Agent API 和 Git clone 入口
- **当** 用户登录、连接实时通道或使用已保存 GitHub token clone 项目
- **则** URL query 不得包含 `token`、`apiKey` 或 GitHub token
- **且** GitHub token 不得出现在 clone URL、进程参数或直接环境变量值中
- **且** 新增 API key 必须摘要保存

ozw 不再管理可恢复凭据的应用层加密密钥，也不提供新的持久化写入入口。若数据库中已有历史 provider 凭据，部署者必须使用操作系统访问控制保护数据库文件；使用旧密钥加密的记录升级后无法继续解密，需要在运行时重新提供凭据。

对应规格测试：`tests/specs/backend-security-boundary.spec.ts`。

## 需求：后端命令和文件边界 helper 必须有默认回归

命令解析、路径安全、输出清理、项目文件树过滤和权限文本转换属于安全边界的低状态核心规则，必须进入默认 Node 后端测试入口。

### 场景：命令 allowlist 与输出清理默认回归

- **给定** 用户触发后端命令 helper 处理命令字符串、参数和输出
- **当** 命令包含 shell operator、非 allowlist 命令、危险参数或越界路径
- **则** helper 必须拒绝该命令或路径
- **且** allowlist 中的安全命令必须能解析出 command 和 args
- **且** 输出清理必须移除控制字符但保留换行
- **测试文件**：`tests/backend/command-parser.test.ts`

### 场景：文件树跳过项和权限文本默认回归

- **给定** 项目文件树包含 `node_modules`、`dist`、`.git` 和普通业务目录
- **当** 后端构建文件树 helper 判断是否跳过目录
- **则** 重目录必须被跳过，普通业务目录不得被误跳过
- **且** Unix permission bit 必须转换成用户可读 rwx 文本
- **测试文件**：`tests/backend/file-routes-boundary.test.ts`
