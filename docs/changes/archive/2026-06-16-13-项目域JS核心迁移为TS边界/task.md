# 任务：项目域 JS 核心迁移为 TS 边界

## 1. 先运行创建阶段契约测试

- [x] 运行 `pnpm exec tsx --test docs/changes/13-项目域JS核心迁移为TS边界/tests/project-domain-ts-boundary.contract.test.ts`
- [x] 确认初始失败来自 JS 核心仍存在、copy runtime JS 仍被引用或 facade 仍导出 JS 核心

## 2. 迁移项目域核心实现

- [x] 将仍被 facade 公开的项目域函数迁移到 `.ts` 模块
- [x] 用业务类型替换 `project-domain-core.d.ts` 中的宽泛 `any`
- [x] 保持 `backend/projects.ts` 的 public export 兼容

## 3. 收敛构建路径

- [x] 删除 `project-domain-core.js` 与 `project-domain-core.d.ts`
- [x] 删除或改造 `copy-build-runtime-js.mjs`，确保 `build:server` 不再复制项目域 JS
- [x] 运行 `pnpm run typecheck:node`
- [x] 记录 `pnpm run typecheck:node` 现状：`backend/server/server-bootstrap.ts` 存在 3 处既有类型错误（与本次提案无关）

## 4. 回归业务路径

- [x] 运行 `pnpm exec tsx --test tests/backend/projects.rename.test.ts tests/backend/pi-sessions-read-model.test.ts tests/backend/project-overview-session-performance.test.ts`
- [x] 复核项目列表、会话路由、Provider 会话读取和 rename 行为没有字段变化
