# 任务：前端聊天session-identity收敛

## 0. 契约基线

- [x] 1. 运行 `pnpm exec tsx --test docs/changes/21-前端聊天session-identity收敛/tests/chat-session-identity-contract.acceptance.test.ts`，确认初始失败来自统一模块缺失和重复规则仍存在。
- [x] 2. 记录 `test-results/21-chat-session-identity/source-audit.json`。

## 1. 抽纯逻辑模块

- [x] 3. 新建 `frontend/components/chat/session/sessionIdentity.ts`。
- [x] 4. 定义 `PendingViewSession`、routing context 和 provider 解析返回类型。
- [x] 5. 实现临时 session、unsaved session、`cN` route 判断。
- [x] 6. 实现 provider 和 routing context 解析。
- [x] 7. 用契约测试覆盖 Codex、Pi routeIndex 和 workflow child session 样例。

## 2. 替换调用点

- [x] 8. 替换 `ChatInterface.tsx` 中 provider/context 推断。
- [x] 9. 替换 composer 中 `PendingViewSession` 和 route 判断。
- [x] 10. 替换 realtime handlers 中 pending request 和 project scope 判断。
- [x] 11. 替换 session state 中临时 session 和 load id 判断。
- [x] 12. 删除重复局部 helper。

## 3. 回归

- [x] 13. 运行本提案契约测试。
- [x] 14. 运行 `pnpm run test:spec:browser -- tests/spec/chat-composer-runtime.spec.ts`。
- [x] 15. 运行 `pnpm exec tsx --test tests/specs/chat-message-merge-core.spec.ts`。
- [x] 16. 运行 `pnpm exec tsx --test tests/specs/project-refresh-coordination.spec.ts`。
- [x] 17. 运行 `pnpm run typecheck`。

备注：第 14 项已用正确 Playwright runner 执行，最终 8 个场景全部通过。
