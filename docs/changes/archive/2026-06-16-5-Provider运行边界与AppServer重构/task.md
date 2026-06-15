# 任务：Provider 运行边界与 AppServer 重构

## 先跑契约测试

- [x] 1. 运行 `pnpm exec tsx --test docs/changes/5-Provider运行边界与AppServer重构/tests/provider-runtime-boundary.contract.test.ts`
- [x] 2. 记录失败点，确认失败来自边界模块缺失或调用点未迁移
- [x] 3. 运行 Codex app-server 现有 node specs，保存基线
- [x] 4. 运行 Pi websocket/runtime 现有 node specs，保存基线
- [x] 5. 确认不重新引入 `@openai/codex-sdk`

## Provider runtime 模块

- [x] 6. 新建 `backend/domains/provider-runtime/`
- [x] 7. 新建 `runtime-router.ts`
- [x] 8. 新建 `provider-runtime-events.ts`
- [x] 9. 新建 `provider-session-binding.ts`
- [x] 10. 新建 `active-turn-store.ts`
- [x] 11. 新建 `live-transcript-store.ts`
- [x] 12. 为每个模块写文件头目的说明
- [x] 13. 为每个导出函数写业务 docstring
- [x] 14. 保持原有外部 API 字段不变
- [x] 15. 保持 app-server facade 路径不变

## Codex app-server 边界

- [x] 16. 把 Codex command 分发封装到 runtime-router
- [x] 17. 把 Codex accepted/status/error 事件字段集中到 provider-runtime-events
- [x] 18. 把 Codex complete reconcile 入口与 binding 模块对齐
- [x] 19. 确认 Codex 不导入旧 SDK
- [x] 20. 确认 Codex auth 仍依赖 CLI 登录态或环境变量
- [x] 21. 确认 Codex app-server shared transport 关闭时清理运行态
- [x] 22. 确认 app-server item notification 仍能写入 live transcript

## Pi runtime 边界

- [x] 23. 把 Pi command 分发封装到 runtime-router
- [x] 24. 把 Pi session adapter 与 Codex adapter 统一返回结构
- [x] 25. 把 Pi steer/follow-up 队列状态留在 Pi adapter 内
- [x] 26. 把 Pi accepted/status/error 事件字段集中到 provider-runtime-events
- [x] 27. 确认 Pi complete 后 snapshot bridge 清理逻辑不变
- [x] 28. 确认 Pi abort 清理 active run 与 snapshot

## cN route binding

- [x] 29. 抽出读取 manual session route runtime 的 helper
- [x] 30. 抽出写入 provider session id 的 helper
- [x] 31. 迁移 chat websocket 的绑定读写
- [x] 32. 迁移 session messages handler 的绑定读取
- [x] 33. 迁移 complete/finalize 相关绑定读取
- [x] 34. 迁移 abort/status 相关绑定读取
- [x] 35. 增加 provider/projectPath 不匹配时的拒绝诊断
- [x] 36. 保留 cN route id 与 provider session id 双字段兼容

## active-turn 与 live snapshot

- [x] 37. 把 active-turn overlay 读写迁入 active-turn-store
- [x] 38. 把 live transcript snapshot 读写迁入 live-transcript-store
- [x] 39. complete 时先 reconcile，再清理 active-turn
- [x] 40. abort 时保留必要错误消息，再清理 active-turn
- [x] 41. error 时把对应 optimistic 用户行标失败
- [x] 42. refresh 时只在 JSONL 不可用时使用 live snapshot bridge
- [x] 43. 增加运行态恢复的 node contract test
- [x] 44. 增加 complete 后清理的 node contract test

## 收尾验证

- [x] 45. 缩小 `backend/native-agent-runtime.ts` 到协调职责
- [x] 46. 更新 backend runtime 相关 README 或规格说明
- [x] 47. 运行 `pnpm run typecheck:node`
- [x] 48. 运行 `pnpm exec tsx --test tests/specs/codex-app-server-steer-runtime.spec.ts tests/specs/codex-app-server-protocol-mapping.spec.ts`
- [x] 49. 运行 Pi runtime 相关测试
- [x] 50. 保存 source audit、runtime log、状态快照 evidence
