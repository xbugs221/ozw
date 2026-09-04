# 待处理会话卡片首尾请求与时间戳

## Confirmed root cause

Provider 转录解析已经提取 `firstRequest` 和 `latestRequest`，但启动回填与文件增量索引的写入边界没有继续传递这两个字段。SQLite 因而只能回退到首条标题，前端收到的首条和末条内容相同，不会渲染省略号及末条请求。

## Fix

- 两个 Provider 索引入口均传递完整首条与末条请求。
- 卡片使用 `lastActivity` 渲染时间戳，移除 Provider 图标。
- 继续只展示首条和末条请求，中间内容用 `...` 折叠。

## Regression coverage

- 启动 backfill：Codex 与 Pi 的首尾请求均落入 `provider_session_index`。
- watcher 增量索引：首尾请求均穿过 read-model 写入边界。
- 真实浏览器：从两轮 Codex JSONL 转录建立卡片，验证时间戳、完整首尾请求、省略号、无 Provider 图标、右滑完成与键盘完成。

## Evidence

前后截图来自相同入口、视口、用户角色和两轮请求内容；修复前使用未修改代码，修复后使用当前代码。
