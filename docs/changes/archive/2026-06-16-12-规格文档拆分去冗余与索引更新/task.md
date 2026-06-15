# 任务：规格文档拆分去冗余与索引更新

## 先跑契约测试

- [x] 1. 运行 `pnpm exec tsx --test docs/changes/12-规格文档拆分去冗余与索引更新/tests/spec-docs-boundary.contract.test.ts`
- [x] 2. 确认失败来自索引缺失、文档过长或拆分目标缺失
- [x] 3. 运行 `pnpm exec tsx --test tests/spec/test_suite_taxonomy.ts`
- [x] 4. 运行 `pnpm exec tsx --test tests/specs/historical-provider-wording-assets.spec.ts`
- [x] 5. 统计 `docs/specs/*.md` 行数和标题数
- [x] 6. 生成拆分映射草稿，不先删除原文

## 建立索引

- [x] 7. 新建 `docs/specs/index.md`
- [x] 8. 在 index 中列出项目/会话规格
- [x] 9. 在 index 中列出 provider/runtime 规格
- [x] 10. 在 index 中列出 workflow 规格
- [x] 11. 在 index 中列出 chat 规格
- [x] 12. 在 index 中列出测试/工具/安全规格
- [x] 13. 为每项列出入口测试命令
- [x] 14. 为每项列出主要源码 owner

## 拆 dependencies-and-tooling

- [x] 15. 新建 `repo-simplification.md`
- [x] 16. 新建 `typescript-tooling.md`
- [x] 17. 新建 `runtime-dependencies.md`
- [x] 18. 新建 `provider-indexing.md`
- [x] 19. 新建 `chat-performance.md`
- [x] 20. 新建 `workflow-compatibility.md`
- [x] 21. 迁移对应需求和场景
- [x] 22. 将原长文档收敛为索引或删除重复内容

## 拆 Pi 规格

- [x] 23. 新建 `pi-session-controls.md`
- [x] 24. 新建 `pi-session-recovery.md`
- [x] 25. 新建 `pi-tool-card-rendering.md`
- [x] 26. 迁移模型/深度控件场景
- [x] 27. 迁移刷新恢复和 snapshot bridge 场景
- [x] 28. 迁移工具卡片渲染场景

## 去冗余和旧口径

- [x] 29. 删除重复验收矩阵
- [x] 30. 合并同义场景
- [x] 31. 将历史兼容说明移动到明确 history/compat 文档
- [x] 32. 清理 active docs 中过期 Codex SDK/native-sdk 表述
- [x] 33. 保留必要 legacy 例外列表
- [x] 34. 确保每个场景仍有测试入口

## 同步测试与 README

- [x] 35. 核对 `tests/README.md` 已覆盖当前分类入口，无需改动
- [x] 36. 核对 `docs/changes/README.md` 已覆盖 active proposals、`docs/specs` 和 `tests/`
- [x] 37. 核对 `tests/spec/test_suite_taxonomy.ts` 已验证当前 README guidance
- [x] 38. 核对相关测试文件顶部说明未因本次文档拆分失效
- [x] 39. 核对 README 中开发/测试说明仍指向当前入口
- [x] 40. 检查所有被 index 引用的测试路径存在

## 收尾验证

- [x] 41. 运行本提案 required tests
- [x] 42. 运行 `pnpm exec tsx --test tests/spec/test_suite_taxonomy.ts`

- [x] 43. 运行历史 provider 口径测试
- [x] 44. 生成 acceptance 要求的 6 个 evidence JSON 到 `test-results/12-spec-docs/`
