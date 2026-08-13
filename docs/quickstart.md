# 快速开始

[English](./quickstart_en.md) | 中文

---

本指南区分正式发行、候选包验收和源码开发。普通用户在正式发布后应使用 NPM 全局安装。

## 1. 选择安装方式

### 正式发行版（发布后首选）

> **当前状态：** `ozw` 是候选包名，公共 NPM 包尚未发布，包名所有权和发行验收仍待完成。以下命令是发布后的正式入口；现在请勿从公共注册表安装同名包。

在受支持的平台，只需要 Node.js 24（最低 24.17.0）或 Node.js 26（最低 26.4.0）：

```sh
npm install -g ozw
ozw --version
ozw
```

无需 Git、pnpm、TypeScript 或前端构建工具。

### 候选包验收（当前发行测试）

只安装维护者提供或从本仓库构建的 `.tgz`，不要从公共注册表下载同名包：

```sh
npm install -g ./ozw-VERSION.tgz
ozw --version
ozw
```

请将 `VERSION` 替换为候选包文件名中的实际版本。

候选包尚未完成发行验收；如果测试的是尚未包含首次初始化改造的旧候选包，请为该次进程显式传入 32 字符令牌：

```sh
OZW_ACCESS_TOKEN="$(openssl rand -hex 16)" ozw
```

验证结果请附带操作系统、架构、Node.js 版本和候选包版本。

## 2. 首次运行与登录

正式发行合同如下：

1. `ozw` 幂等创建私有用户目录 `~/.ozw`。
2. 缺少访问令牌时，自动生成恰好 32 个字符的 `OZW_ACCESS_TOKEN` 并写入 `~/.ozw/.env`。
3. 输出登录地址；交互式终端仅在新生成时显示令牌，非交互运行不把令牌写入日志，可从私有的 `~/.ozw/.env` 读取。
4. 默认仅监听 `127.0.0.1:3001`，打开 `http://127.0.0.1:3001` 后输入该令牌；无需注册账号。

再次运行不得覆盖已有令牌、数据库或内部 JWT 密钥。使用以下命令检查实际生效的版本、路径和配置：

```sh
ozw status
```

数据默认保存在 `~/.ozw`，其中 SQLite 数据库为 `~/.ozw/ozw.db`。数据库应位于本机磁盘；不要把 SQLite 主库放在 NFS、SMB/CIFS 或 WebDAV 等网络文件系统上。

## 3. 可选能力与诊断

基础 Web 工作台不以 `oz`、Codex 或 Pi 为启动硬依赖。缺少某个工具时，仅禁用对应能力：

| 工具 | 启用能力 | 自检命令 |
|---|---|---|
| `oz` | `oz flow` 工作流 | `oz --version`、`oz flow contract --json` |
| Codex | Codex 会话 | 按 Codex 官方方式安装、登录并运行所需服务 |
| Pi | Pi 会话 | 按 Pi 官方方式安装并登录 |

ozw 只诊断这些外部工具，不替它们安装、登录、升级或管理进程。启动后在设置页查看运行时诊断；具体缺失项只影响对应功能。

`node-pty` 是 Web 终端的可选依赖；缺失时基础 HTTP/WebUI 仍可启动，但终端不可用，重装 optional 依赖即可恢复。

## 4. 配置与远程访问

显式环境变量优先于 `~/.ozw/.env`。常用配置：

| 配置项 | 默认值 | 用途 |
|---|---:|---|
| `HOST` | `127.0.0.1` | 服务监听地址 |
| `PORT` | `3001` | Web 页面、API 和 WebSocket 端口 |
| `DATABASE_PATH` | `~/.ozw/ozw.db` | SQLite 数据库路径 |
| `OZW_HOME` | `~/.ozw` | 用户态配置与数据根目录；只能通过父进程环境设置 |
| `OZW_ACCESS_TOKEN` | 首次生成 | 32 字符浏览器访问令牌 |
| `JWT_EXPIRES_IN` | `24h` | 登录令牌有效期 |

远程访问是可选能力。确有需要时，显式设置监听地址，并在可信的 HTTPS 反向代理或隧道后访问：

```sh
HOST=0.0.0.0 ozw
```

ozw 可以读取仓库、运行 shell，并访问本地 provider 配置；不要直接把端口暴露到公网。请保护 `OZW_ACCESS_TOKEN`、`~/.ozw` 和 provider 凭据，并限制反向代理的访问来源。HTTPS 访问时可将 PWA 添加到手机主屏幕。

## 5. 升级、回滚与卸载

正式发布后升级到最新版：

```sh
npm update -g ozw
```

安装指定版本可用于回滚程序：

```sh
npm install -g ozw@VERSION
```

候选包使用新版 `.tgz` 覆盖安装：

```sh
npm install -g ./ozw-NEW_VERSION.tgz
```

卸载程序：

```sh
npm uninstall -g ozw
```

升级、回滚和卸载默认保留 `~/.ozw`。卸载后如需永久删除全部本地配置、令牌和数据库，请先备份，再由用户显式删除该目录；ozw 不会替你自动清理。

## 6. 源码开发

源码路径面向贡献者，不是正式安装方式。需要 Git、`package.json` `engines.node` 声明的 Node.js 版本，以及 [package.json](../package.json) `packageManager` 字段指定的 pnpm 版本。

```sh
git clone https://github.com/xbugs221/ozw.git
cd ozw
corepack enable
pnpm install
pnpm run hooks:install
pnpm dev
```

若 Node.js 环境未提供 Corepack，请按 Corepack 官方方式安装，或直接安装 `package.json` 指定的 pnpm 版本。首次启动同样会初始化 `~/.ozw/.env`；如需隔离开发数据，可设置 `OZW_HOME`：

```sh
OZW_HOME="$PWD/.tmp/ozw-home" pnpm dev
```

也可直接用进程环境变量覆盖单项配置。源码开发的浏览器入口通常为 `http://127.0.0.1:5173`，后端为 `http://127.0.0.1:3001`；Vite 开发服务有独立监听配置，不要把开发模式暴露到公网。

构建并验证生产产物：

```sh
pnpm run build
pnpm start
```

构建供本机验收的候选包：

```sh
npm pack
npm install -g ./ozw-VERSION.tgz
```

## 7. 验证与排错

```sh
ozw --version
ozw status
curl http://127.0.0.1:3001/health
```

然后打开浏览器，输入访问令牌，并按需要验证项目文件、终端及已安装 provider 的能力。常见安装、端口、登录和 provider 问题见 [故障排除](./troubleshooting.md)。
