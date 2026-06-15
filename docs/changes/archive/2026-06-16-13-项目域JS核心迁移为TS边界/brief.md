# 简报：项目域 JS 核心迁移为 TS 边界

## 用户问题

项目域仍由 `backend/domains/projects/project-domain-core.js` 和手写 `.d.ts` 承载关键行为，类型检查无法覆盖项目列表、会话路由、Provider 会话读取和重命名等高频路径。构建还需要 `scripts/copy-build-runtime-js.mjs` 复制运行时 JS，和现有 TypeScript 规格不一致。

## 交付目标

把项目域核心行为迁移到 TypeScript 源码中，删除 JS 实现与声明配对，保持 `backend/projects.ts` 这个公共兼容入口稳定。

## 非目标

不改变项目、会话、Provider、workflow 相关 API 响应字段；不删除仍有测试价值的历史用户配置迁移语义。

## 验收入口

- `pnpm exec tsx --test docs/changes/13-项目域JS核心迁移为TS边界/tests/project-domain-ts-boundary.contract.test.ts`
- `pnpm run typecheck:node`
- `pnpm exec tsx --test tests/backend/projects.rename.test.ts tests/backend/pi-sessions-read-model.test.ts tests/backend/project-overview-session-performance.test.ts`

## 执行默认上下文

优先从公开 facade 到内部模块逐步迁移：`backend/projects.ts` 必须继续导出原有业务入口，`backend/domains/projects/*` 内部可以分批拆分，但每批都要保持真实项目列表、手动会话和 Provider 会话读取行为。
