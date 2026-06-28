# 任务：回复结束折叠非正文内容

## 1. 先运行创建阶段契约测试

- [x] 运行 `pnpm exec tsx --test docs/changes/33-回复结束折叠非正文内容/tests/turn-non-body-collapse.acceptance.test.ts`
- [x] 运行 `pnpm exec tsx --test docs/changes/33-回复结束折叠非正文内容/tests/turn-collapse-integration.acceptance.test.ts`
- [x] 运行 `pnpm exec playwright test --config=playwright.spec.config.ts docs/changes/33-回复结束折叠非正文内容/tests/turn-collapse-e2e.acceptance.spec.ts`
- [x] 确认初始失败原因是 turn 级折叠功能缺失，而不是测试语法、路径或环境错误。

## 2. 实现 turn 级非正文分组

- [x] 新增 `frontend/components/chat/utils/turnNonBodyCollapse.ts`
- [x] 导出 `buildTurnDisplayBlocks`
- [x] 将同一用户回合内正文之前的思考和工具调用归入非正文组。
- [x] 正文尚未开始时，非正文组默认展开。
- [x] 正文开始或本轮完成后，非正文组默认折叠。

## 3. 实现外层折叠组件

- [x] 新增 `frontend/components/chat/view/subcomponents/TurnNonBodyGroup.tsx`
- [x] 外层根节点提供 `data-testid="turn-non-body-group"`
- [x] 外层按钮提供 `data-testid="turn-non-body-toggle"`
- [x] 思考分组提供 `data-testid="turn-thinking-group"`
- [x] 工具分组提供 `data-testid="turn-tool-group"`
- [x] 组内命令提供 `data-testid="turn-tool-command"`

## 4. 复用现有工具详情折叠

- [x] 工具输入和输出继续走 `ToolRenderer`
- [x] 单个命令输出继续通过 `<details>` 或现有按钮展开。
- [x] 批量工具调用按组渲染，不平铺成无边界的命令列表。
- [x] 子智能体工具组保持可展开的内部步骤。

## 5. 接入聊天消息面板

- [x] `ChatMessagesPane` 使用 `buildTurnDisplayBlocks` 输出渲染块。
- [x] 保持虚拟滚动 DOM 上限。
- [x] 保持 `data-message-key` 定位能力。
- [x] 正文消息仍用现有 `MessageComponent` 渲染。

## 6. 更新旧测试和旧规格意图

- [x] 更新“工具完成后保持展开”相关旧测试，使其只约束正文开始前的 live 阶段。（审查后未发现需改写的冲突旧测试，本提案契约覆盖该行为。）
- [x] 增加正文开始后外层非正文组默认折叠的断言。
- [x] 保留用户展开后可查看完整工具输出的断言。

## 7. QA 证据

- [x] 生成 `test-results/turn-non-body-collapse/live.png`
- [x] 生成 `test-results/turn-non-body-collapse/collapsed-after-body.png`
- [x] 生成 `test-results/turn-non-body-collapse/expanded-detail.png`
- [x] 生成 `test-results/turn-non-body-collapse/state.json`
