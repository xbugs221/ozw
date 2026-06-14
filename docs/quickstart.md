# 快速开始

[English](./quickstart_en.md) | 中文

---

本指南将帮助你在本地或服务器上启动并运行 **ozw**。

### 1. 检查基础环境
- **Node.js 22+** 与 **pnpm 10.33+**。
- **oz**：必须安装在系统 `PATH` 中。ozw 依赖它来处理 `openspec` 提案和执行工作流。

### 2. 获取并启动
```sh
git clone https://github.com/xbugs221/ozw.git
cd ozw
pnpm install
pnpm start
```
`pnpm start` 会编译前端和后端并启动服务。

### 3. 实现“编程接力”（推荐配置）
为了发挥 ozw 跨设备接力的最大优势，建议将其部署在公网可达的环境中：
- **公网服务器：** 直接在服务器启动。
- **本地开发机：** 使用 `frp`、`nps` 或 `Cloudflare Tunnel`。

**配置示例 (frp):**
将本地的 5173（前端）和 3001（后端）映射到你的公网域名。

### 4. 验证
打开浏览器访问你的 ozw 地址。
1. 确认文件树能正常加载你的项目。
2. 在 Workflows 视图中确认能看到 `oz` 列出的活跃变更。
3. 尝试启动一个 `oz` 运行记录，并观察它是否在多台设备间同步状态。

---

## 🚀 进阶技巧

```sh
pnpm typecheck      # 检查代码类型错误
pnpm test:server    # 运行后端测试
pnpm test:e2e       # 运行浏览器端测试
```
