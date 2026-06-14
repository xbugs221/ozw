# 设计：拆分 Provider 会话列表读模型

## 模块边界

新增：

`backend/domains/projects/provider-session-list-read-model.ts`

建议导出：

```ts
type ProviderSessionListInput = {
  provider: 'codex' | 'pi';
  providerSessions: Array<Record<string, any>>;
  manualDrafts: Array<Record<string, any>>;
  workflowOwnedSessionIds?: Set<string>;
  includeHidden?: boolean;
  excludeWorkflowChildSessions?: boolean;
};

function buildProviderSessionListReadModel(input: ProviderSessionListInput): Array<Record<string, any>>;
```

## 核心规则

1. 手动草稿绑定 `providerSessionId` 后，原始 provider session 不再作为普通手动会话重复出现
2. workflow-owned provider session 在普通手动会话列表中被过滤
3. `includeHidden=false` 时隐藏 `hidden=true` 或 archived 的会话
4. 输出保留前端依赖的 `id`、`routeIndex`、`providerSessionId`、`origin`、`lastActivity`
5. 排序与现有行为一致：最近活动优先

## 迁移策略

先把现有内联数组处理代码挪到新模块，再逐步收紧类型。避免一次性重写 JSONL 解析、配置读写和 UI 状态合并。

## 风险

Codex 和 Pi 的会话字段有细微差异。新模块输入保持 loose record，先锁住业务规则，再做类型收紧。
