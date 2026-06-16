# 19-移除项目域runtime-compat后备

## 用户问题

项目域 18 号拆分已经把 `project-domain-core.ts` 压成短 shim，但实际运行仍可能依赖 `project-domain-runtime-compat.js`、`project-domain-legacy-runtime.js` 这类旧运行体和配套 `.d.ts`。这会让项目清单、Provider 会话、手动 `cN` route、搜索、重命名和删除表面上进入 typed modules，底层却仍可绕过 TypeScript 检查。

## 交付目标

删除项目域 runtime compat/legacy 后备，把剩余公共入口迁入真实 TypeScript focused modules。执行完成后，项目域公共 facade 仍稳定，但源码中不得存在 `project-domain-runtime-compat.*`、`project-domain-legacy-runtime.*`，也不得有 focused module 从旧运行体导入业务实现。

## 非目标

- 不改变 `backend/projects.ts` 的公共导出入口。
- 不改 Codex/Pi 原生历史文件格式。
- 不删除用户真实项目配置或 provider 历史数据。
- 不重做前端页面展示。

## 验收入口

- `pnpm exec tsx --test docs/changes/19-移除项目域runtime-compat后备/tests/project-domain-runtime-compat-removal.acceptance.test.ts`
- `pnpm exec tsx --test docs/changes/18-项目域核心类型化拆分/tests/project-domain-business.acceptance.test.ts`
- `pnpm exec tsx --test tests/specs/backend-type-module-boundary.spec.ts`
- `pnpm exec tsx --test tests/specs/provider-session-list-read-model.spec.ts`
- `pnpm run typecheck`

## 执行阶段默认上下文

先运行本提案 tests/ 下的契约测试。创建阶段预期失败点应落在 compat/legacy runtime 文件仍存在、focused modules 仍导入旧运行体或 `project-domain-core.ts` 仍转出旧运行体，而不是测试语法或环境准备错误。
