# 规格：聊天渲染反馈一致性

> 合并自归档提案：`2026-06-14-116-统一Pi与Codex聊天渲染反馈`

## 验收矩阵

| 需求 | 场景 | 规格测试 | 真实数据来源 | 入口路径 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- |
| Codex live assistant 不显示冗余元信息 | WebSocket assistant 只显示响应正文 | `tests/specs/chat-rendering-parity.spec.tsx` | 真实 `MessageComponent` SSR 渲染 | `MessageComponent` assistant 分支 | 正文可见，provider 标题 `Codex` 和行时间戳不可见 | Node SSR 不验证最终浏览器排版 |
| Codex 响应必须晚于绿色用户气泡 | 用户气泡仍为 sent 时隐藏同 turn live response | `tests/specs/chat-rendering-parity.spec.tsx` | 真实 `mergePersistedAndOptimisticMessages` 和 `reduceNativeRuntimeEvent` | session message merge、native runtime reducer | sent 阶段不显示 live assistant；persisted echo 到达后 user 为 persisted 且 assistant 排在其后 | 多窗口 late duplicate 继续由聊天归并内核规格覆盖 |
| Pi 与 Codex 命令工具卡结构一致 | 相同命令工具共享卡片结构 | `tests/specs/chat-rendering-parity.spec.tsx` | 真实 `MessageComponent` 和 `ToolRenderer` SSR 渲染 | MessageComponent 工具分支、ToolRenderer | 两者都渲染为 `data-testid="codex-tool-card"`，命令、输出 anchor 和结构指纹一致 | 其它工具族需按风险补充专门规格 |

### 需求：Codex live assistant 不显示冗余元信息

#### 场景：WebSocket assistant 只显示响应正文

- 给定前端收到一条 `source: "codex-live"` 或 `source: "codex-realtime"` 的 assistant 消息
- 当 `MessageComponent` 渲染这条实时响应
- 那么用户可见内容必须包含响应正文
- 并且不得显示 provider 标题 `Codex`
- 并且不得显示该响应行的时间戳文本

### 需求：Codex 响应必须晚于绿色用户气泡

#### 场景：用户气泡仍为 sent 时隐藏同 turn live response

- 给定 transcript 中有一条 `deliveryStatus: "sent"` 的 Codex 用户消息
- 并且同 turn 的 `source: "codex-live"` assistant 已通过 WebSocket 到达
- 当生成可见 transcript
- 那么 assistant 响应不得出现在用户气泡变为 persisted 之前
- 当 persisted 用户 echo 到达
- 那么可见 transcript 必须先显示 `deliveryStatus: "persisted"` 的用户气泡，再显示同 turn live assistant
- 并且首轮或新 turn 只有 `clientRequestId`、没有 durable `turnAnchorKey` 时也必须遵守同一规则

### 需求：Pi 与 Codex 命令工具卡结构一致

#### 场景：相同命令工具共享卡片结构

- 给定 Pi 与 Codex 各有一条语义相同的命令工具消息
- 当使用真实 `MessageComponent` 和 `ToolRenderer` 渲染两条消息
- 那么两者都必须渲染为 `data-testid="codex-tool-card"` 工具卡片
- 并且命令文本、`tool-result-*` 输出 anchor、折叠结果和核心结构必须一致
- 并且 Pi 不得走 provider 专属的另一套命令工具卡样式

## 契约测试

### `tests/specs/chat-rendering-parity.spec.tsx`

- 覆盖核心业务契约：Codex live assistant 隐藏冗余 provider/时间戳、Codex live response 等待 persisted 用户气泡、clientRequestId-only 首轮也受 gating 保护、Pi/Codex 命令工具卡结构一致。
- 真实数据来源：通过 Vite SSR 加载生产 `MessageComponent`、`ThemeProvider`、生产 `sessionMessageMerge` 和 `nativeRuntimeTranscript`，输入使用真实 `ChatMessage` 字段组合与真实 Codex runtime event shape。
- 入口路径：`pnpm exec tsx --test tests/specs/chat-rendering-parity.spec.tsx`
- 用户可见断言：以 SSR HTML 和 transcript 顺序检查用户能看到的正文、元信息、气泡顺序、工具卡 anchor 与卡片结构。
