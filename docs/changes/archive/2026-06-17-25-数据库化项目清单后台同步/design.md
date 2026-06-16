# 设计：数据库化项目清单后台同步

## 核心决策

### SQLite 是读模型，不是最终事实源

最终事实源仍然是：

- 手动项目配置
- Codex/Pi transcript JSONL
- workflow state

SQLite 中的 `project_index` 和已有 `provider_session_index` 是 query-optimized read model。HTTP API 读取 DB，后台同步负责把事实源投影到 DB。

### 默认数据库名改为 `ozw.db`

当前默认路径仍围绕 `auth.db`。新设计使用：

```text
~/.ozw/ozw.db
```

迁移规则：

- 如果用户显式设置 `DATABASE_PATH`，不改写。
- 如果未显式设置，默认使用 `~/.ozw/ozw.db`。
- 如果 `~/.ozw/ozw.db` 不存在但 `~/.ozw/auth.db` 存在，启动时复制旧库到新库，并保留旧文件作为回滚来源。
- 日志必须打印实际 DB 路径，便于排查。

### 推荐表结构

`project_index` 至少包含：

- `project_id`
- `name`
- `display_name`
- `project_path`
- `normalized_project_path`
- `route_path`
- `source`：`manual` / `codex` / `pi` / `workflow`
- `visible`
- `visibility_reason`
- `last_activity`
- `indexed_at`
- `sync_state`

`provider_session_index` 保持 provider session header 索引职责，但应补齐按 project 聚合项目候选的查询入口，避免项目发现再扫 JSONL。

## 调用链

### 首屏项目清单

```text
Browser -> GET /api/projects -> project_index SQLite query -> lightweight summaries
```

禁止路径：

```text
GET /api/projects -> scan ~/.codex or ~/.pi -> parse JSONL
```

### 后台同步

```text
startup -> schedule project index backfill -> scan config/provider/workflow sources -> upsert project_index/provider_session_index -> broadcast project_list_invalidated
```

### 增量更新

```text
chokidar add/change/unlink -> index one provider file -> upsert/delete provider_session_index -> recompute affected project_index row -> broadcast scoped invalidation
```

## 失败处理

- DB 读失败：返回明确 500，并在日志输出 DB 路径和错误。
- backfill 失败：保留旧 DB 快照，记录 runtime log，不阻塞首屏。
- provider 文件解析失败：跳过该文件并记录 warning，不影响其他项目。
- 项目路径缺失：写入 `visible = 0` 或 visibility reason，不返回到默认项目清单。

## 风险

- 首次升级后 DB 为空时，首屏可能只显示已有快照或空列表，直到 backfill 完成。
- 需要小心处理旧 `auth.db`、自定义 `DATABASE_PATH` 和测试 fixture DB 的兼容。
- watcher 不是可靠的唯一同步机制，必须保留手动/启动 backfill 修复漂移。

## 取舍

不建议在本提案里彻底删除所有磁盘扫描代码。扫描仍然需要存在于后台 backfill 和修复命令中；本提案的边界是把扫描移出 `/api/projects` 请求链路。
