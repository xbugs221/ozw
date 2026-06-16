# 规格：后端类型与模块边界

## 需求：核心后端文件必须恢复类型检查

第一批核心后端文件不得继续用 TypeScript suppression 注释逃避类型错误。

### 场景：核心文件无 suppression 且 node 编译通过

- **给定** 后端核心启动、Codex runtime 和消息处理文件
- **当** 执行 TypeScript node 编译
- **则** 编译必须通过
- **且** 核心文件不得包含 `@ts-nocheck`、`@ts-ignore` 或 `@ts-expect-error`

## 需求：后端启动入口必须保持低耦合职责

`backend/index.ts` 和 `backend/server-main.ts` 只能承担启动和注册边界，不得重新承载路由、WebSocket、静态资源和文件操作的巨型实现。

### 场景：启动入口体量受控并保留启动语义

- **给定** 后端启动入口
- **当** 维护者修改启动链路
- **则** `backend/index.ts` 必须保持小型 bootstrap
- **且** `backend/server-main.ts` 必须保持 typed bootstrap boundary
- **且** 不能把巨型 operational body 搬回启动包装文件

## 需求：Codex event transform 必须单一来源

Codex event 到 chat message 的映射不得在多个后端文件中重复维护。

### 场景：重复 transform 被共享实现取代

- **给定** Codex JSONL、app-server 和 native runtime 事件入口
- **当** 后端归一化 Codex event
- **则** 只有一个主 transform 实现负责结构转换
- **且** 旧入口必须调用共享 normalizer 路径

## 需求：触达后端核心文件不得静默吞错

本能力覆盖的核心后端文件不能通过空 `catch` 或 `.catch(() => null/false/undefined)` 隐藏失败。

### 场景：失败路径保留可诊断信号

- **给定** 后端核心启动、Codex runtime 和消息处理文件
- **当** 维护者新增异步 fallback 或错误处理
- **则** 不得新增空 catch
- **且** 不得把 rejected promise 静默折叠为 `null`、`false` 或 `undefined`

对应规格测试：`tests/specs/backend-type-module-boundary.spec.ts`。

## 需求：legacy server 必须退化为组装层

`backend/server-main-legacy.ts` 不得重新承载后端路由、WebSocket message handler 和 watcher 生命周期主体；这些逻辑必须留在 `backend/server/*` typed 子模块中，降低后端入口的 review 面。

### 场景：路由、WebSocket 和 watcher 主体迁出 legacy server

- **给定** 后端 legacy server 和 `backend/server/*` 子模块
- **当** 维护者调整后端 route、chat WebSocket、shell WebSocket 或 provider watcher
- **则** `backend/server-main-legacy.ts` 必须保持低体量组装层
- **且** 不得在 legacy server 中直接注册大量 HTTP routes
- **且** 不得在 legacy server 中承载多个 WebSocket message handler
- **且** `app-factory.ts`、`http-routes.ts`、`file-routes.ts`、`chat-websocket.ts`、`shell-websocket.ts`、`provider-watchers.ts` 必须存在并保持 TypeScript checking

对应规格测试：`tests/specs/backend-type-module-boundary.spec.ts`，并生成 `test-results/oz-110-server-legacy-boundary/boundary-snapshot.json`。

## 需求：项目 Provider 读模型必须保持独立 typed 边界

项目列表、会话归属和 Provider 快速发现不得重新由 `backend/projects.ts` 内部的无类型巨型实现承担。

### 场景：Provider session 与 project overview 逻辑位于项目 domain 模块

- **给定** 项目清单和单项目 overview 需要读取 Provider 会话
- **当** 维护者修改项目读模型或 Provider session index
- **则** Provider session index、项目 overview、手动 session route 和项目归档 store 必须位于 `backend/domains/projects/*.ts`
- **且** 新增项目 domain 模块不得使用 TypeScript suppression
- **且** `backend/projects.ts` 不得重新承载 Provider session index 主体实现
- **且** `backend/projects.ts` 体量必须保持在当前边界测试约束内

对应规格测试：`tests/specs/backend-type-module-boundary.spec.ts`。

## 需求：项目域核心必须进入 TypeScript 编译边界

项目列表、会话路由、Provider 会话、搜索、删除和项目重命名依赖的项目域核心实现不得退回手写 JS 与 d.ts 配对；公共 facade 必须保持业务入口稳定。项目域也不得通过 runtime compat、legacy runtime 或改名 implementation 后备绕过 TypeScript focused modules。

### 场景：项目域不再依赖手写 JS 核心

- **给定** 项目域源码、Node TypeScript 配置和服务端构建脚本
- **当** 维护者修改 `backend/domains/projects/` 或 `backend/projects.ts`
- **则** `project-domain-core.js` 与 `project-domain-core.d.ts` 不得重新出现
- **且** `project-domain-core.ts` 必须作为 TypeScript 源码入口存在
- **且** `build:server` 不得复制项目域手写 JS
- **且** Node TypeScript 配置必须继续禁用 `allowJs`
- **且** `project-domain-service.ts` 不得使用会触发构建错误的 `.ts` 扩展导入
- **且** `project-domain-runtime-compat.*` 与 `project-domain-legacy-runtime.*` 不得重新出现
- **且** 项目域 focused modules 不得导入旧 runtime 或 `*-implementation.js` 改名后备

### 场景：公共项目 facade 保持业务入口稳定

- **给定** `backend/projects.ts` 兼容 facade 和项目 domain service
- **当** 项目域核心实现迁移或继续拆分
- **则** `getProjects`、`getSessionMessages`、`createManualSessionDraft`、`finalizeManualSessionRoute`、`renameProject`、`renameSession`、`deleteProject`、`searchChatHistory`、`indexProviderSessionFile` 等入口必须继续可见
- **且** TypeScript ESM 的 `.js` import specifier 只有在没有物理手写 JS core 时才允许存在

对应规格测试：`tests/specs/backend-type-module-boundary.spec.ts`，并生成 `test-results/13-project-domain-ts-boundary/source-audit.json`。

### 场景：迁移 core 保持短兼容层且不承载主要业务入口

- **给定** 项目域已经拆分为 discovery、config、manual route、overview、search、rename、delete 和 Provider read model 模块
- **当** 维护者修改 `backend/domains/projects/project-domain-core.ts`
- **则** `project-domain-core.ts` 不得使用 `@ts-nocheck`、`@ts-ignore` 或 `@ts-expect-error`
- **且** 该文件必须保持短兼容层，不得重新定义 `getProjects`、`getSessionMessages`、`createManualSessionDraft`、`finalizeManualSessionRoute`、`searchChatHistory`、`renameProject`、`deleteProject` 等主体业务入口
- **且** 项目域其他源码不得把巨型迁移实现改名为 `*-implementation.js` 或 legacy runtime 后继续导入

### 场景：focused modules 拥有真实实现而不是薄 re-export

- **给定** 项目发现、手动路由、overview、搜索、删除、Provider transcript/index/list/read model 等 focused modules
- **当** 维护者继续拆分或修复项目域逻辑
- **则** 这些模块不得只从 `project-domain-core.js`、runtime compat 或 legacy runtime 重新导出业务入口
- **且** 不得只把 `...args` 原样透传给换名迁移实现
- **且** 不得用 `export const xxxEntry = true` 哨兵常量代替可审查实现
- **且** 每个模块必须保留本地可审查的函数或 typed 常量实现

对应规格测试：`tests/specs/backend-type-module-boundary.spec.ts`。

## 需求：Codex app-server runtime 必须保持可注入边界

Codex app-server 实时路径不得重新退化为单个巨型 runtime 文件；transport、session manager、notification reducer 和 facade 必须保持独立 typed 模块，方便用 test double 覆盖 steer、streaming 和失败恢复。

### 场景：runtime facade 只组合边界模块

- **给定** Codex app-server runtime 源码
- **当** 维护者修改 stdio transport、session 状态或 notification 映射
- **则** `backend/domains/codex-app-server/stdio-transport.ts`、`session-manager.ts`、`notification-reducer.ts` 和 `runtime-facade.ts` 必须存在
- **且** 这些模块不得使用 TypeScript suppression
- **且** `runtime-facade.ts` 必须导入并组合 transport、session manager 和 notification reducer 边界
- **且** `runtime-facade.ts` 不得重新包含 running session failure 的直接遍历主体
- **且** `runtime-facade.ts` 不得通过空 catch 吞掉 runtime 错误

对应规格测试：`tests/specs/backend-type-module-boundary.spec.ts`，并生成 `test-results/oz-113-codex-app-server-runtime/boundary-snapshot.json`。

## 需求：后端 HTTP 入口和 realtime 投递必须保持契约化边界

`backend/server/http-routes.ts` 和 `backend/server/server-bootstrap.ts` 只负责启动装配、依赖注入和生命周期协调；system update、项目、workflow、session、附件、usage、diagnostics 等业务 HTTP URL 必须由 `backend/server/http/*-routes.ts` 模块注册。Codex/Pi 会话私有 realtime 投递、WebSocket path 分派、公共 project invalidation 和 runtime writer 包装必须由独立 typed 模块承载，避免入口重新退化为路由和广播巨型实现。

## 需求：聊天 WebSocket handler 必须保持 realtime dispatcher 边界

`backend/server/chat-websocket.ts` 负责连接生命周期、注册、消息解析和关闭清理；`codex-command`、`pi-command`、`abort-session`、`subscribe-session`、`check-session-status` 等协议命令分发必须位于 `backend/server/realtime/chat-command-dispatcher.ts`。WebSocket handler 不得直接承载 provider runtime send/abort/status 主体，也不得重新包含 `data.type` 大分支。

### 场景：WebSocket handler 不直接承载命令分支

- **给定** 用户通过 `/ws/chat` 发起 Codex/Pi manual 会话、follow-up、steer、abort 或订阅
- **当** 维护者调整聊天 WebSocket 入口
- **则** `chat-websocket.ts` 必须注册真实 message handler 并调用 `createChatCommandDispatcher`
- **且** `chat-websocket.ts` 不得直接调用 `sendNativeMessage` 或 `abortNativeSession`
- **且** `chat-websocket.ts` 不得包含 `data.type` 命令分支主体
- **且** `chat-command-dispatcher.ts` 必须承载协议命令分发和 runtime command 调用

对应规格测试：`tests/specs/backend-realtime-boundary.spec.ts`，并生成 `test-results/backend-realtime-boundary/source-audit.json`。

### 场景：业务 HTTP route 注册位于 HTTP 边界模块

- **给定** 维护者调整后端 HTTP API
- **当** 项目、workflow、session、附件、usage 或 diagnostics URL 需要注册
- **则** 对应 URL 必须位于 `backend/server/http/*-routes.ts`
- **且** `server-bootstrap.ts` 必须通过 `register*Routes(...)` 装配这些模块
- **且** `/api/system/update` 必须位于 `backend/server/http/system-routes.ts`
- **且** `server-bootstrap.ts` 不得直接注册 Express route
- **且** `http-routes.ts` 不得重新直接拥有大量业务 URL 或 route handler

### 场景：业务 HTTP route 依赖合同必须类型化

- **给定** 项目、workflow、session、附件、usage 和文件访问 route module
- **当** 维护者调整 route 注册函数或依赖注入映射
- **则** 每个业务 route module 必须导出具名 deps interface
- **且** `register*Routes(deps)` 必须使用对应 deps interface，不得使用 `deps: any`
- **且** `backend/server/backend-http-routes.ts` 只能做 route module 编排和最小依赖映射
- **且** 聚合层不得重新承载大量 handler 主体

### 场景：会话私有和公共 realtime 投递位于 realtime 边界模块

- **给定** Provider runtime、chat WebSocket 和 project watcher 需要推送实时事件
- **当** 事件属于会话私有 delta、明确会话订阅、公共 workflow changed 或 project invalidation
- **则** 私有会话匹配必须通过 session subscription registry
- **且** WebSocket path 分派必须位于 `backend/server/websocket-gateway.ts`
- **且** chat/shell handler 和 WebSocket 认证边界必须在 gateway 中显式可审查
- **且** 公共 project invalidation 必须通过独立 bus 保持 debounce/cache clear 语义
- **且** runtime writer 必须经过 adapter 注入归属字段后再投递
- **且** 用户身份不得作为会话私有消息的完整投递边界

对应规格测试：`tests/specs/backend-type-module-boundary.spec.ts`、`tests/specs/codex-ws-turn-ownership.spec.ts`，并生成 `test-results/9-server-entry/source-audit.json`、`test-results/9-server-entry/api-routes.json`、`test-results/9-server-entry/websocket-delivery.log`、`test-results/9-server-entry/project-invalidation.log`、`test-results/9-server-entry/security-runtime.log`、`test-results/9-server-entry/server-startup.log`。
