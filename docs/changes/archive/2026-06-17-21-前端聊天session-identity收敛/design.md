# 设计：前端聊天session-identity收敛

## 模块职责

```text
session/sessionIdentity.ts
  - PendingViewSession type
  - isTemporarySessionId
  - isUnsavedSessionId
  - isCbwRouteSessionId
  - resolveProjectSessionProvider
  - resolveSessionRoutingContext
  - isSessionCreatedForPendingView
```

React hook 只负责状态和副作用，不再内联 session identity 规则。纯函数只接收 `Project`、`ProjectSession` 和 URL/provider hint 等输入，返回可测试的简单对象。

## 数据规则

- `new-session-*` 是未保存草稿，不可作为持久历史读取 id。
- `cN` 是 ozw route alias，必须保留 route id 用于后端 manual route。
- Provider session 数组直接 id 匹配优先。
- `cN` route 需要用 routeIndex 匹配 provider session 数组。
- workflow child session context 来自 persisted session metadata，不依赖 query 参数。

## 取舍

不把所有聊天状态一次性改成 reducer。本提案只收敛 identity/routing 纯规则，降低实时链路修复风险。

## 风险控制

契约测试用最小真实业务 shape 表达项目、Codex session、Pi route session 和 workflow child session，避免只检查函数存在。
