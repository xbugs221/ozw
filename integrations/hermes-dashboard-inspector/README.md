# Render / 渲染

只读 Hermes Dashboard 插件，使用 CommonMark + GFM 渲染会话正文，并展示 compression lineage、已持久化 reasoning、工具调用与原始记录。

```bash
pnpm run build:hermes-inspector
cp -R integrations/hermes-dashboard-inspector ~/.hermes/plugins/render
```

该插件只有 Dashboard 资源，没有 `plugin.yaml` 或 Python 入口，因此不要运行
`hermes plugins enable`。请在 Hermes 的 `config.yaml` 中启用其 Dashboard manifest：

```yaml
plugins:
  enabled:
    - render
```

修改后重启 Hermes Dashboard，使其重新扫描插件目录。

插件运行时只使用 Dashboard 的受认证 GET Session API，不连接 ozw 服务或数据库。
