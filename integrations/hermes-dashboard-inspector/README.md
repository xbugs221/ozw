# Hermes Transcript Inspector

只读 Hermes Dashboard 插件，用于检查 compression lineage、已持久化 reasoning、工具调用与原始记录。

```bash
pnpm run build:hermes-inspector
cp -R integrations/hermes-dashboard-inspector ~/.hermes/plugins/hermes-transcript-inspector
hermes plugins enable hermes-transcript-inspector
```

插件运行时只使用 Dashboard 的受认证 GET Session API，不连接 ozw 服务或数据库。
