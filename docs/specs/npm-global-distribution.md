# NPM 全局发行规格

本文档定义 ozw 预编译 NPM 包的安装、首次启动、用户数据边界、升级、卸载和发布约束。

## 预编译成品

发行候选包必须由锁定依赖的工作树构建一次。安装后的 `ozw` 只能读取编译产物和必要运行资产，不得依赖 Git、pnpm、TypeScript、tsx、tsc 或 Vite。

### 真实压缩包全局安装

- `bin.ozw` 必须指向 Node.js 可直接执行的编译入口。
- 包内必须包含编译后端、前端、数据库 SQL 和命令资产。
- 包内不得包含 TypeScript、source map、测试、提案文档、开发脚本或运行数据。
- `/health`、WebUI 首页和访问令牌配置状态必须能从已安装包正常返回。
- 安装、打包、启动和发布阶段不得重新执行产品构建。

## 安全用户态

所有可变数据必须位于 `OZW_HOME` 或默认的 `~/.ozw`，不得写入全局包目录。

### 首次、重复与并发初始化

- `.env`、`ozw.db` 和 `.jwt-secret` 必须位于同一用户目录。
- 缺少访问令牌时，必须使用密码学安全源生成恰好 32 个 URL-safe 字符。
- JWT 密钥必须独立持久化，不得出现在 `.env`、终端或日志。
- 仅创建新访问令牌的首次运行可以显示令牌；重启和并发初始化不得覆盖既有秘密。
- 已有无效访问令牌必须返回可操作错误，不得静默替换。
- POSIX 用户目录权限必须为 `0700`，秘密文件必须为 `0600`；Windows 使用平台 ACL 语义。
- 启动入口必须先完成用户态初始化，再加载任何可能打开 SQLite 的服务模块。

## 本地运行边界

### 只读安装目录与默认回环监听

- 安装目录设为只读后，`ozw` 与 `ozw status` 仍必须可运行。
- 安装目录不得生成 `.env`、JWT 密钥、SQLite、WAL 或 SHM 文件。
- `ozw status` 必须显示与服务相同的有效配置和数据库路径，且不得在未初始化 HOME 中创建秘密。
- 未显式配置 `HOST` 时必须监听 `127.0.0.1`。
- 显式进程环境中的 `HOST`、`PORT` 和 `DATABASE_PATH` 必须高于用户 `.env`。

## 升级与卸载

### 保留用户数据

- 用较低 patch 候选包创建的访问令牌、JWT 密钥和 SQLite 数据，升级后必须保持并可读取。
- 标准 `npm uninstall -g ozw` 只能移除全局命令和程序目录。
- 卸载后用户 `.env`、`.jwt-secret`、SQLite 数据及业务标记必须保留。
- 数据库 schema 发生变化时，必须额外使用真实旧版数据夹具验证迁移。

## 发布产物身份

### 平台矩阵与正式发布复用同一压缩包

- 候选作业必须记录 tgz 的包名、版本、文件名和 SHA-256。
- 平台安装矩阵和 publish 作业必须下载并校验候选作业生成的同一 tgz。
- publish 不得重新构建，必须依赖候选质量门和完整安装矩阵。
- 正式发布必须经过受保护 environment 与 OIDC Trusted Publisher。
- 发布后必须从公开注册表重新下载并核对候选摘要。
- 未实际运行远端矩阵或公开发布时，不得声称这些外部结果已经通过。

## 验证入口

- `pnpm exec tsx --test tests/specs/npm-global-distribution.spec.ts`
- `pnpm exec tsx --test tests/specs/backend-type-module-boundary.spec.ts`
