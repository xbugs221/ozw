# 提案：聊天输入发送与会话控制面重构

## 背景

聊天页的稳定性依赖输入状态、optimistic user message、WebSocket accepted、REST reload、附件上传、滚动恢复和模型状态共同协作。当前这些规则部分位于 reducer，但仍有不少业务分支在 hooks 中直接处理，导致修复一个发送路径可能影响加载、滚动或控件状态。

## 变更内容

新增聊天控制面模块：

```
frontend/components/chat/composer/
├─ composerDraftState.ts
├─ attachmentQueue.ts
├─ submitDedupPolicy.ts
├─ chatSubmitController.ts
└─ sessionControlState.ts

frontend/components/chat/session/
├─ sessionMessageLoader.ts
├─ sessionScrollAnchor.ts
├─ sessionRecoveryStore.ts
└─ terminalReconcileController.ts
```

现有 hooks 变成组合层：订阅 React 状态、调用 controller、分发 reducer action，不直接拼接主要业务规则。

## 成功标准

- 新会话、`cN` route、已有会话发送行为不变。
- 运行中 Codex steer、Pi follow-up/queue 行为不回退。
- 附件队列限制、上传、失败提示和重试边界可单测。
- 会话加载、delta append、上滑加载和刷新恢复可单测。
- 模型/深度选择不产生冗余 PUT，也不覆盖用户选择。
