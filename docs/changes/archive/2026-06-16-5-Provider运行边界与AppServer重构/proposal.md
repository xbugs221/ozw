# 提案：Provider 运行边界与 AppServer 重构

## 背景

当前 Codex 手动聊天主路径已经是 `codex app-server --listen stdio://`，认证依赖 Codex CLI 登录态；Pi 仍走 native SDK。主路径正确，但边界仍不够明确：`native-agent-runtime` 同时承担路由、session 状态、live snapshot、Pi runtime 协调等职责。

## 变更内容

引入 provider runtime 边界模块：

```
backend/domains/provider-runtime/
├─ runtime-router.ts
├─ provider-session-binding.ts
├─ provider-runtime-events.ts
├─ active-turn-store.ts
└─ live-transcript-store.ts
```

目标不是重写 runtime，而是把已经存在的业务规则放到可测试、可审计的模块中。

## 成功标准

- Codex 主路径只通过 app-server facade，不出现 `@openai/codex-sdk`
- Pi 主路径只通过 Pi SDK session adapter
- cN route session 与 provider session 的绑定有单一模块负责
- active-turn overlay 与 live transcript snapshot 生命周期有单一模块负责
- abort/error/complete/status event 的字段契约集中定义
