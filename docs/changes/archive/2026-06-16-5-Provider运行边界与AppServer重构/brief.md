# 简报：Provider 运行边界与 AppServer 重构

## 用户问题

Codex 已迁到 app-server，Pi 仍走 native SDK，但运行边界、route session 绑定、active turn overlay、live snapshot 和错误状态还散在多个模块中。历史上 `co`、Codex SDK、app-server 迁移交织过，继续保持松散结构会让后续修复重新污染主路径。

## 交付目标

建立清晰的 provider runtime 边界：Codex app-server、Pi SDK、route session、active-turn overlay 和 runtime snapshot 各有单一职责，并通过契约测试防止旧 SDK/co 语义回流。

## 非目标

- 不替换 Codex app-server
- 不重写 Pi SDK 集成
- 不新增 provider
- 不改变用户可见 API 字段

## 验收入口

- 契约测试：`pnpm exec tsx --test docs/changes/5-Provider运行边界与AppServer重构/tests/provider-runtime-boundary.contract.test.ts`
- 回归测试：`pnpm run typecheck:node && pnpm exec tsx --test tests/specs/codex-app-server-steer-runtime.spec.ts tests/specs/codex-app-server-protocol-mapping.spec.ts`

## 执行默认上下文

以小步抽取为主：先把纯路由、状态和协议转换逻辑抽出，再收敛 `backend/native-agent-runtime.ts` 的协调职责。不要为了行数做无意义拆分。
