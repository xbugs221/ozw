# 规格：数据库化项目清单后台同步

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence |
| --- | --- | --- | --- |
| 数据库命名迁移 | 默认数据库路径使用 `ozw.db` | `contract-default-db-name` | `runtime-log-4001` |
| 项目清单 DB 读模型 | `/api/projects` 不扫描 provider 历史目录 | `contract-project-list-db-only` | `network-project-list`, `screenshot-project-list` |
| 后台同步 | backfill 和 watcher 负责更新项目索引 | `contract-project-list-db-only`, `e2e-project-visibility` | `runtime-log-sync` |
| 兼容现有可见行为 | 左侧项目清单继续显示真实项目且过滤临时目录 | `e2e-project-visibility` | `screenshot-project-list` |

### 需求：数据库命名迁移

ozw 默认数据库必须使用能表达全应用状态职责的名字，不能继续把默认数据库命名为 `auth.db`。

#### 场景：默认数据库路径使用 `ozw.db`

- **给定** 用户未显式设置 `DATABASE_PATH`
- **当** 后端加载默认环境
- **则** 默认数据库路径必须位于 `~/.ozw/ozw.db`
- **且** 旧 `~/.ozw/auth.db` 存在而新库不存在时，启动必须自动迁移或复制到新库
- **测试文件**：`docs/changes/25-数据库化项目清单后台同步/tests/project-index-db-backed.acceptance.test.ts`
- **真实数据来源**：临时 HOME 下的真实 `.ozw` 目录和 SQLite 文件
- **入口路径**：`backend/load-env.ts`、`backend/database/db.ts`
- **关键断言**：`DATABASE_PATH` basename 为 `ozw.db`
- **剩余风险**：不验证用户显式 `DATABASE_PATH` 指向远端挂载时的性能

### 需求：项目清单 DB 读模型

默认项目清单接口必须从 SQLite 项目索引返回轻量项目摘要，不得在 HTTP 请求链路中扫描 Codex/Pi provider 历史目录。

#### 场景：`/api/projects` 不扫描 provider 历史目录

- **给定** SQLite 项目索引中已经存在一个真实项目摘要
- **当** 后端构建默认轻量项目清单
- **则** 响应必须包含该 DB 项目
- **且** 本次读取不得调用 `.codex` 或 `.pi` provider 历史目录扫描
- **且** 响应不得携带 provider session 重数组
- **测试文件**：`docs/changes/25-数据库化项目清单后台同步/tests/project-index-db-backed.acceptance.test.ts`
- **真实数据来源**：临时 SQLite DB 中的 `project_index` 记录
- **入口路径**：`getProjects(null, { lightweightList: true })`
- **关键断言**：项目路径从 DB 返回，provider 目录扫描次数为 0
- **剩余风险**：契约测试不覆盖所有排序策略，执行阶段需补根目录 E2E

### 需求：后台同步

磁盘扫描必须从前台请求链路移到后台同步链路。

#### 场景：backfill 和 watcher 负责更新项目索引

- **给定** provider JSONL 新增、修改或删除
- **当** watcher 或启动 backfill 处理该变化
- **则** 后台任务必须更新 `provider_session_index` 和 `project_index`
- **且** 同步完成后通过 `project_list_invalidated` 让前端刷新
- **测试文件**：`docs/changes/25-数据库化项目清单后台同步/tests/project-index-db-backed.acceptance.test.ts`
- **真实数据来源**：临时 HOME 中真实 JSONL 文件和真实 SQLite DB
- **入口路径**：provider watcher、project index sync service
- **关键断言**：DB 行更新后项目清单变化，不要求浏览器请求自己扫描磁盘
- **剩余风险**：watcher 丢事件仍需靠启动 backfill 或手动 reindex 修复

### 需求：兼容现有可见行为

DB-backed 改造不得破坏现有用户可见项目清单和单项目详情行为。

#### 场景：左侧项目清单继续显示真实项目且过滤临时目录

- **给定** 用户 HOME 中存在真实项目和 provider 历史
- **当** 用户打开 `http://localhost:4001/`
- **则** 左侧项目清单必须显示真实项目
- **且** 直接位于系统临时目录下的 `ozw-pi-*` 目录不得出现在项目清单
- **且** 点击真实项目后 overview 仍能按需加载最近会话和 workflow
- **测试文件**：`tests/e2e/project-visibility.spec.ts`
- **真实数据来源**：现有 Playwright 真实 fixture HOME、真实 HTTP API、真实浏览器
- **入口路径**：`http://localhost:4001/`
- **关键断言**：sidebar 文案、项目 overview、session link 正常
- **剩余风险**：生产用户 HOME 中非 `ozw-pi-*` 的其他临时目录需通过 visibility policy 逐步收敛
