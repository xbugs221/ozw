# 首页工作流会话过滤与 CI 修复

## 用户可感知场景

首页待处理看板会显示 oz flow 内部会话；GitHub CI 的 Node 规格测试连续失败。

## 调用链与模块责任

`Provider JSONL → provider_session_index → sessionAttentionDb.list → 首页看板`

`GitHub Actions → test:ci → 后端 Node 测试`

## 关键证据

看板仅依赖 `origin` 过滤，但工作流索引已持有更完整的 Provider 级会话引用。CI 的失败断言仍假设 Claude 不可创建、Pi 命令进入原生聊天运行时、开发版 Node 必须等于最低运行版本，且把 Claude TUI 误判为旧 SDK 界面，与当前产品契约不符。

## 根因与置信度

`Confirmed`：工作流所有权标记存在同步时序缺口；CI 测试未随 Claude 会话接入、Pi tmux TUI 与 Node 版本契约更新；WebSocket 用例固定等待 500ms，在冷启动或高负载时会假失败。

## 修复方案

待处理查询同时按 `origin` 和工作流索引引用过滤；更新过期 CI 断言；WebSocket 测试改为等待目标业务事件。

## 回归测试

新增 Provider 同名隔离、未标记工作流会话、显式工作流来源和手动会话覆盖。

## 验证结果

相关回归 47/47、Vitest 64/64、Node 规格 88/88 通过；`pnpm run test:ci` 在主工作区和提交后的干净工作树均完整通过。

## 阻塞项与剩余风险

无。
