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
