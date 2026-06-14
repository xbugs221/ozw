# 规格：Provider Live 节流流式渲染

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence | 真实数据来源 | 入口路径 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 需求：Codex/Pi live 正文节流可见 | 场景：assistant 正文 delta 完成前按批次累积显示 | `contract-provider-non-streaming-block-render` | `state-provider-non-streaming-render` | 生产 reducer `nativeRuntimeTranscript.ts`，真实 `codex-response` / `pi-response` envelope | `pnpm exec tsx --test tests/specs/provider-live-non-streaming-render.spec.ts` | in_progress delta 进入一条可见 live assistant，completed 后仍只有一条最终正文 | Node 契约测试不验证真实浏览器排版，需 Playwright 截图补强 |
| 需求：Codex/Pi 工具卡 identity 稳定 | 场景：工具 input 先显示，output 完成后合并到同一卡片 | `contract-provider-non-streaming-block-render` | `screenshot-completed-tool-card`, `console-provider-non-streaming-clean` | 真实 Codex function_call/function_call_output 和 Pi tool_call/tool_result live shape | 同上；浏览器证据走 `tests/spec/codex-first-turn-rendering.spec.ts` 及 `tests/spec/proposal-92-provider-non-streaming-render.spec.ts` | 未完成工具输入先显示，完成后只有一张工具卡且带输入和非空 output | 不覆盖所有 MCP 工具类型，按现有 normalizer 补回归 |
| 需求：Codex/Pi 工具卡空 output 无空白结果区 | 场景：空 output 不生成可见 toolResult | `contract-provider-non-streaming-block-render` | `screenshot-empty-output-card`, `console-provider-non-streaming-clean` | 真实 Codex/Pi 空输出事件 | 同上；浏览器证据走 Playwright 规格测试 | 空 output 完成后工具卡可见但 `toolResult` 为空，不产生结果区 | Node 测试只能检查数据层，空白高度需截图确认 |
| 需求：Codex/Pi 思考块节流可见 | 场景：reasoning/thinking delta 完成前按 thinking 行累积显示 | `contract-provider-non-streaming-block-render` | `screenshot-thinking-block-stable`, `state-provider-non-streaming-render`, `console-provider-non-streaming-clean` | 真实 Codex reasoning 和 Pi thinking live shape | 同上；浏览器证据走 Playwright 规格测试 | 未完成 thinking 已带 `isThinking: true`，completed 后仍是同一 thinking 块，并使用助手正文同款文字样式 | 需要截图确认没有正文到思考块的样式闪烁 |
| 需求：Codex/Pi 可见消息 identity 稳定 | 场景：同一 provider item 完成前后不换 key、不重复、不覆盖 | `contract-provider-non-streaming-block-render` | `state-provider-non-streaming-render`, `console-provider-non-streaming-clean` | 生产 reducer `nativeRuntimeTranscript.ts`，同一 itemId/toolCallId 的真实 live envelope | 同上 | 同一 item 完成后只有一条可见消息；工具输入和 output 共用同一工具 identity；thinking 不覆盖普通正文 | 浏览器层仍需 console 证据确认没有 React key 告警 |
| 需求：新请求用户气泡稳定 | 场景：响应 pending 过程中用户消息不重排、不变形、不被覆盖 | `contract-provider-non-streaming-block-render` | `screenshot-user-bubble-stable`, `state-provider-non-streaming-render`, `console-provider-non-streaming-clean` | 生产 reducer `nativeRuntimeTranscript.ts`，本地用户消息加真实 provider live envelope | 同上；浏览器证据走 Playwright 规格测试 | pending 响应期间用户气泡保持第一行，正文、工具输入和 thinking 追加在后；用户消息字段不被 provider 事件改写 | Node 契约不检查左右气泡 CSS，需要截图确认视觉位置 |

### 需求：Codex/Pi live 正文节流可见

#### 场景：assistant 正文 delta 完成前按批次累积显示

- 给定 Codex 或 Pi WebSocket 推送 `codex-response` / `pi-response`
- 并且 `data.itemType = "agent_message"`
- 并且第一条事件只包含 `delta.text` 和 `status = "in_progress"`
- 当用户查看聊天 transcript
- 那么页面显示一条 live assistant 正文
- 并且同一 `itemId` 的后续 delta 继续累积到这条消息
- 当同一 `itemId` 的 completed 事件携带完整正文
- 那么页面只显示一次完整正文
- 并且 completed final 可以替换前面的 live 草稿

### 需求：Codex/Pi 工具卡 identity 稳定

#### 场景：工具 input 先显示，output 完成后合并到同一卡片

- 给定 Codex WebSocket 先推送 `function_call`，或 Pi WebSocket 先推送 `tool_call`
- 并且该工具调用尚未完成
- 当用户查看聊天 transcript
- 那么页面先显示一张稳定工具输入卡片
- 当同一 `call_id` / `toolCallId` 的 output 到达并完成
- 那么页面显示一张完整工具卡
- 并且卡片中保留命令输入和非空 output
- 并且不得生成第二张 output-only 工具卡

### 需求：Codex/Pi 工具卡空 output 无空白结果区

#### 场景：空 output 不生成可见 toolResult

- 给定 Codex 或 Pi 工具调用已经完成
- 并且 output 是空字符串或纯空白
- 当用户查看工具卡
- 那么工具卡可以显示命令输入
- 并且不得渲染 output 折叠区
- 并且工具卡底部不得留下异常空行

### 需求：Codex/Pi 思考块节流可见

#### 场景：reasoning/thinking delta 完成前按 thinking 行累积显示

- 给定 Codex 或 Pi WebSocket 推送 `reasoning` 或 `thinking`
- 并且第一条事件只包含未完成 delta
- 当用户查看聊天 transcript
- 那么页面显示一个 `isThinking: true` 的思考块
- 并且同一 `itemId` 的后续 delta 继续累积到这个思考块
- 当 completed 事件携带完整思考内容
- 那么页面必须显示一个思考块
- 并且该消息必须带 `isThinking: true`
- 并且思考块必须使用与助手正文一致的字号和文字颜色
- 并且不得使用灰色左竖线、额外缩进或斜体弱化思考正文
- 并且 transcript 中不得同时存在普通正文副本和思考块副本

### 需求：Codex/Pi 可见消息 identity 稳定

#### 场景：同一 provider item 完成前后不换 key、不重复、不覆盖

- 给定 Codex 或 Pi WebSocket 对同一 `itemId` / `toolCallId` 推送多条未完成 delta
- 并且随后推送同一业务 item 的 completed 事件
- 当用户查看聊天 transcript
- 那么完成前只出现一条同 identity 的 live 消息
- 并且完成后仍只出现一条可见消息
- 并且这条消息必须使用稳定 `messageKey`
- 并且不得出现相同内容的重复行
- 并且 thinking 消息不得覆盖同一轮普通 assistant 正文
- 并且工具 input 和 output 必须合并到同一张工具卡

### 需求：新请求用户气泡稳定

#### 场景：响应 pending 过程中用户消息不重排、不变形、不被覆盖

- 给定用户刚发送一条新请求
- 并且 transcript 中已有一条本地用户消息气泡
- 当 Codex 或 Pi WebSocket 推送本轮响应的未完成正文、工具或思考 delta
- 那么用户消息气泡必须仍保持在第一行
- 并且正文、工具输入和思考块只能追加在用户消息之后
- 并且用户消息的 `type` 必须仍是 `user`
- 并且用户消息内容、`deliveryStatus`、`turnAnchorKey` 不得改变
- 当 completed 响应块到达
- 那么响应块必须追加在用户消息之后
- 并且不得把用户气泡渲染成 assistant、thinking 或工具卡样式

## 契约测试

### `tests/specs/provider-live-non-streaming-render.spec.ts`

- 覆盖核心业务契约：Codex/Pi live 分片按节流批次可见累积，完成后正文、工具卡和思考块收敛到稳定 identity；空 output 不生成工具结果区。
- 真实数据来源：直接导入生产 reducer `frontend/components/chat/utils/nativeRuntimeTranscript.ts`，输入使用真实 `codex-response` / `pi-response` envelope 和工具调用 payload。
- 入口路径：`pnpm exec tsx --test tests/specs/provider-live-non-streaming-render.spec.ts`
- 用户可见断言：以 `filterRenderableMessages()` 过滤聊天 transcript 可见消息，检查未完成片段可见累积、完成后只有最终形态、空 output 无结果区、同一 provider item 的 identity 稳定且不重复、响应 pending 过程中用户气泡不被改写或重排。
- 剩余风险：Node 契约测试不测 CSS 高度和真实浏览器重排；执行阶段必须补 Playwright 截图、console 和 state snapshot 证据。
