# 任务：聊天输入发送与会话控制面重构

## 先跑契约测试

- [x] 1. 运行 `pnpm exec tsx --test docs/changes/11-聊天输入发送与会话控制面重构/tests/chat-control-boundary.contract.test.ts`
- [x] 2. 确认失败来自目标模块缺失或 hook 仍过厚
- [x] 3. 运行 `pnpm exec playwright test --config=playwright.spec.config.ts tests/spec/chat-composer-runtime.spec.ts`
- [x] 4. 运行 `pnpm exec tsx --test tests/specs/chat-message-merge-core.spec.ts`
- [x] 5. 运行 `pnpm exec tsx --test tests/specs/codex-ws-turn-ownership.spec.ts`
- [x] 6. 记录当前聊天 hooks 行数、direct fetch 和主要业务 helper

## Composer 模块

- [x] 7. 新建 `composerDraftState.ts`
- [x] 8. 新建 `attachmentQueue.ts`
- [x] 9. 新建 `submitDedupPolicy.ts`
- [x] 10. 新建 `chatSubmitController.ts`
- [x] 11. 新建 `sessionControlState.ts`
- [x] 12. 迁移 draft 文本和图片粘贴规则
- [x] 13. 迁移附件数量/大小/去重规则
- [x] 14. 迁移 submit 去重和 request id 规则

## Session 模块

- [x] 15. 新建 `sessionMessageLoader.ts`
- [x] 16. 新建 `sessionScrollAnchor.ts`
- [x] 17. 新建 `sessionRecoveryStore.ts`
- [x] 18. 新建 `terminalReconcileController.ts`
- [x] 19. 迁移 initial load 与 reload 规则
- [x] 20. 迁移 delta append 与 load older 规则

## 发送与运行中行为

- [x] 21. 抽出新会话发送 command plan
- [x] 22. 抽出 manual `cN` route finalize command plan
- [x] 23. 抽出 Codex running steer 判断
- [x] 24. 抽出 Pi running follow-up/queue 判断
- [x] 25. 保留 optimistic user message timeout 和失败标记
- [x] 26. 保留 duplicate submit 不吞真实重复发送

## 控制面与输入增强

- [x] 27. 迁移 model/depth 选择状态
- [x] 28. 迁移同值选择短路逻辑
- [x] 29. 保留 catalog 加载不覆盖用户选择
- [x] 30. 保留 file mention 多 token 搜索
- [x] 31. 保留 slash command 加载和执行
- [x] 32. 保留 mic button 与 composer 的最小桥接

## 收尾验证

- [x] 33. 将聊天 hooks 收敛为组合层
- [x] 34. 更新 `docs/specs/chat-composer-runtime.md` 和相关规格
- [x] 35. 运行 `pnpm run typecheck:web`
- [x] 36. 运行本提案 required tests 与关键聊天 e2e/spec 回归
