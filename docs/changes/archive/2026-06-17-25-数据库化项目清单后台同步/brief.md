# 简报：数据库化项目清单后台同步

## 用户问题

当前左侧项目清单仍依赖请求时扫描本地配置和 Codex/Pi JSONL 文件。这个路径容易受到 HOME 历史规模、临时目录、文件系统状态和冷启动扫描影响，导致首屏加载慢、结果不稳定，还会把临时 `ozw-pi-*` 目录误识别为项目。

## 交付目标

- 将项目清单改为读取 SQLite 中的项目索引读模型，前端首屏不再等待 provider JSONL 扫描。
- 将默认数据库名从 `auth.db` 改为更符合职责的 `ozw.db`，保留旧 `auth.db` 自动迁移。
- 增加后台异步同步：启动 backfill + watcher 增量更新 DB，再通过现有 invalidation 机制通知前端刷新。
- 保留单项目 overview 按需加载最近会话和 workflow 的职责边界。

## 非目标

- 不把 SQLite 当作最终事实源；JSONL、项目配置和 workflow state 仍是事实源。
- 不一次性重写聊天消息详情读取；消息详情仍可从 transcript 深读。
- 不移除 `DATABASE_PATH` 自定义能力。

## 验收入口

- 契约测试：`docs/changes/25-数据库化项目清单后台同步/tests/project-index-db-backed.acceptance.test.ts`
- 根目录 E2E：`tests/e2e/project-visibility.spec.ts`
- 运行证据：`test-results/project-index-db-backed/`

## 执行阶段默认上下文

执行阶段应优先实现 DB-backed project index read model，再接入后台同步。最小可交付是：`GET /api/projects` 从 DB 项目索引读取轻量摘要，旧 `auth.db` 自动迁移到 `ozw.db`，并且 provider JSONL 扫描只存在于后台 backfill 或 watcher 增量路径。
