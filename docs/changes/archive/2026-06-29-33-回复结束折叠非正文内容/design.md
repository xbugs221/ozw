# 设计：回复结束折叠非正文内容

## 总体结构

```text
frontend/components/chat/utils/turnNonBodyCollapse.ts
  |
  +-- buildTurnDisplayBlocks(messages)
        |
        +-- user-message
        +-- turn-non-body-group
        +-- assistant-body

frontend/components/chat/view/subcomponents/TurnNonBodyGroup.tsx
  |
  +-- 外层折叠
  +-- 思考组
  +-- 工具调用组
  +-- 批量工具组

ChatMessagesPane
  |
  +-- 按 display blocks 渲染
```

## 分组规则

| 消息类型 | 归类 |
|---|---|
| `type=user` | 回合起点 |
| `assistant && isThinking` | 非正文：思考组 |
| `assistant && isToolUse` | 非正文：工具组 |
| `isSubagentContainer` | 非正文：子智能体工具组 |
| `assistant` 普通正文 | 正文 |
| `error` | 不进入默认折叠，保持可见 |

## 折叠时机

```text
同一回合内存在普通 assistant 正文
  -> 正文之前的思考和工具调用默认折叠

同一回合内尚无普通 assistant 正文
  -> live 阶段保持展开，避免用户看不到当前执行进度
```

## 分层展开

```text
TurnNonBodyGroup
  |
  +-- ThinkingGroup
  |
  +-- ToolGroup
        |
        +-- ToolRenderer input summary
        +-- ToolRenderer result details
```

批量工具调用使用一个 `turn-tool-group` 包住多条命令，组内每条命令继续复用现有工具卡输出折叠。

## 数据合同

建议 `buildTurnDisplayBlocks` 输出：

| 字段 | 含义 |
|---|---|
| `kind` | `user-message`、`turn-non-body-group`、`assistant-body` |
| `turnKey` | 同一回合稳定键 |
| `defaultOpen` | 非正文组默认是否展开 |
| `items` | 思考、工具或批量工具分组 |
| `message` | 原始消息 |

## 风险和取舍

| 风险 | 处理 |
|---|---|
| 旧测试期望工具完成后展开 | 按新意图更新为“正文开始前展开，正文开始后外层折叠” |
| 用户错过 live 执行进度 | 只有正文开始后才自动折叠 |
| 多 Provider 消息形态不同 | 基于现有 `isThinking`、`isToolUse`、普通 assistant 正文字段判断 |
| DOM 变少但定位复杂 | 外层组和内部工具保留稳定 `data-testid` 和 message key |
