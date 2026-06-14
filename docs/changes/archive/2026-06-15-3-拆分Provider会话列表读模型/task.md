# 任务：拆分 Provider 会话列表读模型

## 1. 契约测试先行

- [x] 运行 `pnpm exec tsx --test docs/changes/3-拆分Provider会话列表读模型/tests/provider-session-list-read-model.contract.test.ts`
- [x] 确认初始失败是目标模块缺失或 `projects.ts` 尚未调用新模块

## 2. 新增 read model 模块

- [x] 新增 `backend/domains/projects/provider-session-list-read-model.ts`
- [x] 实现 provider session、manual draft、workflow-owned id 的合并过滤
- [x] 保留 loose record 兼容，函数内部写清业务 docstring

## 3. 迁移 projects.ts 调用方

- [x] 迁移 Codex 会话列表组装
- [x] 迁移 Pi 会话列表组装
- [x] 保留 UI 状态、隐藏过滤、routeIndex 行为
- [x] 删除 `projects.ts` 中重复的 bound provider session 过滤样板

## 4. 验证

- [x] `pnpm exec tsx --test docs/changes/3-拆分Provider会话列表读模型/tests/provider-session-list-read-model.contract.test.ts`
- [x] `pnpm test:server`
- [x] `pnpm test:spec:node`
- [x] 保存 `test-results/provider-session-list/read-model-output.json` 和 `test-results/provider-session-list/source-audit.json`
