# 规格：前端聊天session-identity收敛

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence | 真实数据来源 | 入口路径 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| session identity 规则必须集中 | 组件/hook 不再重复定义临时和 cN 判断 | `contract-chat-session-identity` | `chat-session-identity-source-audit` | tracked 源码 | `frontend/components/chat/**` | 统一模块存在，重复函数定义移除 | source audit 不能证明所有运行分支 |
| provider 与 routing context 必须可纯函数验证 | Codex、Pi cN、workflow child session 解析正确 | `contract-chat-session-identity` | `chat-session-identity-source-audit` | 测试内真实业务 shape | `sessionIdentity.ts` | provider、projectName、projectPath、workflowId、stageKey 结果正确 | 未覆盖所有历史字段别名 |
| 真实聊天行为必须不退化 | composer、realtime 和 message merge 回归通过 | `existing-chat-composer-runtime`, `existing-chat-message-merge`, `root-typecheck` | `chat-session-identity-regression-log` | 既有规格和真实页面链路测试 | ChatInterface/hooks | 发送、合并、刷新行为不退化 | 完整 browser e2e 视改动追加 |

### 需求：session identity 规则必须集中

#### 场景：组件/hook 不再重复定义临时和 cN 判断

`ChatInterface.tsx`、`useChatComposerStateImpl.ts`、`useChatRealtimeHandlersImpl.ts`、`useChatSessionStateImpl.ts` 不得继续各自定义 `isCbwRouteSessionId`、`isTemporarySessionId` 或 provider 推断主体。

对应测试：`docs/changes/21-前端聊天session-identity收敛/tests/chat-session-identity-contract.acceptance.test.ts`。

### 需求：provider 与 routing context 必须可纯函数验证

#### 场景：Codex、Pi cN、workflow child session 解析正确

统一模块必须能用样例 `Project` 和 `ProjectSession` 对象解析直接 Codex id、Pi `cN` routeIndex、workflow child session 的 provider 和 routing context。

对应测试：`docs/changes/21-前端聊天session-identity收敛/tests/chat-session-identity-contract.acceptance.test.ts`。

### 需求：真实聊天行为必须不退化

#### 场景：composer、realtime 和 message merge 回归通过

替换调用点后，聊天发送、实时事件处理、持久化历史合并和项目刷新协调测试必须通过。

对应测试：`pnpm run test:spec:browser -- tests/spec/chat-composer-runtime.spec.ts`、`pnpm exec tsx --test tests/specs/chat-message-merge-core.spec.ts`、`pnpm exec tsx --test tests/specs/project-refresh-coordination.spec.ts`、`pnpm run typecheck`。
