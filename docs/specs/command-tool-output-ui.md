# 命令工具卡输出入口 UI 规格

## 范围

约束 Codex/Pi 手动会话中 **命令类工具卡**（Bash、`functions.exec_command`、`functions.exec_command` 别名及 context-mode execute 变体）的输出展开入口视觉合同。

## 禁止项

- 命令卡内部 **不得** 出现可见文字 `Output` 的 `<summary>` 元素。
- 命令卡 **不得** 把同一 `call_id` 的 `function_call` 和 `function_call_output` 拆成两张独立卡片。

## 必须项

- 命令卡必须存在可点击的 **图标式展开/折叠按钮**（`▸` / `▾`），并通过 `aria-label` 提供 "Show output" / "Hide output" 可访问性标签。
- 命令输出必须通过 `tool-result-{callId}` 形式的 `id` anchor 暴露，供定位、滚动和测试使用。
- 展开后必须能在 `<pre>` 元素中看到真实 stdout/stderr 输出内容。
- 图标按钮和 `details` 展开状态必须双向同步：点击图标按钮可展开/折叠输出；点击 `details` summary（若存在）也必须同步。
- ToolCall stdout/stderr/result 的外层空白行必须在渲染前裁掉，错误结果和非错误结果使用同一归一化入口，并保留非空行的缩进。

## 实现位置

- `frontend/components/chat/tools/components/ContentRenderers/ContextCommandContent.tsx` — `ContextCodeCard` 组件
- `frontend/components/chat/view/subcomponents/MessageComponent.tsx` — `enableResultAnchor` 传递

## 回归测试

- `tests/spec/codex-first-turn-rendering.spec.ts` — 验证 live 和 persisted 阶段命令卡均无可见 Output 行
- `tests/spec/codex-jsonl-single-source-rendering.spec.ts` — 验证旧 JSONL 命令卡展开后输出可见
- `tests/specs/command-tool-output-normalization.spec.ts` — 验证 ToolCall 输出渲染前裁掉外层空白行并保留有效缩进
