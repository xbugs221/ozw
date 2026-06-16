# 任务：移除项目域runtime-compat后备

## 0. 契约基线

- [x] 1. 运行 `pnpm exec tsx --test docs/changes/19-移除项目域runtime-compat后备/tests/project-domain-runtime-compat-removal.acceptance.test.ts`，确认初始失败来自 compat/legacy runtime 后备仍存在。
- [x] 2. 记录 `test-results/19-project-domain-runtime-compat/source-audit.json`。
- [x] 3. 运行 `pnpm exec tsx --test docs/changes/18-项目域核心类型化拆分/tests/project-domain-business.acceptance.test.ts`，确认既有业务回归当前可作为迁移保护。

## 1. 入口盘点

- [x] 4. 列出旧运行体 `.d.ts` 中所有公共导出。
- [x] 5. 标注每个导出应归属的 focused module。
- [x] 6. 找出仍从 compat 导入的项目域模块。
- [x] 7. 明确 `project-domain-core.ts` 是否删除或仅保留 typed facade。

## 2. 分组迁移

- [x] 8. 迁移项目配置和 route path 相关入口。
- [x] 9. 迁移 manual session route 相关入口。
- [x] 10. 迁移 provider transcript/index 相关入口。
- [x] 11. 迁移 overview、search、rename、delete 相关入口。
- [x] 12. 删除 compat/legacy runtime `.js/.d.ts` 文件。

## 3. 回归

- [x] 13. 运行本提案契约测试。
- [x] 14. 运行 18 号项目域业务测试。
- [x] 15. 运行 `pnpm exec tsx --test tests/specs/provider-session-list-read-model.spec.ts`。
- [x] 16. 运行 `pnpm exec tsx --test tests/specs/backend-type-module-boundary.spec.ts`。
- [x] 17. 运行 `pnpm run typecheck`。
- [x] 18. 更新必要的 docs/specs 长期规格。
