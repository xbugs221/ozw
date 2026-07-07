# 故障排除

[English](./troubleshooting_en.md) | 中文

---

遇到问题时，先按下面顺序排查：运行时依赖、工作流状态、provider 认证、端口和登录配置。

### 1. 找不到 `oz`

如果 ozw 启动失败，请先检查工具是否就绪：

```sh
oz --version
oz flow contract --json
```

确保它在服务进程的 `PATH` 环境变量中。systemd、容器或反向代理启动方式可能和你交互式终端的 `PATH` 不一样。

### 2. 工作流（Workflows）没显示出来

ozw 用 `oz list --json` 发现可被工作流接管的活跃变更。你可以先用 `oz` 自己确认当前项目是否有可见变更：

```sh
oz list --json
```

如果这里没列出来，ozw 的界面里也不会有。

### 3. 工作流状态看起来不对劲

工作流执行状态以 `oz flow` 输出和本机 state 文件为准。如果界面显示不一致，可以先检查具体 run id：

```sh
oz flow status --run-id <run-id> --json
```

然后再看 ozw 服务日志。

### 4. AI 聊天（Codex/Pi）没反应

ozw 不替 provider 完成登录。Codex 需要本机 `codex app-server` 可用并已认证；Pi 需要 Pi 原生运行时能读取到账号认证。

- **解决方法：** 先按对应 provider 的官方方式登录，再重启 ozw，并在设置页查看 provider 诊断。

### 5. 网页打不开

看一眼终端日志里的地址。

| 模式 | 默认地址 |
|---|---|
| `pnpm start` | `http://localhost:3001` |
| `pnpm dev` | `http://localhost:5173` |

如果端口被占用，可以通过 `.env` 里的 `PORT` 或 `VITE_PORT` 更换端口。

### 6. 安装失败（原生依赖问题）

ozw 用到了一些原生库（比如 `node-pty`）。如果 `pnpm install` 报错，请确保你的电脑上安装了 C++ 编译器和 Node.js 的头文件（Headers）。

### 7. 登录或首次注册失败

确认 `.env` 里已经设置 `JWT_SECRET`。这是生成登录令牌的必需配置；公网部署建议使用至少 32 字节随机值。

### 8. 本机无需登录但公网需要登录

默认 `OZW_TRUST_LOCALHOST_AUTH=true`，本机 `localhost` 访问会信任已有首个本地账号。公网访问不会因为这个配置自动绕过登录。若你希望本机也强制登录，设置：

```sh
OZW_TRUST_LOCALHOST_AUTH=false
```

---

## 更多帮助

还是没搞定？看看终端里的服务日志，或者去 [GitHub 提个 Issue](https://github.com/xbugs221/ozw/issues)。
