# 提案：测试基线与 Fixture 真实化

## 背景

最近的 Codex live 修复暴露了两类风险：一是测试类型债让 `typecheck:test` 不能作为整体信号；二是多个真实页面测试因为 fixture discovery 不稳定而在断言前失败。继续放任这些债务，会让每次修 Provider runtime 或聊天渲染都先陷入测试基础设施排障。

## 变更内容

本变更创建共享测试夹具层：

```
tests/spec/helpers/
├─ codex-jsonl-fixture.ts
├─ provider-runtime-harness.ts
├─ fixture-session-discovery.ts
└─ browser-evidence.ts
```

同时修复 `typecheck:test` 的当前基线，让测试代码至少满足现有 `tsconfig.test.json`，并把关键 Codex fixture browser specs 迁移到共享 discovery helper。

## 为什么现在做

后续计划还会继续重构 Provider runtime、chat merge、tool card。没有稳定测试地基，后续每个提案都可能重复修同一类 FakeWebSocket、JSONL、fixture session、typing 问题。

## 成功标准

- `pnpm run typecheck` 完整通过
- `codex-first-turn-rendering` 与 `proposal-92-provider-non-streaming-render` 不再因找不到 fixture session 在断言前失败
- 关键 provider browser specs 复用共享 harness，而不是各自定义不完整 FakeWebSocket
- 失败时能输出 sessionId、projectPath、候选 session 和 API 响应摘要
