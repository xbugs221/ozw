# ozw - 本地 AI 编程接力站

[English](./README_en.md) | 中文

---

**ozw** 是面向 Codex、Pi 和 [oz](https://github.com/xbugs221/oz) 工作流的本地 Web 工作台。项目从 [claudecodeui](https://github.com/siteboon/claudecodeui) 演进而来，当前重点是把智能体编程会话、`oz flow` 工作流、项目文件、终端和跨设备访问放到同一个浏览器界面里。

### 为什么要做这个？（核心痛点）

以往的智能体编程（Agentic Coding）往往被锁死在某一台机器的终端或者某个特定的 IDE 插件里。如果你下班了、换电脑了，或者想在手机上临时盯一下进度，通常很难做到。当然，你可以用 tailnet 之类的东西组网然后 ssh + tmux 来实现，但依旧困在终端界面。跨设备接力的最直观方案，还是通过浏览器。

**ozw 最大的收益在于：让 Agentic Coding 彻底脱离单机限制。**

通过 ozw，你的编程任务不再是本地的一个进程，而是一个可以“接力”的 Web 运行记录。只要你配合 `frp`、`nps`、Cloudflare Tunnel 等工具将端口暴露到公网，你就可以：

1. **在主力开发机** 启动一个耗时较长的 `oz` 任务。
2. **在通勤路上** 通过手机浏览器查看智能体当前的执行步骤。
3. **回到家里** 换上私人电脑，直接在网页上接手任务，继续 Review 代码或点击执行。

![主界面](assets/1.png)

![文件管理器+终端+主界面布局](assets/2.png)

### 当前能力

| 模块 | 作用 |
|---|---|
| 手动会话 | 在浏览器里创建、继续和查看 Codex/Pi 会话 |
| 工作流 | 读取、启动、恢复和终止 `oz flow` 运行记录 |
| 项目工作台 | 文件树、代码编辑器、终端和项目总览 |
| 实时同步 | 通过 WebSocket 展示会话输出、工具调用和工作流状态 |
| 自托管访问 | 支持本地、服务器、反向代理和 PWA 桌面入口 |

### 快速开始

1. **准备基础环境：** 推荐 Node.js 26.4.0（最低 24.17.0）与 pnpm 11.10.0（分别以 `.nvmrc` 和 `package.json` 为准）。

   ```sh
   corepack enable
   corepack prepare pnpm@11.10.0 --activate
   node --version
   pnpm --version
   ```

2. **安装 `oz`：** ozw 启动时会检查 `oz flow contract --json`，并通过 `oz list` 发现活跃变更、通过 `oz flow` 执行工作流，必须先确保 `oz` 在服务进程的 `PATH` 中。

   方式一：从 [oz Releases](https://github.com/xbugs221/oz/releases) 下载对应系统和架构的二进制文件，然后赋予执行权限：

   ```sh
   mkdir -p ~/.local/bin
   mv ~/Downloads/oz ~/.local/bin/oz
   chmod +x ~/.local/bin/oz
   oz --version
   ```

   如果你的 shell 还找不到 `oz`，把 `~/.local/bin` 加入 `PATH`。

   方式二：已有 Go 环境时直接安装：

   ```sh
   go install github.com/xbugs221/oz@latest
   oz --version
   ```

3. **准备聊天 provider：** ozw 的服务启动只强制依赖 `oz`。如果要使用 Codex 或 Pi 手动聊天，请在同一台机器上按对应 provider 的官方方式完成安装和登录；Codex 会话通过 `codex app-server` 运行，Pi 会话通过 Pi 原生运行时运行。

4. **启动 ozw：**

   ```sh
   pnpm install
   cp .env.example .env
   # 至少设置 JWT_SECRET，公网部署还建议设置 CREDENTIAL_ENCRYPTION_KEY
   pnpm start
   ```

   `pnpm start` 会先构建前端和后端，再在默认 `PORT=3001` 上提供 Web 页面、API 和 WebSocket。首次访问时创建单用户账号；本机 `localhost` 访问默认信任已有首个账号，可用 `OZW_TRUST_LOCALHOST_AUTH=false` 关闭。

   开发模式使用双服务：

   ```sh
   pnpm dev
   ```

   开发模式默认前端为 `5173`，后端为 `3001`；生产模式默认只需要暴露 `3001`。

5. **公网访问（推荐）：** 使用 `frp`、`nps` 或 Cloudflare Tunnel 将服务端口映射到 HTTPS 域名，开启跨设备编程接力。

6. **安装到手机桌面：** ozw 发布了 PWA 入口。手机浏览器打开 HTTPS 地址后，可以通过“添加到主屏幕”保存桌面图标；相关资源位于 `/manifest.webmanifest`、`/sw.js`、`/pwa/icon-192.png` 和 `/pwa/icon-512.png`。

更多技术细节请参考 [docs/quickstart.md](docs/quickstart.md)。

---

## ⚖️ 许可证

ozw 采用 **GPL-3.0** 许可证开源。详见 [LICENSE](LICENSE)。
