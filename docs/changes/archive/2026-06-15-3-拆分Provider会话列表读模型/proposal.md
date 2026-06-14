# 提案：拆分 Provider 会话列表读模型

## 背景

`backend/projects.ts` 已经承担项目发现、配置读写、provider 会话读取、手动会话路由、workflow 合并、归档和删除等职责。仓库已经开始拆出 `project-overview-read-model.ts`、`provider-session-read-model.ts`、`session-route-store.ts`，但项目首页会话列表的核心组装逻辑仍在巨型模块内。

## 变更内容

新增 `backend/domains/projects/provider-session-list-read-model.ts`，负责：

- 合并 provider JSONL 会话和手动 cN 草稿
- 隐藏绑定到手动草稿的 provider 原始 session
- 根据 workflow-owned session ids 过滤工作流子会话
- 保留 routeIndex、providerSessionId、origin 等业务字段
- 按现有最近活动规则排序

`backend/projects.ts` 保留 I/O 和依赖注入，只把数组交给新 read model 处理。

## 为什么现在做

最近 CI 修复涉及 Codex 首页轻量摘要、手动路由标题和 workflow 子会话过滤，这些都集中在同一块复杂逻辑。拆出纯 read model 后，后续变更可以先用小测试锁住业务规则。
