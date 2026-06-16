# 提案：后端realtime协议与provider-runtime分层

## 背景

聊天实时链路是 ozw 的高风险路径。用户发送消息后，后端要完成请求去重、manual `cN` route 绑定、Provider session 创建、实时 delta 投递、订阅窗口匹配、follow-up/steer、abort 和完成状态回写。当前这些规则分散在 WebSocket handler 和 provider runtime router 中，单点修改容易造成跨窗口串消息或会话状态错配。

## 变更

1. 新增 provider event mapper，集中转换 Codex/Pi 原生事件到 ozw runtime event。
2. 新增 runtime session store，集中维护 session lookup、status、active turn、abort 状态和测试 seed。
3. 新增 chat command dispatcher，集中解析 `codex-command`、`pi-command`、`abort-session`、`subscribe-session`、`check-session-status` 等协议消息。
4. 新增 chat message schema，收敛 WebSocket 入站 payload 的窄类型。
5. 保持 `sendNativeMessage`、`abortNativeSession`、`getNativeSessionStatus` 等对外入口稳定。

## 验收标准

- `chat-websocket.ts` 不再直接包含大段命令分支和 runtime 调用。
- `runtime-router.ts` 不再直接承载 event mapper 与 session store 主体实现。
- Codex/Pi 首轮、follow-up/steer、abort、状态查询和私有订阅投递回归通过。

## 风险

实时链路存在竞态。拆分时必须保留 clientRequestId、ozwSessionId、providerSessionId 和 projectPath 的匹配优先级，不能通过 broad user broadcast 弱化私有投递边界。
