# 设计：后端启动入口退化为装配层

## 关键决策

1. URL 不搬语义，只搬注册位置。

现有路由路径保持不变，避免前端和测试同步改 URL。

2. WebSocket gateway 只做连接边界。

gateway 负责认证、path 分派和 unknown path 拒绝；具体 chat/shell handler 仍在既有 `chat-websocket.ts` 与 `shell-websocket.ts`。

3. 启动日志和 graceful shutdown 可以独立测试。

把输出格式、host/port 展示、legacy cleanup 日志从 bootstrap 中抽离，降低启动链路 review 面。

## 风险

- WebSocket 连接上下文包含认证、session subscription 和 runtime writer，搬迁时容易丢失字段。
- `/api/system/update` 涉及 child process 输出，必须保持权限和错误传播。

## 取舍

不拆 Provider runtime 本体，只收敛 server entry。这样变更面更小，也能直接复用既有 backend boundary specs。
