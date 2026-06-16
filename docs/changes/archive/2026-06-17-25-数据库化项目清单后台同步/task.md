# 任务：数据库化项目清单后台同步

## 1. 先运行创建阶段契约测试

- [x] 1.1 运行 `pnpm exec tsx --test docs/changes/25-数据库化项目清单后台同步/tests/project-index-db-backed.acceptance.test.ts`
- [x] 1.2 确认初始失败来自目标行为缺失：默认 DB 仍是 `auth.db`，或项目清单仍扫描 provider 目录/不读 `project_index`

## 2. 数据库命名迁移

- [x] 2.1 将默认数据库路径从 `~/.ozw/auth.db` 改为 `~/.ozw/ozw.db`
- [x] 2.2 保留用户显式 `DATABASE_PATH` 不变
- [x] 2.3 增加旧 `auth.db` 到新 `ozw.db` 的启动迁移
- [x] 2.4 更新 CLI/status/log 文案，避免继续暗示默认库只负责 auth

## 3. 项目索引读模型

- [x] 3.1 新增 `project_index` schema 和自愈 migration
- [x] 3.2 实现项目索引 upsert/list/delete/visibility 标记
- [x] 3.3 将 `/api/projects` 默认路径改为只读 `project_index`
- [x] 3.4 保持 `summarizeProjectForList` 的轻量响应契约

## 4. 后台同步

- [x] 4.1 实现启动 backfill：手动配置、provider transcript header、workflow 可见性投影到 DB
- [x] 4.2 改造 provider watcher：单文件变更后更新 provider session index 和受影响 project index
- [x] 4.3 同步完成后发送 `project_list_invalidated`
- [x] 4.4 增加手动 reindex 入口或内部修复函数，处理 watcher 漏事件和 DB 漂移

## 5. 验证

- [x] 5.1 契约测试通过
- [x] 5.2 `pnpm run typecheck:node` 通过
- [x] 5.3 `pnpm run typecheck:test` 通过
- [x] 5.4 `pnpm exec playwright test tests/e2e/project-visibility.spec.ts` 通过
- [x] 5.5 重启 4001，保存项目清单截图、network、runtime log 到 `test-results/project-index-db-backed/`
