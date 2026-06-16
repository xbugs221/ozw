# 设计：项目域核心类型化拆分

## 模块边界

保留 `backend/projects.ts` 作为兼容 facade，保留 `project-domain-service.ts` 作为项目域公共服务出口。真实实现应落在项目域子模块中，而不是继续堆到 `project-domain-core.ts`。

建议目标边界：

- `project-config-read-model.ts`：项目配置 schema、legacy key 读取、保存归一化、model/ui state。
- `project-discovery-read-model.ts`：项目发现、手动项目、Provider-only 项目候选、轻量项目摘要。
- `manual-session-route-read-model.ts`：`cN` draft、route counter、start lock、provider binding、finalize 和 runtime 查询。
- `provider-transcript-read-model.ts`：Codex/Pi JSONL 首行、tail window、afterLine 增量读取和 message mapping。
- `provider-session-index-read-model.ts`：Codex/Pi 会话索引缓存、按项目归属、最近会话收敛。
- `project-overview-service.ts`：单项目 overview 聚合，调用 provider/session/workflow 子模块。
- `chat-history-search-service.ts`：聊天搜索入口，只在搜索路径深读 transcript。
- `project-session-delete-service.ts`：删除 session、删除空项目、归档索引清理。
- `project-rename-service.ts`：项目展示名、会话 summary 和 provider transcript rename 协调。

## 类型策略

先为跨模块共享对象定义窄类型：项目摘要、provider session header、manual route record、project config、search result 和 transcript message。对 provider 原生事件保留 `unknown` 输入，在边界函数内解析为 typed shape。禁止把 `Record<string, any>` 作为新模块的主要公共类型。

`project-domain-core.ts` 可以在迁移中短期保留，但必须无 suppression、体量受控，并且不得继续定义主要业务入口。最终可以退化为兼容 shim 或删除。

## 性能策略

项目清单路径只做轻量发现和 bounded Provider-only 候选合并。Provider transcript 深读、聊天全文搜索、删除前校验和单项目详情聚合必须在独立入口执行。并发读取使用业务 scope 合并，失败不缓存，避免多窗口或多请求把项目索引重复构建。

## 迁移顺序

1. 用当前契约测试记录失败基线。
2. 先抽离纯函数和 config schema，减少 `any` 扩散。
3. 抽离 manual route，保持已有 `cN` 行为测试通过。
4. 抽离 Provider transcript/index，保持 Codex/Pi 增量读取和 session list 测试通过。
5. 抽离 search、rename、delete，保持公共 facade 导出不变。
6. 清理 core re-export、suppression 和迁移哨兵。
7. 运行 typecheck、后端 smoke、规格测试和必要 evidence。

## 风险

- Provider 历史样例很多，过度收紧类型可能误删兼容字段；输入层必须用 parser 收敛，不要在调用方猜 shape。
- 手动 `cN` route 同时服务浏览器路由和 provider session id，拆分时容易把可见 route 和底层 session 混淆。
- 搜索和删除会深读 transcript，不能被项目清单或 overview 默认路径意外调用。
- 如果只按文件名拆分、不收敛公共类型和 source ownership，维护风险不会降低，所以 source audit 是必需验收项。
