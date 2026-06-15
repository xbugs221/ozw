# 设计：Provider 运行边界与 AppServer 重构

## 模块边界

```
chat-websocket
  -> provider-runtime/runtime-router
       -> codex-app-server/runtime-facade
       -> pi-runtime/session-adapter
       -> provider-session-binding
       -> active-turn-store
       -> live-transcript-store
```

## 关键决策

### runtime-router 只分发 provider

`runtime-router.ts` 负责把 Codex/Pi 命令转发到正确 adapter，并统一返回 accepted/status/error 事件。它不读 JSONL，也不做 UI merge。

### provider-session-binding 单独管理 cN 映射

cN route id、provider thread/session id、project path、provider name 必须通过一个模块读写。后续所有消息读取、complete reconcile、abort 都走这份绑定。

### active-turn 与 live transcript 分离

active-turn overlay 只描述“当前用户 turn 的运行状态”；live transcript snapshot 只保存实时可见消息。两者不能互相塞字段。

### 事件契约集中定义

Codex app-server 和 Pi SDK 的原生事件先规范化为 provider runtime event，再由 websocket 写给前端。

## 风险

- 抽模块时可能改变状态清理时机，必须用 running、complete、abort、refresh 四类测试覆盖。
- 需要保持现有 API 字段兼容，不能让前端重新适配。
