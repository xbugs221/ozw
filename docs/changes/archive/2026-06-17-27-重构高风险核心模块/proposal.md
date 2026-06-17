# 提案：重构高风险核心模块

## 背景

上一个提案已经为低状态业务测试补齐规划。本提案进一步处理结构风险：高价值模块过长、职责过多、业务规则和 UI/装配代码混在一起，导致后续重构容易改坏用户路径。

## 风险排序

| 优先级 | 模块 | 当前风险 | 重构价值 |
| --- | --- | --- | --- |
| P0 | `ProjectOverviewPanel.tsx` | 约 1400 行，项目总览、manual session、workflow、操作入口、排序折叠混在一个 React 文件 | 降低项目首页和 workflow 入口变更风险 |
| P0 | `useChatSessionStateImpl.ts`、`useChatComposerStateImpl.ts`、`useChatRealtimeHandlersImpl.ts` | 三个核心 hook 合计约 3900 行，session 加载、提交、实时事件和消息协调交织 | 聊天页是最高频主链路，拆分后可用 unit tests 锁业务规则 |
| P1 | `server-bootstrap.ts`、`chat-command-dispatcher.ts`、`file-routes.ts` | 启动装配、协议分发和文件 API helper 仍包含大量私有业务逻辑 | 后端安全边界和 realtime 协议更容易审查 |

## 范围

- 为 project overview 新建 `frontend/components/main-content/project-overview/` 模块组。
- 为 chat runtime 新建或完善 `frontend/components/chat/session/`、`composer/`、`realtime/` 下的控制器模块。
- 为 backend server 新建 `backend/server/realtime/*` 和 `backend/server/files/*` 边界模块。
- 调整原巨型文件为组合层，并设置行数预算。
- 新增默认测试和 durable docs，证明重构后业务语义没有退化。

## 非目标

- 不做视觉重设计。
- 不替换 React hook 架构。
- 不改变 API URL、WebSocket message type 或文件 API 响应结构。
- 不删除现有 e2e/spec；只补默认 unit/backend/spec 合同。

## 成功标准

- 创建阶段契约测试全部通过。
- `ProjectOverviewPanel.tsx`、三大 chat hook、后端三大边界文件降到提案约束的行数预算内。
- 新模块有文件头目的说明，关键函数有 docstring。
- `tests/unit`、`tests/backend`、`tests/specs` 和 `docs/specs` 同步覆盖新边界。
