# 规格：后端realtime协议与provider-runtime分层

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence | 真实数据来源 | 入口路径 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Realtime 协议必须有 dispatcher 边界 | WebSocket handler 不直接承载命令分支 | `contract-backend-realtime-boundary` | `backend-realtime-source-audit` | tracked 源码 | `backend/server/chat-websocket.ts` | handler 体量受控，命令处理进入 dispatcher | source audit 不能证明运行时顺序 |
| Provider runtime 必须拆出 event/session 边界 | runtime router 不直接承载 mapper/store 主体 | `contract-backend-realtime-boundary` | `backend-realtime-source-audit` | tracked 源码 | `backend/domains/provider-runtime/runtime-router.ts` | mapper/store/fake runtime 模块存在并被 facade 使用 | provider SDK 行为变化需额外回归 |
| 真实实时行为必须不退化 | 首轮、follow-up/steer、abort 和私有投递保持兼容 | `existing-pi-websocket`, `existing-codex-followup`, `root-typecheck` | `backend-realtime-regression-log` | 真实 WebSocket 测试和 provider runtime 测试 | `/ws/chat`, `sendNativeMessage` | 消息顺序、状态和私有投递不退化 | 完整浏览器多窗口截图不在最小验收内 |

### 需求：Realtime 协议必须有 dispatcher 边界

#### 场景：WebSocket handler 不直接承载命令分支

`chat-websocket.ts` 负责连接、注册和关闭，入站消息交给 `chat-command-dispatcher.ts`。它不得直接包含 `codex-command`、`pi-command`、`abort-session` 等大分支的业务处理主体。

对应测试：`docs/changes/20-后端realtime协议与provider-runtime分层/tests/backend-realtime-boundary.acceptance.test.ts`。

### 需求：Provider runtime 必须拆出 event/session 边界

#### 场景：runtime router 不直接承载 mapper/store 主体

`runtime-router.ts` 保留 public facade，但事件转换、session lookup/status store 和 fake runtime 必须拆到独立模块，并通过明确导入使用。

对应测试：`docs/changes/20-后端realtime协议与provider-runtime分层/tests/backend-realtime-boundary.acceptance.test.ts`。

### 需求：真实实时行为必须不退化

#### 场景：首轮、follow-up/steer、abort 和私有投递保持兼容

拆分后，Codex/Pi 首轮创建、Pi follow-up、Codex steer、abort session、session status 和私有订阅投递必须继续通过真实 WebSocket/runtime 测试。

对应测试：`tests/backend/pi-websocket-behavior.test.ts`、`tests/spec/codex-live-followup-order.spec.ts`、`pnpm run typecheck`。
