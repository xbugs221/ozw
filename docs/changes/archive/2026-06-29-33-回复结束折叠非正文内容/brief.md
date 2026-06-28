# 回复结束折叠非正文内容简报

## 用户问题

智能体一轮回复中会产生思考、工具调用、批量命令、子任务和正文。当前界面虽然已有单个思考块和工具输出的折叠能力，但一轮完成后，非正文内容仍占据大量纵向空间，用户需要滚很久才能看到最终回复正文。

## 交付目标

- WebSocket live 流式阶段保持思考和工具调用实时可见。
- 当本轮进入正文回复阶段，或本轮最终回复完成后，将正文之前的思考和工具调用整体折叠。
- 默认只展示回复正文，非正文内容收进一个外层“思考与工具调用”组。
- 用户点击外层组后，可以看到思考内容和工具调用组。
- 批量工具调用按组折叠；用户展开组后看到多个命令。
- 用户继续点击具体命令的折叠按钮后，才能看到该命令输出。
- 风格参考 Codex App：正文优先、过程内容安静收起、细节仍可查。

## 非目标

- 不隐藏或删除思考和工具历史。
- 不改变 Provider 消息顺序和归并规则。
- 不改变单个工具输出已有的详情折叠能力。
- 不要求服务端改变历史消息格式。

## 验收入口

- `pnpm exec tsx --test docs/changes/33-回复结束折叠非正文内容/tests/turn-non-body-collapse.acceptance.test.ts`
- `pnpm exec tsx --test docs/changes/33-回复结束折叠非正文内容/tests/turn-collapse-integration.acceptance.test.ts`
- `pnpm exec playwright test --config=playwright.spec.config.ts docs/changes/33-回复结束折叠非正文内容/tests/turn-collapse-e2e.acceptance.spec.ts`

## 执行阶段默认上下文

优先复用以下现有能力：

```text
ChatMessagesPane
  |
  +-- MessageComponent
  |     +-- 思考块已有 details
  |     +-- 工具卡已有 codex-tool-card
  |
  +-- ToolRenderer
        +-- CollapsibleSection
        +-- BatchExecuteContent
        +-- SubagentContainer
```

新增实现应增加“turn 级非正文组”这一层，而不是删掉现有工具卡和输出折叠。
