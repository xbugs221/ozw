# 设计：聊天 Live 渲染与工具卡片体系化

## 状态机

```
pending
  | message-accepted
  v
persisted
  | persisted user echo
  v
persisted confirmed

pending
  | provider error / timeout
  v
failed
```

`sent` 只保留为兼容历史状态，不再作为 Codex/Pi accepted 后的主状态。

## Merge 策略

live turn merge policy 负责判断：

- accepted optimistic 用户行是否保留
- live assistant/tool/thinking 是否可见
- persisted reload 是否替换或确认 live row
- 空 JSONL refresh 是否允许清空 live turn

## 工具卡片文件打开

open-file 工具配置统一输出：

```
label / clickable-path
```

点击路径只调用 `onFileOpen(filePath, diffInfo?)`，不在工具卡片中直接访问后端 API。

## 风险

- 抽 helper 时可能改变边界行为，必须先用现有回归锁定。
- `sent` 历史状态仍可能存在旧测试依赖，需要按当前业务语义更新。
