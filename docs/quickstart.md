# 快速开始

[English](./quickstart_en.md) | 中文

---

本指南将帮助你在本地或服务器上启动并运行 **ozw**。

### 1. 检查基础环境

- **Node.js 26.4.0**：推荐版本；最低支持 24.17.0，以 `.nvmrc` 和 `package.json` 为准。
- **pnpm 11.10.0**：以 `package.json` 的 `packageManager` 字段为准，建议使用 Corepack 固定版本。
- **oz**：必须安装在服务进程 `PATH` 中。ozw 启动时会检查 `oz flow contract --json`，并通过 `oz list` 发现活跃变更、通过 `oz flow` 执行工作流。
- **Codex/Pi**：不是 ozw 启动硬依赖；使用 Codex 时，需由系统服务管理器独立运行并维护已认证的 Codex app-server 守护进程，ozw 只连接其 Unix Socket；Pi 仍按官方方式安装和登录。

```sh
corepack enable
corepack prepare pnpm@11.10.0 --activate
node --version
pnpm --version
oz --version
oz flow contract --json
```

### 2. 获取代码并配置

```sh
git clone https://github.com/xbugs221/ozw.git
cd ozw
pnpm install
pnpm run hooks:install
cp .env.example .env
openssl rand -hex 16  # 将输出写入 .env 的 OZW_ACCESS_TOKEN
```

`OZW_ACCESS_TOKEN` 是唯一的浏览器登录凭据，必须恰好为 32 个字符。JWT 签名密钥由 ozw 自动生成并持久化到数据库旁，仅用于内部会话；部署时还需确认 `HOST`、`PORT` 与反向代理配置一致。

| 配置项 | 默认值 | 用途 |
|---|---:|---|
| `PORT` | `3001` | 生产 Web 页面、API 和 WebSocket 端口 |
| `VITE_PORT` | `5173` | 开发模式前端端口 |
| `HOST` | `0.0.0.0` | 服务监听地址 |
| `OZW_ACCESS_TOKEN` | 必填 | 32 字符浏览器访问令牌 |
| `JWT_EXPIRES_IN` | `24h` | 登录令牌有效期 |

### 3. 启动方式

生产或服务器运行：

```sh
pnpm start
```

`pnpm start` 会先执行构建，再由后端在 `PORT` 上提供静态页面、API 和 WebSocket。默认访问地址是：

```text
http://localhost:3001
```

本地开发运行：

```sh
pnpm dev
```

开发模式默认访问地址是：

```text
http://localhost:5173
```

首次访问时只输入 `OZW_ACCESS_TOKEN`，不创建或选择账号。本机 `localhost` 与远程访问使用相同认证流程。

### 4. 实现“编程接力”（推荐配置）

为了发挥 ozw 跨设备接力的最大优势，建议将其部署在公网可达的环境中：

- **公网服务器：** 直接在服务器启动。
- **本地开发机：** 使用 `frp`、`nps` 或 Cloudflare Tunnel。

生产模式通常只需要映射 `PORT=3001`。开发模式才需要同时关注 `5173` 前端端口和 `3001` 后端端口。

公网部署建议：

| 项目 | 建议 |
|---|---|
| 协议 | 使用 HTTPS，方便 PWA 和移动端访问 |
| 认证 | 妥善保管 `OZW_ACCESS_TOKEN`、数据库及自动生成的签名密钥文件 |
| Provider | 确认 ozw 能访问 `oz`、`codex` 命令和账号文件；Codex app-server 由系统守护进程独立运行 |
| 数据 | 数据库默认位于本机 `~/.ozw/ozw.db`；不要把 SQLite 主库放在 NFS/SMB 网络共享盘，远程项目目录不受此限制 |

### 5. 验证

打开浏览器访问你的 ozw 地址。

1. 确认文件树能正常加载你的项目。
2. 在 Workflows 视图中确认能看到 `oz list --json` 读取到的活跃变更。
3. 尝试启动一个 `oz` 运行记录，并观察它是否在多台设备间同步状态。
4. 如果使用 Codex/Pi 聊天，分别新建一次手动会话，确认 provider 认证和模型列表可用。

### 6. Codex 会话卡片如何接管

| 类型 | 普通用户判断方式 |
|---|---|
| 新式会话 | 已由独立 Codex 系统服务承载，可从网页或终端继续同一会话 |
| 旧式会话 | 来自旧版或私有 Codex 进程，系统服务尚未加载它 |

| 卡片状态 | 打开后的处理 |
|---|---|
| 新建卡片，尚无线程 | 创建共享线程并自动绑定卡片 |
| 新式会话，活跃或空闲 | 直接复连；活动任务保持连续 |
| 旧式会话，明确空闲 | 自动使用原会话编号迁入共享服务 |
| 旧式会话，活跃或未知 | 先显示警告；确认后保留卡片编号，创建受管 tmux 和新式共享会话 |

```mermaid
flowchart TD
    Open([👤 打开 Codex 会话卡片]) --> Shared{共享服务已拥有线程?}
    Shared -->|尚无线程| Create[⚙️ 创建共享线程并绑定卡片]
    Shared -->|是| Resume[✅ 直接复连同一会话]
    Shared -->|否 旧式会话| Idle{确认已空闲?}
    Idle -->|是| Migrate[🔄 按原会话编号自动迁入]
    Idle -->|否 活跃或未知| Warn[🚨 显示风险警告]
    Warn --> Force{用户要求强制接管?}
    Force -->|否| Stay[保留原终端状态]
    Force -->|是| Confirm[🔐 二次确认风险]
    Confirm --> Tmux[⚙️ 按卡片编号创建受管 tmux]
    Tmux --> SharedResume[✅ 新建共享会话并绑定卡片]
```

> 强制接管保留卡片编号，但会换成新的共享 Codex 会话；原终端不会被停止。

---

## 常用命令

```sh
pnpm run typecheck          # 检查前端、后端和测试类型
pnpm run test:fast          # 快速门禁：类型、单元和后端冒烟
pnpm run test:server        # 后端测试
pnpm run test:e2e:smoke     # 浏览器冒烟测试
pnpm run build              # 构建生产前后端
```
