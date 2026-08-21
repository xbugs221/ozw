# Hermes Workbench / Hermes 工作台

Hermes Dashboard 工作台插件，覆盖 Dashboard 的 chat 路由：左侧选择会话，中间在 Hermes TUI 与渲染记录间切换，右侧浏览会话绑定的工作区文件或打开原始 shell。

文件面板支持目录浏览、Markdown 预览、CodeMirror 文本编辑和 PUT 保存。插件只使用 Dashboard SDK 注入的 React、认证请求与 WebSocket URL 构造器。

```bash
pnpm run build:hermes-inspector
cp -R integrations/hermes-dashboard-inspector ~/.hermes/plugins/workbench
```

插件包含 Dashboard 资源和同目录 `plugin_api.py`，后端提供受控文件读写与容器内原始 Shell。请在 Hermes 的 `config.yaml` 中启用插件：

```yaml
plugins:
  enabled:
    - workbench
```

修改后重启 Hermes Dashboard，使其重新扫描插件目录。

插件后端提供 `workspace`、`files`、`file` GET/PUT 与 `shell` WebSocket API，并继续使用 Hermes 自带 `/api/pty` 承载聊天 TUI；不连接 ozw 服务或数据库。

可选配置：

```yaml
dashboard:
  workbench:
    root: /opt/data
    max_shells: 4
    shell_idle_timeout_seconds: 1800
```

原始 Shell 运行在 Hermes 容器中，工作目录为 `root`，但不是 chroot；它可以访问该容器账号本来就能访问的路径。

## 南科大青橙主题

将 `theme/sustech-light.yaml` 与 `theme/sustech-dark.yaml` 复制到
`~/.hermes/dashboard-themes/`，刷新 Dashboard 后即可在亮色与暗色之间切换。
