# 规格：聊天 session identity

## 需求：session identity 规则必须集中

### 场景：组件和 hooks 不重复定义 identity helper

- **给定** 开发者审查聊天 view、composer、realtime handlers 和 session state loader
- **当** 临时草稿、未保存 session、`cN` route alias、provider session 或 workflow child session 解析规则发生变化
- **则** 这些规则必须集中在 `frontend/components/chat/session/sessionIdentity.ts`
- **且** `ChatInterface.tsx`、`useChatComposerStateImpl.ts`、`useChatRealtimeHandlersImpl.ts`、`useChatSessionStateImpl.ts` 不得各自重复定义 `isTemporarySessionId`、`isCbwRouteSessionId`、`resolveProjectSessionProvider` 或 `resolveSessionRoutingContext`

## 需求：provider 与 routing context 必须可纯函数验证

### 场景：Codex、Pi cN 和 workflow child session 解析正确

- **给定** 项目同时包含 Codex 原生 session、Pi 原生 session 和 `cN` routeIndex
- **当** 聊天前端解析直接 provider session id、`cN` route alias 或 workflow child session
- **则** provider 必须分别解析为对应的 `codex` 或 `pi`
- **且** routing context 必须保留 `projectName`、`projectPath`、`workflowId` 和 `workflowStageKey`
- **且** 该能力由 `pnpm exec tsx --test tests/specs/chat-session-identity.spec.ts` 覆盖

## 需求：真实聊天行为必须不退化

### 场景：identity 收敛后聊天发送、合并和刷新仍稳定

- **给定** session identity 调用点被替换为统一纯逻辑模块
- **当** 用户发送聊天、收到 realtime 输出、合并持久化历史或触发项目刷新协调
- **则** composer runtime、message merge、project refresh coordination 和 TypeScript typecheck 必须继续通过
- **且** 对应回归入口为 `pnpm run test:spec:browser -- tests/spec/chat-composer-runtime.spec.ts`、`pnpm exec tsx --test tests/specs/chat-message-merge-core.spec.ts`、`pnpm exec tsx --test tests/specs/project-refresh-coordination.spec.ts`、`pnpm run typecheck`
