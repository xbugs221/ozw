# 设计：后端realtime协议与provider-runtime分层

## 目标结构

```text
server/chat-websocket.ts
  -> realtime/chat-message-schema.ts
  -> realtime/chat-command-dispatcher.ts
  -> realtime/session-subscription-registry.ts
  -> native-agent-runtime.ts
      -> domains/provider-runtime/runtime-router.ts
          -> provider-event-mappers.ts
          -> runtime-session-store.ts
          -> fake-runtime.ts
```

## 技术决策

- WebSocket 入站消息先通过 schema 归一化，dispatcher 只接收 typed command。
- 私有投递继续使用 session subscription registry，但 dispatcher 必须显式传入 provider/project/session scope。
- Provider runtime router 保留 public API，内部委托 session store 和 event mapper。
- fake Pi runtime 单独放入测试/开发辅助边界，避免污染真实 session lifecycle。

## 取舍

本提案不要求一次性消灭所有 `unknown`。Provider 原生事件仍以 `unknown` 入边界，但必须在 mapper 内归一化成 typed ozw event。

## 风险控制

- 用 source contract 防止大逻辑回流到 WebSocket handler。
- 用既有 WebSocket 行为测试覆盖真实事件顺序。
- 对私有投递保留 source socket 与 subscribed socket 两类路径，禁止未匹配 socket 收到 provider delta。
