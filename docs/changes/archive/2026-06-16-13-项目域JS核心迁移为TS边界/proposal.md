# 提案：项目域 JS 核心迁移为 TS 边界

## 为什么现在做

当前仓库已经通过 `tsconfig.node.json` 禁用了 `allowJs`，但最关键的项目域核心仍是 tracked JS。这个状态会让类型检查和构建发布形成双轨：业务入口看似是 TS，真实实现却绕过了 TS 编译。

## 做什么

- 将 `project-domain-core.js` 中仍被公开 facade 使用的业务函数迁移到 `.ts` 模块。
- 删除 `project-domain-core.d.ts` 手写声明配对，类型从 TS 源码维护。
- 删除 `copy-build-runtime-js.mjs` 对项目域 JS 的复制依赖，服务端构建只依赖 TS 编译产物。
- 保持 `backend/projects.ts` 和 `backend/domains/projects/project-domain-service.ts` 的公共导出稳定。

## 可观察结果

开发者运行 Node 类型检查时，项目列表、会话消息、手动会话、Provider index、重命名等路径都在 TS 检查范围内；发布构建不再需要复制项目域手写 JS。
