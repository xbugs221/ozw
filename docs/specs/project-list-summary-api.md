# 规格：项目清单轻量摘要 API

### 需求：项目清单默认轻量返回

ozw 默认项目清单接口只回答“有哪些项目”，不能把所有项目的 provider 会话、workflow 和 batch 详情作为刷新首屏的必需数据。

#### 场景：`/api/projects` 不携带 provider 会话和 workflow 重集合

- **给定** 用户的真实 provider history 和 oz flow run 中存在同一个项目
- **当** 浏览器刷新首页并请求 `GET /api/projects`
- **则** 响应中必须包含该项目的路由名、展示名、项目路径和 `routePath`
- **且** 项目摘要不得包含 `sessions`、`codexSessions`、`piSessions`、`workflows` 或 `batches` 数组
- **且** 单个项目摘要必须保持有界，避免 provider/workflow 重集合回流

#### 场景：默认项目清单从 SQLite project_index 返回

- **给定** SQLite `project_index` 中已经存在可见项目摘要
- **当** 浏览器刷新首页并请求 `GET /api/projects`
- **则** 响应必须包含该 DB 项目的路由名、展示名、项目路径和 `routePath`
- **且** 本次读取不得扫描 `.codex` 或 `.pi` provider 历史目录
- **且** 响应不得携带 `sessions`、`codexSessions`、`piSessions`、`workflows` 或 `batches` 重集合
- **测试文件**：`tests/specs/project-index-db-backed.spec.ts`

#### 场景：项目 rename/delete 写路径同步 project_index

- **给定** 用户手动添加的项目已经进入 `project_index`
- **当** 用户重命名该项目
- **则** DB-backed 轻量项目清单必须显示新的 `displayName`
- **当** 用户删除该项目
- **则** DB-backed 轻量项目清单不得继续返回该项目
- **测试文件**：`tests/specs/project-index-db-backed.spec.ts`

### 需求：默认数据库命名表达全应用状态

ozw 默认 SQLite 数据库承载项目索引、Provider 索引和其他应用状态，默认文件名必须使用 `ozw.db`，不能继续暗示只负责 auth。

#### 场景：服务端和 CLI 使用同一个默认数据库路径

- **给定** 用户未显式设置 `DATABASE_PATH`
- **当** 后端加载默认环境或用户运行 `ozw status`
- **则** 默认数据库路径必须位于 `~/.ozw/ozw.db`
- **且** CLI 不得回退到安装目录下的 `server/database/ozw.db`
- **测试文件**：`tests/specs/project-index-db-backed.spec.ts`

### 需求：单项目详情按需加载

项目主页、侧栏展开和路由恢复必须通过单项目详情入口按需获取最近会话与 workflow，不依赖默认项目清单携带完整详情。

#### 场景：单项目 overview 返回最近会话和 workflow 概览

- **给定** 用户先从轻量项目清单中获得目标项目名
- **当** 浏览器请求 `GET /api/projects/:projectName/overview?projectPath=...`
- **则** overview 必须成功返回该项目最近的 Codex 会话
- **且** Provider 会话必须仍按项目路径归属到该项目
- **且** overview 必须成功返回该项目的 oz flow workflow 概览
- **且** overview 只作用于单个项目，不要求重新返回所有项目

### 需求：前端项目状态 Hook 保持组合职责

`useProjectsState` 必须只承担 React state/effect、API 调用和公开返回形状，项目路由选择、Provider 会话集合和项目刷新 merge 规则必须拆到可独立审查的业务模块。

#### 场景：项目路由选择规则可独立测试

- **给定** 用户通过旧 `/session/:id`、手动 `cN` 或 workflow child session 路径进入项目工作区
- **当** 前端解析应打开的项目和会话
- **则** 路由选择规则必须由 `frontend/hooks/projects/projectRouteSelection.ts` 承载
- **且** `useProjectsState.ts` 必须导入该模块，而不是在 hook 主体堆叠主要 route regex 和查找规则
- **且** 默认 Vitest 回归必须覆盖 cN route、legacy route、workflow child session route、provider 归属和 visible sessions
- **测试文件**：`tests/specs/project-refresh-coordination.spec.ts`、`tests/unit/project-routing-refresh.test.ts`

#### 场景：项目刷新和会话集合规则保持用户路径稳定

- **给定** 项目 summary、单项目 overview、Provider 会话和 scoped invalidation 同时参与刷新
- **当** 前端合并项目状态并构造项目会话列表
- **则** summary/overview merge 必须由 `projectRefreshReducer.ts` 承载
- **且** Provider session 集合和插入规则必须由 `projectSessionCollections.ts` 承载
- **且** hook 的 public return shape 不得因拆分改变项目工作区导航行为
- **且** 轻量 summary refresh 不得覆盖已加载详情，optimistic 临时 `cN` 会话必须能替换为真实 provider session
- **测试文件**：`tests/specs/project-refresh-coordination.spec.ts`、`tests/spec/project-workspace-navigation.spec.ts`、`tests/unit/project-routing-refresh.test.ts`

### 需求：项目域边界可审查

项目发现、配置读取、会话路由、overview、删除和搜索必须由项目域模块承载，`backend/projects.ts` 只能作为兼容 facade 和依赖装配入口。

#### 场景：项目 facade 不承载核心规则

- **给定** 维护者审查项目列表和单项目 overview 的后端入口
- **当** 项目域逻辑完成分层
- **则** `backend/domains/projects/` 下必须存在项目发现、配置 read model、manual route、overview、删除和搜索服务
- **且** `backend/projects.ts` 不得重新实现 provider 会话过滤、manual route counter、route binding、删除或搜索核心规则
- **且** `project-domain-service.ts` 必须保持聚合 facade 职责，不得再次变成新的巨型规则文件
- **测试文件**：`tests/specs/backend-type-module-boundary.spec.ts`

#### 场景：manual route 绑定由项目域模块统一负责

- **给定** 用户创建 `cN` 手动会话草稿
- **当** provider session 被绑定并 finalize
- **则** route index、providerSessionId 和 runtime 读取写入必须由 manual route read model 或 session route store 承载
- **且** 旧 config key 的读取和清理兼容路径必须保留

#### 场景：删除和搜索不污染项目发现主路径

- **给定** 用户刷新首页项目清单
- **当** 后端发现项目并返回轻量摘要
- **则** 项目发现路径不得深读所有 JSONL 消息正文
- **且** 聊天搜索必须由独立 search service 处理
- **且** Codex/Pi 会话删除、空项目删除和归档索引清理必须由删除 service 协调

#### 场景：聊天搜索读取真实 Provider transcript

- **给定** 临时 HOME 中存在真实 Codex JSONL，且项目配置已经登记对应项目
- **当** 后端执行 `searchChatHistory` 搜索唯一业务短语
- **则** 搜索结果必须包含对应 `sessionId`、`projectName`、`provider` 和命中文本
- **且** 该能力必须由 search service 承载，不得把全文搜索逻辑挪回项目清单默认路径
- **测试文件**：`tests/specs/project-domain-business.spec.ts`

#### 场景：Provider 会话列表保留手动 cN 路由且隐藏重复底层 session

- **给定** Provider JSONL 中存在已绑定到手动 `cN` 路由的底层 session
- **当** 后端构建单项目 Provider 会话列表
- **则** 输出中必须保留用户可点击的 `cN` 路由，并保留其 `routeIndex` 和 `providerSessionId`
- **且** 输出中不得再出现同一个底层 provider session
- **测试文件**：`tests/specs/provider-session-list-read-model.spec.ts`
- **入口路径**：`buildProviderSessionListReadModel`

#### 场景：普通 Provider 会话列表过滤 workflow-owned session

- **给定** workflow read model 标记某个 provider session 为工作流子会话
- **当** 后端构建普通 Provider 会话列表且启用 workflow child 过滤
- **则** workflow-owned session 不得出现在普通手动会话列表
- **且** 非 workflow-owned 的普通 provider session 必须继续显示
- **测试文件**：`tests/specs/provider-session-list-read-model.spec.ts`
- **入口路径**：`buildProviderSessionListReadModel`

#### 场景：Provider 会话列表核心规则由 read model 承载

- **给定** Provider 会话列表 read model 位于 `backend/domains/projects/provider-session-list-read-model.ts`
- **当** 审查 `backend/projects.ts` 的项目首页会话组装代码
- **则** `projects.ts` 必须调用 `buildProviderSessionListReadModel`
- **且** 绑定 provider session 和 workflow-owned session 的核心过滤逻辑必须位于 read model 模块
- **测试文件**：`tests/specs/provider-session-list-read-model.spec.ts`

### 需求：首屏与详情职责分离

项目清单响应不得等待 workflow watcher ready、全局 workflow attach 或 provider 全历史索引完成；这些重任务应在单项目详情或后台异步路径处理。

#### 场景：默认项目清单响应不等待 watcher ready 或全局 workflow attach

- **给定** 用户有真实 provider history 和 oz flow run
- **当** 浏览器请求默认项目清单
- **则** 默认响应没有 `workflows` 或 `batches` 字段
- **且** network evidence 必须能区分默认项目清单请求和单项目 overview 请求
- **且** runtime evidence 必须证明 watcher 注册或 workflow 详情加载不阻塞首屏项目清单响应

### 需求：多窗口项目刷新协调

浏览器同时打开多个 ozw 窗口时，项目清单刷新不能按窗口数量线性放大。

#### 场景：同一项目列表 invalidation 只允许一个 owner 执行重刷新

- **给定** 一个可见窗口和一个隐藏窗口收到同一 `project_list_invalidated`
- **当** 两个窗口请求项目刷新决策
- **则** 可见窗口必须成为 refresh owner 并执行 `/api/projects`
- **且** 隐藏窗口不得主动执行同一项目重刷新
- **且** 同一 scope 同一版本只能选出一个 refresh owner

#### 场景：非 owner 窗口复用 owner 广播的同版本项目快照

- **给定** owner 窗口完成项目刷新并广播项目快照
- **当** follower 窗口等待同一 scope/version 的快照
- **则** follower 必须应用 owner 快照
- **且** follower 不得主动请求 `/api/projects`
- **且** 同一 scope 的新 invalidation 不得复用旧版本快照

### 需求：后端重任务合并

服务端必须保护相同业务 scope 的并发重读，避免前端协调失效或多个浏览器 profile 同时访问时重复扫描。

#### 场景：相同 scope 的并发项目清单读取只执行一次真实 task

- **给定** 两个相同 scope 的 `/api/projects` 读取并发发生
- **当** 后端执行项目清单读取
- **则** 真实读取 task 只能执行一次
- **且** 两个调用必须得到同一个业务结果
- **且** promise settle 后下一次调用必须重新执行真实 task

#### 场景：不同 scope 可并行，失败 scope 不缓存错误且允许重试

- **给定** `projects:list`、项目 overview、workflow 详情或搜索等不同业务 scope
- **当** 这些 scope 并发读取
- **则** 不同 scope 不得互相阻塞或被错误合并
- **且** 相同 query/scope 的并发搜索、overview 或 workflow 详情读取必须合并或采用明确有界读取策略
- **且** 失败 scope settle 后不得缓存错误，下一次相同 scope 调用必须能重试
