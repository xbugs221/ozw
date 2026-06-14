# 规格：项目清单轻量摘要 API

> 合并自归档提案：`2026-06-11-101-首页项目清单轻量化`、`2026-06-12-103-多窗口刷新协同和重任务限流`、`2026-06-13-109-项目Provider会话读模型拆分`

### 需求：项目清单默认轻量返回

ozw 默认项目清单接口只回答“有哪些项目”，不能把所有项目的 provider 会话、workflow 和 batch 详情作为刷新首屏的必需数据。

#### 场景：`/api/projects` 不携带 provider 会话和 workflow 重集合

- **给定** 用户的真实 provider history 和 oz flow run 中存在同一个项目
- **当** 浏览器刷新首页并请求 `GET /api/projects`
- **则** 响应中必须包含该项目的路由名、展示名、项目路径和 `routePath`
- **且** 项目摘要不得包含 `sessions`、`codexSessions`、`piSessions`、`workflows` 或 `batches` 数组
- **且** 单个项目摘要必须保持有界，避免 provider/workflow 重集合回流

### 需求：单项目详情按需加载

项目主页、侧栏展开和路由恢复必须通过单项目详情入口按需获取最近会话与 workflow，不依赖默认项目清单携带完整详情。

#### 场景：单项目 overview 返回最近会话和 workflow 概览

- **给定** 用户先从轻量项目清单中获得目标项目名
- **当** 浏览器请求 `GET /api/projects/:projectName/overview?projectPath=...`
- **则** overview 必须成功返回该项目最近的 Codex 会话
- **且** Provider 会话必须仍按项目路径归属到该项目
- **且** overview 必须成功返回该项目的 oz flow workflow 概览
- **且** overview 只作用于单个项目，不要求重新返回所有项目

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
