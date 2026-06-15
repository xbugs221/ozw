# 提案：聊天工具卡与消息转换类型收敛

## 为什么现在做

聊天体验依赖稳定的工具卡和消息转换。现在 file update、tool update、subagent tool、shell output 等解析分布在多个文件中，类型边界松散，后续扩展工具卡时容易重复修补。

## 做什么

- 新增 `providerPayloadParsers.ts`，统一 provider file update、Codex tool update 和 tool result content 解析。
- 新增工具配置注册表，并按 shell/file/codex/subagent 等 family 拆分配置。
- 收敛 `ToolDisplayConfig` 的输入输出类型，减少公开 `any`。
- 保持折叠大输出、file operation、subagent container 和 live transcript 合并行为。

## 可观察结果

新增工具卡时只需要添加 family 配置和 typed parser 测试；消息转换和 merge 不再各自维护同一 payload 解析规则。
