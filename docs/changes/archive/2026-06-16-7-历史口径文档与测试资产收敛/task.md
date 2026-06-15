# 任务：历史口径文档与测试资产收敛

## 先跑契约测试

- [x] 1. 运行 `pnpm exec tsx --test docs/changes/7-历史口径文档与测试资产收敛/tests/legacy-wording-assets.contract.test.ts`
- [x] 2. 记录旧口径命中位置并按允许/不允许分类
- [x] 3. 记录误导性测试文件名和标题
- [x] 4. 生成 manual/browser-history 资产清单
- [x] 5. 确认 archive 目录不作为机械替换目标

## Provider 口径清理

- [x] 6. 搜索 active docs 中的 `Codex SDK`
- [x] 7. 搜索 active docs 中的 `Thread.runStreamed`
- [x] 8. 搜索 active docs 中的 `co file protocol`
- [x] 9. 搜索生产源码中的旧 provider 口径
- [x] 10. 将 Codex 当前路径统一为 `Codex app-server`
- [x] 11. 将 Pi 当前路径统一为 `Pi native SDK`
- [x] 12. 将通用路径统一为 `provider runtime`
- [x] 13. 保留否定断言中的旧字符串并加注释
- [x] 14. 更新 `docs/specs/dependencies-and-tooling.md`
- [x] 15. 更新相关 debug/README 中仍作为当前事实的旧描述

## 测试文件命名和标题

- [x] 16. 重命名误导性的 `native-sdk-*` Codex 测试文件
- [x] 17. 更新对应 import、README、package 脚本引用
- [x] 18. 更新测试文件头 PURPOSE
- [x] 19. 更新 test 标题中的旧 `SDK` 说法
- [x] 20. 更新 assertion message 中误导性旧说法
- [x] 21. 保留“旧依赖必须不存在”断言并明确其否定语义
- [x] 22. 将 app-server 相关测试集中到一致命名
- [x] 23. 将 Pi SDK 相关测试保留 SDK 口径
- [x] 24. 更新 evidence 文件名和目录名
- [x] 25. 运行 `rg` 确认命名边界

## manual/browser-history 资产

- [x] 26. 为 `tests/manual/browser-history` 生成 inventory
- [x] 27. 标记每个文件的当前价值：迁移、保留、删除、待确认
- [x] 28. 将仍覆盖当前真实行为的测试迁移到 `tests/spec` 或 `tests/e2e`
- [x] 29. 将只覆盖旧 co/Claude 路径的测试删除
- [x] 30. 对短期保留的 manual 测试写明不进默认门禁原因
- [x] 31. 更新 `tests/manual/README.md` 或新增说明
- [x] 32. 确认迁移后测试仍使用真实页面/API/数据库
- [x] 33. 确认迁移后不依赖旧 co 数据
- [x] 34. 运行迁移后的 browser spec
- [x] 35. 保存 inventory 到 `docs/testing/manual-history-inventory.md`

## 文档和脚本

- [x] 36. 更新 `tests/README.md`
- [x] 37. 更新 `tests/spec/README.md`
- [x] 38. 更新 `tests/e2e/README.md`
- [x] 39. 明确 `test:spec:node`、`test:spec:browser`、`test:e2e` 分工
- [x] 40. 明确 ignored evidence 目录不进入 git
- [x] 41. 检查 package scripts 是否还引用旧命名文件
- [x] 42. 更新 docs/changes README 的执行约定（如需要）
- [x] 43. 添加 legacy wording boundary 测试到合适回归集合

## 回归与收尾

- [x] 44. 运行 `pnpm run typecheck`
- [x] 45. 运行 `pnpm run test:spec`
- [x] 46. 运行 `pnpm run test:e2e:smoke`
- [x] 47. 运行旧口径边界契约测试
- [x] 48. 保存 legacy wording audit evidence
- [x] 49. 保存 manual/browser-history inventory evidence
- [x] 50. 确认 active docs、源码、测试标题搜索结果只剩允许项
