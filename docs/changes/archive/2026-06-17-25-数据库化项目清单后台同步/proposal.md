# 提案：数据库化项目清单后台同步

## 背景

左侧项目清单是高频首屏接口，但当前实现仍在请求链路中组合项目配置和 provider 历史文件。虽然已有轻量摘要、coalescer 和 provider index promise 缓存，但本质仍会受磁盘扫描影响。

仓库中已经存在 `provider_session_index` SQLite 表和 watcher 增量写入入口，这说明 DB read model 的基础已经部分存在，但还没有成为 `/api/projects` 的权威读取路径。

## 变更内容

1. 新增项目索引读模型
   - 建议表名：`project_index`
   - 存储项目路由名、展示名、项目路径、来源、可见性、最近活动时间、索引状态。
   - `/api/projects` 只读该表并返回轻量摘要。

2. 后台异步同步
   - 启动后立即返回 DB 中已有快照。
   - 后台 backfill 扫描手动项目配置、provider transcript header、workflow summary source。
   - watcher 捕获新增/变更/删除后增量更新 DB。
   - 同步完成或可见项目变化时广播 `project_list_invalidated`。

3. 数据库命名迁移
   - 默认 DB 从 `~/.ozw/auth.db` 改为 `~/.ozw/ozw.db`。
   - `DATABASE_PATH` 显式指定时继续尊重用户配置。
   - 如果默认路径下存在旧 `auth.db` 且新 `ozw.db` 不存在，启动时自动复制/迁移。

4. 清理请求链路
   - `/api/projects` 不得扫描 `.codex`、`.pi` 或 provider JSONL。
   - 单项目 overview 可以读取 DB provider index，并在必要时按单项目范围深读。
   - 手动 reindex 或后台 backfill 是唯一允许全量扫描 provider 历史的路径。

## 为什么这样做

- 首屏响应从磁盘扫描变成 SQLite 查询，延迟更稳定。
- 临时目录、缺失路径、历史脏数据可在同步层统一过滤和标记，不污染 UI。
- 后台同步失败时仍可返回上一份可用 DB 快照，用户可感知稳定性更好。
- `ozw.db` 名称更准确，避免一个同时承载 auth、provider index、项目索引的数据库继续叫 `auth.db`。

## 用户可见结果

- 打开 `http://localhost:4001/` 时左侧项目清单快速出现。
- 项目清单不会显示直接位于系统临时目录下的 `ozw-pi-*` 项目。
- 旧安装升级后无需手动迁移数据库，用户账号和项目索引可继续使用。
