# 简报：拆分 Provider 会话列表读模型

## 用户问题

`backend/projects.ts` 仍然超过五千行，Codex/Pi 会话列表组装、手动 cN 草稿、workflow 子会话过滤和 UI 状态合并交织在一起。每次修复项目首页会话展示，都容易改到巨型模块深处。

## 交付目标

把 Provider 会话列表的纯业务组装逻辑拆到 `backend/domains/projects/provider-session-list-read-model.ts`，让 `projects.ts` 只负责读取依赖和调用 read model。

## 非目标

- 不重写 provider JSONL 解析器
- 不改变前端 API 返回字段
- 不迁移所有 `projects.ts` 职责

## 验收入口

- 契约测试：`pnpm exec tsx --test docs/changes/3-拆分Provider会话列表读模型/tests/provider-session-list-read-model.contract.test.ts`
- 回归测试：`pnpm test:server && pnpm test:spec:node`

## 执行默认上下文

优先抽出纯函数，保持 `getCodexSessions` / `getPiSessions` 对外行为不变。迁移后应复用已有隐藏、workflow-owned、手动路由绑定和排序规则。
