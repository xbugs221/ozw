# 21-前端聊天session-identity收敛

## 用户问题

前端聊天链路在 `ChatInterface`、composer、realtime handlers 和 session state 中重复维护 `new-session-*`、`cN` route、provider 推断、workflow routing context 和 `PendingViewSession` 规则。重复规则会让 manual session、workflow child session 和实时消息归属在修复时互相漂移。

## 交付目标

新增统一的 chat session identity/routing 纯逻辑模块，供 ChatInterface、composer、realtime handlers 和 session state 共用。执行完成后，相关文件不得继续定义重复的 `isCbwRouteSessionId`、`isTemporarySessionId`、provider 推断和 routing context 逻辑。

## 非目标

- 不改聊天页面视觉布局。
- 不改后端 WebSocket 协议。
- 不改变 session URL 结构。
- 不删除现有 message merge 和 realtime 回归。

## 验收入口

- `pnpm exec tsx --test docs/changes/21-前端聊天session-identity收敛/tests/chat-session-identity-contract.acceptance.test.ts`
- `pnpm run test:spec:browser -- tests/spec/chat-composer-runtime.spec.ts`
- `pnpm exec tsx --test tests/specs/chat-message-merge-core.spec.ts`
- `pnpm exec tsx --test tests/specs/project-refresh-coordination.spec.ts`
- `pnpm run typecheck`

## 执行阶段默认上下文

先运行本提案契约测试。创建阶段预期失败来自统一 identity module 不存在和重复函数仍散落在组件/hook 中。实现时先抽纯函数并用样例业务对象测试，再替换调用点。
