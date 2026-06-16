# 设计：移除项目域runtime-compat后备

## 边界

目标边界保持不变：

```text
backend/projects.ts
  -> project-domain-service.ts
      -> project-discovery-read-model.ts
      -> project-config-read-model.ts
      -> manual-session-route-read-model.ts
      -> project-overview-service.ts
      -> project-session-delete-service.ts
      -> chat-history-search-service.ts
      -> provider-session-index-read-model.ts
      -> provider-transcript-read-model.ts
```

`project-domain-runtime-compat.js`、`project-domain-legacy-runtime.js` 或同类旧运行体不再作为任何业务模块的实现来源。若仍需要过渡 facade，只允许 facade 从 typed modules 转出，不能反向依赖旧 JS。

## 迁移策略

1. 先用契约测试列出 compat 文件和导入者，形成 source audit。
2. 按公共入口迁移顺序处理：config、manual route、provider transcript/index、overview、search、rename/delete。
3. 每迁移一组入口，立刻跑对应既有业务测试，避免一次性替换导致行为来源不清。
4. 删除 compat 文件前检查构建产物复制脚本、tsconfig 和 dist entrypoint 测试，防止重新启用 `allowJs` 或复制 runtime JS。

## 取舍

不要求一次性把所有项目域 `any` 清零。重点是消除旧运行体后备，让剩余类型债出现在 TypeScript 源文件中，可被后续提案继续收敛。

## 风险控制

- 对聊天搜索和 provider transcript 使用真实临时 HOME + JSONL 测试。
- 对手动 route 使用真实项目配置读写测试。
- 对 rename/delete 使用既有后端文件状态测试。
