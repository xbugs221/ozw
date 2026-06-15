# 简报：项目域与会话路由 ReadModel 分层

## 用户问题

`backend/projects.ts` 当前同时承担项目发现、项目配置迁移、manual session route、provider 会话索引、workflow child 过滤、删除归档和聊天搜索。这个文件约五千行，任何项目列表或会话路由变更都会牵动过宽影响面。

## 交付目标

把项目域拆成稳定 read model 与 service 边界，让 `/api/projects`、overview、会话列表、manual route、provider session 和删除归档继续保持现有行为，但核心规则不再集中在单个大文件。

## 非目标

不重写 provider JSONL 解析格式，不改变现有 URL、响应字段、session id 兼容策略，不删除历史配置迁移能力。

## 验收入口

- `pnpm exec tsx --test docs/changes/8-项目域与会话路由ReadModel分层/tests/project-domain-boundary.contract.test.ts`
- `pnpm exec tsx --test tests/spec/project-list-summary-api.spec.ts tests/specs/provider-session-list-read-model.spec.ts`
- `pnpm exec tsx --test tests/backend/projects.rename.test.ts tests/backend/projects.delete.test.ts tests/backend/project-overview-session-performance.test.ts`

## 执行默认上下文

执行阶段先读取 `backend/projects.ts`、`backend/domains/projects/*`、`backend/server/http-routes.ts` 和 `docs/specs/project-list-summary-api.md`。先让本提案契约测试因目标边界缺失而失败，再逐步迁移逻辑。
