# 端到端测试导读

## 业务场景

`tests/e2e` 覆盖用户从页面进入项目、创建或进入会话、发送消息、等待 Provider 回包、查看持久化结果的端到端业务场景。它验证前端、后端、WebSocket、浏览器状态和测试夹具能作为一条真实用户链路工作。

## 运行命令

```bash
pnpm run test:e2e:smoke
pnpm run test:e2e
pnpm run test:browser:full
pnpm exec playwright test tests/e2e/pi-provider-business-flow.spec.ts
```

`test:e2e:smoke` 只运行项目可见性和 Pi Provider 等关键真实业务流，用于快速确认浏览器、真实页面、后端 API、WebSocket 和持久化夹具没有断。`test:e2e` 会运行完整端到端套件；`test:browser:full` 会串联 browser spec 与完整 e2e，适合合并前回归。单文件命令适合排查某条业务流。

## 失败含义

端到端测试失败通常代表用户流程断裂：按钮不可见、路由没有进入目标会话、消息没有发出、WebSocket 事件未到达，或页面没有显示 Provider 响应。排查时需要保留 Playwright trace、截图或 runtime log，避免只凭组件状态判断。

## 新增测试

新增测试应放在这里，当它需要真实浏览器页面、跨前后端通信、会话路由或持久化状态共同验证。只验证规格文字或纯 Node 合同的测试应放入 `tests/spec`；只验证后端 API 的测试应放入 `tests/backend`。
