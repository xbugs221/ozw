# 规格：回复结束折叠非正文内容

## 规范词约定

本规格中的“必须”“不得”“应当”是执行阶段的硬性验收词。未明确列为非目标或剩余风险的用户可见行为，均必须由下方测试或证据覆盖。

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence |
|---|---|---|---|
| 需求：回复正文开始后折叠非正文内容 | 场景：正文前思考和工具调用进入外层折叠组 | `contract-turn-collapse-core` | `turn-collapse-state` |
| 需求：回复正文开始后折叠非正文内容 | 场景：正文尚未开始时 live 过程保持可见 | `contract-turn-collapse-core`, `e2e-turn-collapse-live` | `turn-collapse-live-screenshot` |
| 需求：分层展开可查看全部细节 | 场景：外层组、工具组、命令输出逐级展开 | `contract-turn-collapse-integration`, `e2e-turn-collapse-detail` | `turn-collapse-expanded-screenshot` |
| 需求：批量工具调用按组折叠 | 场景：多个命令收在同一批量工具组下 | `contract-turn-collapse-core`, `contract-turn-collapse-integration` | `turn-collapse-state` |
| 需求：历史回放和 live 渲染一致 | 场景：刷新后非正文仍默认折叠，正文直接可见 | `e2e-turn-collapse-live` | `turn-collapse-after-refresh-screenshot` |

### 需求：回复正文开始后折叠非正文内容

#### 场景：正文前思考和工具调用进入外层折叠组

- 测试文件：`docs/changes/33-回复结束折叠非正文内容/tests/turn-non-body-collapse.acceptance.test.ts`
- 真实数据来源：生产 `ChatMessage` 字段组合，包含用户消息、思考、普通工具调用、批量工具调用和最终助手正文。
- 入口路径：`frontend/components/chat/utils/turnNonBodyCollapse.ts` 的 `buildTurnDisplayBlocks`。
- 关键断言：
  - 普通助手正文存在时，正文之前的思考和工具调用必须归入 `turn-non-body-group`。
  - 非正文组 `defaultOpen` 必须为 `false`。
  - 助手正文必须作为独立 `assistant-body` 直接可见。
- 剩余风险：具体图标和视觉风格通过浏览器截图复核。

#### 场景：正文尚未开始时 live 过程保持可见

- 测试文件：
  - `docs/changes/33-回复结束折叠非正文内容/tests/turn-non-body-collapse.acceptance.test.ts`
  - `docs/changes/33-回复结束折叠非正文内容/tests/turn-collapse-e2e.acceptance.spec.ts`
- 真实数据来源：生产 live runtime item 字段组合和真实聊天页面。
- 入口路径：`buildTurnDisplayBlocks`、`ChatMessagesPane`。
- 关键断言：
  - 只有思考和工具调用、尚无正文时，非正文组 `defaultOpen` 必须为 `true`。
  - live 阶段用户必须可以看到当前思考和正在运行的工具。
  - 正文开始后，之前的非正文内容必须变为默认折叠。
- 剩余风险：真实 Provider 网络不可控，端到端使用仓库既有 live socket harness 驱动生产前端事件处理链路。

### 需求：分层展开可查看全部细节

#### 场景：外层组、工具组、命令输出逐级展开

- 测试文件：
  - `docs/changes/33-回复结束折叠非正文内容/tests/turn-collapse-integration.acceptance.test.ts`
  - `docs/changes/33-回复结束折叠非正文内容/tests/turn-collapse-e2e.acceptance.spec.ts`
- 真实数据来源：生产工具卡、批量工具卡和聊天页面。
- 入口路径：`TurnNonBodyGroup.tsx`、`ToolRenderer`、`CollapsibleSection`。
- 关键断言：
  - 默认必须只展示正文，非正文详情不得可见。
  - 点击外层组后必须显示思考组和工具组。
  - 点击工具组后必须显示多个命令。
  - 点击具体命令输出折叠后必须显示对应输出。
- 剩余风险：不同工具类型的内部详情仍由现有 `ToolRenderer` 负责。

### 需求：批量工具调用按组折叠

#### 场景：多个命令收在同一批量工具组下

- 测试文件：
  - `docs/changes/33-回复结束折叠非正文内容/tests/turn-non-body-collapse.acceptance.test.ts`
  - `docs/changes/33-回复结束折叠非正文内容/tests/turn-collapse-integration.acceptance.test.ts`
- 真实数据来源：生产批量工具输入字段和 `BatchExecuteContent` 渲染入口。
- 入口路径：`buildTurnDisplayBlocks`、`TurnNonBodyGroup.tsx`。
- 关键断言：
  - 同一批量工具调用下的多个命令必须收在一个 `turn-tool-group`。
  - 组摘要必须展示命令数量。
  - 组内命令输出必须仍默认折叠。
- 剩余风险：批量工具 payload 的兼容解析由执行阶段补充更多 Provider 样例。

### 需求：历史回放和 live 渲染一致

#### 场景：刷新后非正文仍默认折叠，正文直接可见

- 测试文件：`docs/changes/33-回复结束折叠非正文内容/tests/turn-collapse-e2e.acceptance.spec.ts`
- 真实数据来源：真实聊天页刷新后的 session messages 读取链路。
- 入口路径：`/session/:sessionId`。
- 关键断言：
  - 刷新后最终正文必须直接可见。
  - 思考文本和工具输出默认不得可见。
  - 外层展开后必须仍可查看思考、工具组和具体输出。
- 剩余风险：历史消息中的旧格式工具结果可能需要执行阶段做兼容映射。
