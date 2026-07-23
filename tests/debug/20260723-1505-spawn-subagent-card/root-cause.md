# spawn_subagent 卡片渲染根因记录

## User scenario

用户希望子智能体派生调用只显示 Agent 图标、任务名称和 `cmd` 内容，避免把 JavaScript 包装函数完整展示出来。

## chain responsibility

`ToolRenderer` 识别子智能体工具 → `summarizeSubagentToolInput` 提取任务名与命令 → `SubagentContainer` 选择紧凑卡片。

## evidence

- 原实现把 `spawn_subagent` 当作通用工具调用，直接展示未经裁剪的输入。
- 真实历史会话已识别并渲染两个派生任务：`attention_tests`、`attention_events`。
- 页面验证截图：[spawn-subagent-card.png](screenshots/spawn-subagent-card.png)。

## root cause

**Confirmed**：缺少派生智能体专用展示分支，同时输入摘要器没有从结构化参数或 JavaScript 包装文本中独立提取 `task_name` 与 `cmd`。

## fix

- 增加 Agent 图标紧凑卡片，仅展示任务名称。
- 有 `cmd` 时在下方原样展示命令，不展示 JavaScript 包装函数。
- 兼容 `spawn_agent`、`spawn_subagent` 及带命名空间的工具名。

## regression

新增单元测试覆盖结构化输入、JavaScript 包装输入和组件渲染边界。

## results

专项测试与前端、测试类型检查均通过；真实会话能够进入新卡片分支。

## risks

历史记录中若命令字段已加密或缺失，只显示任务名称，不猜测或泄露命令内容。
