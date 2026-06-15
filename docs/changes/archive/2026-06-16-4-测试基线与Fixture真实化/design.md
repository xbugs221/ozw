# 设计：测试基线与 Fixture 真实化

## 技术决策

### 共享 JSONL fixture writer

Codex JSONL 写入应放入 `tests/spec/helpers/codex-jsonl-fixture.ts`，支持 session meta、user message、assistant text、function call、function output、reasoning 和 append。测试只声明业务 turn，不再手写路径和 JSONL 行。

### 共享 provider runtime harness

浏览器内 FakeWebSocket 应收敛为一个 helper，显式支持：

- open/send/close 生命周期
- `message-accepted`
- `session-status`
- `codex-response` / `pi-response`
- complete/error/abort
- 事件录制和 evidence dump

### fixture discovery 统一等待

等待项目 API 发现 session 时必须输出诊断：

```
sessionId
projectPath
projectName
knownSessions[]
routeIndex
providerSessionId
messagesEndpoint
```

### typecheck:test 收敛策略

优先补类型和共享声明；只有确实无法短期收敛的历史 browser evidence 文件，才保留局部 `@ts-nocheck`，并在文件头写清原因。

## 风险

- 迁移 helper 可能改变测试时序，需要保留原有断言语义。
- 某些旧测试本身意图已过期，执行阶段要按当前 Codex app-server / Pi SDK 语义更新，而不是仅做类型消音。

## 取舍

不把 fixture helper 放入生产源码，避免测试夹具污染运行时代码。也不要求所有测试立刻 strict，只要求 `typecheck:test` 当前基线可通过。
