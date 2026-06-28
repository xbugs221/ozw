# 32 优化长会话历史预加载

## 用户问题

在一个具体长会话里，前端当前只先加载最新一段消息。用户向上翻阅时，比较早的对话在顶部之前没有被提前补齐，体感像“只能加载一定数量的消息”；即使懒加载是为了性能，也不应等用户已经翻到顶部才开始请求更早历史。

## 交付目标

| 目标 | 说明 |
| --- | --- |
| 提前预加载 | 用户向上滚动进入历史预加载区时，后台主动请求更早一页消息 |
| 保持锚点 | 更早消息 prepend 后，用户正在阅读的位置不跳到顶部或底部 |
| 保持性能 | 初始进入仍只加载最新分页，预加载仍按分页请求，不退化成全量加载 |
| 保持既有能力 | 顶部加载、外部追加、搜索跳转、虚拟列表和 raw line cursor 语义不回退 |

## 非目标

- 不改变后端 JSONL 分页协议，除非执行阶段证明前端无法独立修复。
- 不把“加载全部消息”改成默认行为。
- 不调整会话搜索、消息去重或 provider 转换规则的业务语义。

## 验收入口

- 合同测试：`pnpm exec playwright test docs/changes/32-优化长会话历史预加载/tests/history-prefetch.acceptance.spec.ts --config=docs/changes/32-优化长会话历史预加载/playwright.config.ts`
- 既有端到端回归：`pnpm exec playwright test tests/e2e/history-scroll-preservation.spec.ts`
- 后端 cursor 回归：`pnpm exec tsx --test tests/specs/session-incremental-read.spec.ts`
- 性能边界回归：`pnpm exec tsx --test tests/specs/chat-performance-boundary.spec.ts`

## 执行阶段默认上下文

- 主要入口：`frontend/components/chat/session/sessionRuntimeController.ts`
- 消息请求窗口：`frontend/components/chat/session/sessionMessageLoader.ts`
- 消息面板虚拟渲染：`frontend/components/chat/view/subcomponents/ChatMessagesPane.tsx`
- 后端分页契约：`backend/domains/projects/provider-transcript-read-model.ts`
- 现有用户流程测试：`tests/e2e/history-scroll-preservation.spec.ts`
