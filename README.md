# ozw - 基于 ccui 的 AI 编程接力站

[English](./README_en.md) | 中文

---

**ozw** 基于 [claudecodeui](https://github.com/siteboon/claudecodeui) 改造而来。吸收融合了 `openspec` 的 SDD 概念，并引入了 [oz](https://github.com/xbugs221/oz)。

### 为什么要做这个？（核心痛点）

以往的智能体编程（Agentic Coding）往往被锁死在某一台机器的终端或者某个特定的 IDE 插件里。如果你下班了、换电脑了，或者想在手机上临时盯一下进度，通常很难做到。当然，你可以用 tailnet 之类的东西组网然后 ssh + tmux 来实现，但依旧困在终端界面。跨设备接力的最直观方案，还是通过浏览器。

**ozw 最大的收益在于：让 Agentic Coding 彻底脱离单机限制。**

通过 ozw，你的编程任务不再是本地的一个进程，而是一个可以“接力”的 Web 运行记录。只要你配合 `frp`、`cloudflare tunnel` 等工具将端口暴露到公网，你就可以：

1. **在主力开发机** 启动一个耗时较长的 `oz` 任务。
2. **在通勤路上** 通过手机浏览器查看智能体当前的执行步骤。
3. **回到家里** 换上私人电脑，直接在网页上接手任务，继续 Review 代码或点击执行。

![主界面](assets/1.png)

![文件管理器+终端+主界面布局](assets/2.png)

### 快速开始

1. **准备基础环境：** 需要 Node.js 22+ 与 pnpm 10.33+。

2. **安装 `oz`：** ozw 依赖 `oz flow` 读取和执行工作流，必须先确保 `oz` 在 `PATH` 中。

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

3. **安装并登录 Codex / Pi CLI：** ozw 只复用本机已有的 provider 会话，不负责替你登录。启动前请先在同一台机器上完成两个 CLI 的安装和登录：

   ```sh
   codex login
   pi login
   codex --version
   pi --version
   ```

4. **启动 ozw：**

   ```sh
   pnpm install
   cp .env.example .env
   # 修改其中的 JWT_SECRET
   pnpm start
   ```

5. **公网访问（推荐）：** 使用 `frp` 或 `nps` 将本地端口（默认 5173/3001）映射出去，开启你的跨设备编程之旅。

6. **安装到手机桌面：** ozw 发布了 PWA 入口。手机浏览器打开 HTTPS 地址后，可以通过“添加到主屏幕”保存桌面图标；相关资源位于 `/manifest.webmanifest`、`/sw.js`、`/pwa/icon-192.png` 和 `/pwa/icon-512.png`。

更多技术细节请参考 [docs/quickstart.md](docs/quickstart.md)。

---

## ⚖️ 许可证

ozw 采用 **GPL-3.0** 许可证开源。详见 [LICENSE](LICENSE)。
