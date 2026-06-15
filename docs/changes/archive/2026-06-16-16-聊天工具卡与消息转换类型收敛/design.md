# 设计：聊天工具卡与消息转换类型收敛

## 关键决策

1. parser 先统一，不先改 UI。

把重复的 payload 识别逻辑收敛到纯函数，UI 组件继续使用现有展示模式。

2. 工具配置按 family 拆，不按单个 tool 过度碎片化。

例如 shell、file operation、plan/update、subagent 分成少数模块，避免每个 tool 一个文件造成薄层。

3. 外部输入使用 unknown，进入业务配置前归一化。

Provider 原始消息、tool input/result 都可以是未知 JSON，但 ToolRenderer 接收的 content props 必须有明确结构。

## 风险

- 工具卡配置覆盖面大，拆分时容易漏掉 displayToolName 或 open file path。
- 消息转换和 merge 的顺序行为敏感，必须继续跑既有 chat merge 和 rendering parity 测试。

## 取舍

不重写消息归并算法，只消除重复 payload parser 和工具配置巨型文件。
