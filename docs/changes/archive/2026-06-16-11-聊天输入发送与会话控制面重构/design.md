# 设计：聊天输入发送与会话控制面重构

## 决策

1. 保留 `chatMessageReducer` 为 transcript 状态权威，控制面模块只负责输入和副作用编排。
2. `chatSubmitController` 返回明确 command plan，hook 负责实际 WebSocket/fetch 调用。
3. 附件队列和 submit dedup 使用纯函数测试，避免浏览器测试才能发现边界。
4. 会话加载和滚动锚点分离，防止历史加载重建全部消息或跳动。

## 取舍

本提案不引入全局状态库。当前问题是局部 hook 过厚，拆成纯模块和 controller 已能降低风险，并保持 React 组件结构稳定。

## 风险

- submit dedup 和 optimistic user message 如果拆错，会导致真实重复发送被误删。
- 运行中 steer/follow-up 必须保留 provider 差异。
- 会话加载拆分后可能破坏滚动锚点或历史搜索跳转。

## 验证策略

用源码边界测试约束 hook 变薄；用现有 composer、merge、turn ownership、file mention 和 submission idempotency specs 验证业务行为。浏览器 QA 保存发送、刷新和附件上传 trace。
