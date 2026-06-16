# 任务：后端realtime协议与provider-runtime分层

## 0. 契约基线

- [x] 1. 运行 `pnpm exec tsx --test docs/changes/20-后端realtime协议与provider-runtime分层/tests/backend-realtime-boundary.acceptance.test.ts`，确认初始失败来自目标边界缺失。
- [x] 2. 记录 `test-results/20-backend-realtime-boundary/source-audit.json`。
- [x] 3. 运行现有 Pi/Codex WebSocket 回归，确认当前行为基线。

## 1. WebSocket 协议边界

- [x] 4. 定义 `chat-message-schema.ts`，归一化入站命令类型。
- [x] 5. 定义 `chat-command-dispatcher.ts`，承载 codex/pi/abort/subscribe/status/ping 分发。
- [x] 6. 让 `chat-websocket.ts` 只保留连接生命周期、注册、错误处理和 dispatcher 调用。
- [x] 7. 保留 source socket 与 subscribed socket 私有投递规则。

## 2. Provider runtime 边界

- [x] 8. 拆出 `provider-event-mappers.ts`。
- [x] 9. 拆出 `runtime-session-store.ts`。
- [x] 10. 拆出 fake runtime 或测试 harness 边界。
- [x] 11. 保持 `native-agent-runtime.ts` 和 public runtime API 不变。

## 3. 回归

- [x] 12. 运行本提案契约测试。
- [x] 13. 运行 `pnpm exec tsx --test tests/backend/pi-websocket-behavior.test.ts`。
- [x] 14. 运行 `pnpm exec tsx --test tests/backend/pi-session-messages-endpoint.test.ts`。
- [x] 15. 运行 `pnpm exec playwright test --config=playwright.spec.config.ts tests/spec/codex-live-followup-order.spec.ts`。
- [x] 16. 运行 `pnpm run typecheck`。
- [x] 17. 视实际改动补充 e2e 或 manual browser 多窗口私有投递证据。
