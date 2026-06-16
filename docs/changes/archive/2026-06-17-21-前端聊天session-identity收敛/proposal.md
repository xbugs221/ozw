# 提案：前端聊天session-identity收敛

## 背景

聊天页面同时面对临时草稿 session、手动 `cN` route、Provider 原生 session、workflow child session 和搜索跳转。当前多个 hook 各自判断 session 是否临时、是否 `cN`、应该使用哪个 provider、应该向后端传哪个 projectName/projectPath。这些规则一旦不一致，就会导致消息发送到错误会话、完成事件不更新当前视图或刷新后 provider 控件错位。

## 变更

1. 新增 `frontend/components/chat/session/sessionIdentity.ts`。
2. 在该模块中集中导出 `PendingViewSession`、`isTemporarySessionId`、`isCbwRouteSessionId`、`resolveProjectSessionProvider`、`resolveSessionRoutingContext` 等纯函数。
3. 将 ChatInterface、composer、realtime handlers 和 session state 的重复实现替换为共用函数。
4. 增加契约测试覆盖 `new-session-*`、`cN`、Provider session、workflow child session 和 routeIndex provider 推断。

## 验收标准

- 重复 identity 函数不再散落在多个组件/hook。
- 样例项目对象能正确解析 provider 和 routing context。
- 现有 composer、realtime、message merge 和 project refresh 回归通过。

## 风险

抽共享模块时容易把当前 session 与 pending request 的语义混淆。实现时必须保留 `clientRequestId` 优先匹配和 workflow context 字段。
