# 提案：聊天 Live 渲染与工具卡片体系化

## 背景

聊天 UI 的关键规则分散在 reducer、session merge、native runtime transcript、MessageComponent、ToolRenderer 和 toolConfigs 中。之前修复靠局部补丁完成，但缺少一个清晰的“状态机 + 渲染契约 + 工具文件打开契约”边界。

## 变更内容

```
frontend/components/chat/
├─ state/deliveryStatusMachine.ts
├─ utils/liveTurnMergePolicy.ts
├─ tools/configs/openFileToolConfig.ts
└─ view/subcomponents/__tests__/render-state helpers
```

本变更把状态和配置规则抽成小模块，让测试可以直接验证业务行为，而不是只在大型 React hook 中间接观察。

## 成功标准

- deliveryStatus 迁移路径明确：pending -> persisted/failed
- live rows 能在 JSONL 历史落盘前稳定显示
- persisted reload 不清掉 accepted optimistic 用户行
- `Read`、`view_image`、`functions.view_image`、Edit/FileChanges 的文件打开契约一致
- DOM/CSS 测试同时验证状态和视觉，不只检查内部字段
