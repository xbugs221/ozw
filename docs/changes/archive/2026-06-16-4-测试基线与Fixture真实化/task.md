# 任务：测试基线与 Fixture 真实化

## 先跑契约测试

- [x] 1. 运行 `pnpm exec tsx --test docs/changes/4-测试基线与Fixture真实化/tests/test-baseline-and-fixtures.contract.test.ts`，确认失败点是目标行为缺失
- [x] 2. 记录 `pnpm run typecheck:test` 当前失败文件、错误码和错误类型
- [x] 3. 将失败分为真实类型错误、fixture mock 类型不足、历史测试意图过期三类
- [x] 4. 确认 `pnpm run typecheck` 没有绕过 `typecheck:test`
- [x] 5. 确认执行阶段不会修改 `.gitignore` 来追踪 `test-results`

## typecheck:test 基线

- [x] 6. 给测试环境补充 browser window 扩展声明
- [x] 7. 给 FakeWebSocket 补齐 EventTarget、readyState 和 handler 类型
- [x] 8. 给 app-server mock transport 补齐 close 生命周期类型
- [x] 9. 给 notification subscription mock 补齐 `notificationSubscribed`
- [x] 10. 修复 `codex-app-server-protocol-mapping` 测试的 implicit any
- [x] 11. 修复 `codex-app-server-steer-runtime` 测试的 unknown 访问
- [x] 12. 修复 runtime readiness 测试的松散 mock 类型
- [x] 13. 修复 provider live 测试中重复定义的局部 ChatMessageLike 类型
- [x] 14. 删除可安全删除的局部 `@ts-nocheck`
- [x] 15. 保留必要 `@ts-nocheck` 时写清业务原因和后续迁移条件
- [x] 16. 运行 `pnpm run typecheck:test` 并保存日志到 `test-results/typecheck-test/typecheck.log`

## Codex JSONL fixture

- [x] 17. 新建 `tests/spec/helpers/codex-jsonl-fixture.ts`
- [x] 18. 实现 `writeCodexSessionFixture`
- [x] 19. 实现 `appendCodexSessionEntries`
- [x] 20. 支持 session meta/user/assistant/reasoning/function call/function output
- [x] 21. 支持相对项目路径到绝对路径的安全解析
- [x] 22. 支持返回 session file path、session id、projectPath
- [x] 23. 增加 JSONL fixture 的 node spec 覆盖
- [x] 24. 将 `chat-composer-runtime.spec.ts` 的手写 fixture 迁移到 helper
- [x] 25. 将 `codex-live-followup-order.spec.ts` 的手写 fixture 迁移到 helper

## fixture discovery

- [x] 26. 新建 `tests/spec/helpers/fixture-session-discovery.ts`
- [x] 27. 实现等待项目 API 发现 Codex session 的 helper
- [x] 28. 失败时输出 projectPath、projectName、sessionId 和候选 sessions
- [x] 29. 失败时输出 routeIndex/providerSessionId 诊断
- [x] 30. 修复 `codex-first-turn-rendering.spec.ts` 的 fixture discovery
- [x] 31. 修复 `proposal-92-provider-non-streaming-render.spec.ts` 的 fixture discovery
- [x] 32. 用真实项目 API 断言 route session 可进入消息页
- [x] 33. 增加 discovery helper 的错误消息测试

## Provider browser harness

- [x] 34. 新建 `tests/spec/helpers/provider-runtime-harness.ts`
- [x] 35. 支持安装共享 FakeWebSocket
- [x] 36. 支持 `message-accepted` builder
- [x] 37. 支持 `session-status` builder
- [x] 38. 支持 `codex-response` / `pi-response` builder
- [x] 39. 支持 complete/error/abort builder
- [x] 40. 记录 sent messages 和 runtime events
- [x] 41. 支持 evidence state snapshot 写入
- [x] 42. 迁移 `chat-composer-runtime.spec.ts`
- [x] 43. 迁移 `frontend-runtime-noise-and-codex-render.spec.ts`
- [x] 44. 迁移 `proposal-92-provider-non-streaming-render.spec.ts`
- [x] 45. 迁移 `codex-first-turn-rendering.spec.ts`

## 文档与验证

- [x] 46. 更新 `tests/spec/README.md` 说明共享 fixture
- [x] 47. 更新 `tests/e2e/README.md` 说明何时用真实服务、何时用 provider harness
- [x] 48. 运行 `pnpm run typecheck`
- [x] 49. 运行 `pnpm run test:spec`
- [x] 50. 运行关键 browser specs 并保存 trace/screenshot/state evidence
