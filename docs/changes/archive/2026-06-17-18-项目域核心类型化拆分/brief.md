# 18-项目域核心类型化拆分

## 用户问题

仓库需要找出高价值重构点并创建可执行提案。当前最高价值热点是项目域：`backend/domains/projects/project-domain-core.ts` 仍是 5000 行以上的迁移核心，文件顶部保留 `@ts-nocheck`，多个所谓 read model/service 仍只是从 core 重新导出。项目发现、Provider 会话索引、手动 `cN` 路由、搜索、重命名和删除因此共享同一个高风险修改面。

## 交付目标

本提案要求把项目域从迁移核心收敛为 typed、可审查、可测试的真实模块边界，同时保持 `backend/projects.ts` 和 `project-domain-service.ts` 的公共入口稳定。执行完成后，项目清单、单项目 overview、Provider 会话、手动 `cN` 路由、搜索、重命名和删除行为必须保持兼容，并且项目域核心不得继续依赖 TypeScript suppression。

## 非目标

- 不重做前端视觉、导航和聊天渲染样式。
- 不改变 Codex/Pi 原生历史文件格式。
- 不迁移用户真实 provider 历史数据到新数据库。
- 不删除现有历史回归测试；只允许在新意图下同步更新过期断言。
- 不触碰 `node_modules/`、`dist/`、`.wo/`、`.tmp/`、`test-results/` 等 ignored 运行态目录。

## 验收入口

- `pnpm exec tsx --test docs/changes/18-项目域核心类型化拆分/tests/project-domain-boundary.acceptance.test.ts`
- `pnpm exec tsx --test docs/changes/18-项目域核心类型化拆分/tests/project-domain-business.acceptance.test.ts`
- `pnpm exec tsx --test tests/specs/backend-type-module-boundary.spec.ts`
- `pnpm exec tsx --test tests/specs/provider-session-list-read-model.spec.ts`
- `pnpm exec tsx --test tests/specs/session-incremental-read.spec.ts`
- `pnpm run typecheck`

## 执行阶段默认上下文

执行者应先运行本提案 tests/ 下的契约测试。创建阶段预期这些测试会因目标架构尚未实现而失败，失败点应落在 `@ts-nocheck`、core 巨型文件、薄 re-export 边界或真实业务路径退化上，而不是测试语法、路径或环境准备错误。
