# 简报：聊天输入发送与会话控制面重构

## 用户问题

已有提案 6 覆盖聊天 Live 渲染与工具卡片，但输入、附件、发送去重、运行中 steer/follow-up、会话加载、滚动锚点和模型控制仍主要分布在大型 hooks 中。继续在 hooks 中堆业务规则，会让消息一致性修复和 UI 控件调整互相牵连。

## 交付目标

把聊天输入、发送控制、会话加载和会话控制面拆成可测试的纯状态模块和薄 hook 组合层。用户可见行为保持：新会话发送、运行中补充、附件上传、历史加载、刷新恢复、模型/深度选择都不回退。

## 非目标

不重写消息 reducer，不改变 WebSocket message type，不改变工具卡片渲染规则，不移除已有 proposal 6 的 Live 渲染边界。

## 验收入口

- `pnpm exec tsx --test docs/changes/11-聊天输入发送与会话控制面重构/tests/chat-control-boundary.contract.test.ts`
- `pnpm exec playwright test --config=playwright.spec.config.ts tests/spec/chat-composer-runtime.spec.ts`
- `pnpm exec tsx --test tests/specs/chat-message-merge-core.spec.ts tests/specs/codex-ws-turn-ownership.spec.ts`
- `pnpm exec tsx --test tests/spec/chat_file_mention_search.ts tests/spec/chat-message-submission-idempotency.spec.ts`

## 执行默认上下文

先读取 `frontend/components/chat/hooks/useChatComposerState.ts`、`useChatSessionState.ts`、`useChatRealtimeHandlersImpl.ts`、`frontend/components/chat/state/*` 和聊天相关 specs。执行阶段必须先保持现有行为，再把 hook 内业务状态迁入小模块。
