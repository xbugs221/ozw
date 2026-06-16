# 20-后端realtime协议与provider-runtime分层

## 用户问题

后端聊天实时链路仍把多类职责压在少数文件里：`runtime-router.ts` 同时处理 Provider capability、Pi/Codex 事件转换、session lifecycle、fake runtime、send/abort/status；`chat-websocket.ts` 同时处理 WebSocket JSON 解析、命令路由、私有投递和 runtime 调用。这个结构让 manual `cN` 会话、follow-up/steer、abort、跨窗口私有投递等高风险行为难以审查。

## 交付目标

把后端 realtime 协议和 provider runtime 分层为可测试边界。执行完成后，WebSocket handler 只负责连接生命周期和 dispatcher 调用；Provider runtime router 只做对外 facade，事件转换和 session store 由 focused modules 承载。

## 非目标

- 不改变浏览器 WebSocket 事件名称。
- 不替换 Codex app-server 或 Pi SDK。
- 不重做前端 UI。
- 不删除现有 manual/history 回归。

## 验收入口

- `pnpm exec tsx --test docs/changes/20-后端realtime协议与provider-runtime分层/tests/backend-realtime-boundary.acceptance.test.ts`
- `pnpm exec tsx --test tests/backend/pi-websocket-behavior.test.ts`
- `pnpm exec tsx --test tests/backend/pi-session-messages-endpoint.test.ts`
- `pnpm exec playwright test --config=playwright.spec.config.ts tests/spec/codex-live-followup-order.spec.ts`
- `pnpm run typecheck`

## 执行阶段默认上下文

先运行本提案契约测试。创建阶段预期失败来自目标边界缺失或旧文件仍超出职责，而不是测试语法错误。实现时必须用真实 WebSocket/runtime 流程回归，不得只做字符串拆文件。
