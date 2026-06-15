# 简报：历史口径文档与测试资产收敛

## 用户问题

仓库仍残留 `co`、`Codex SDK`、泛化 `native SDK` 等历史口径，以及一些 manual/browser-history 测试资产。它们不一定都错，但如果没有边界说明，会误导后续维护者把旧路径当成当前设计。

## 交付目标

清理当前源码、规格、测试标题和 README 中的过期口径；筛选旧测试资产，把仍有价值的迁移到当前 spec/e2e 结构，把无价值的删除或归档说明。

## 非目标

- 不重写 archived change 的事实记录
- 不删除真实仍被执行且有价值的回归测试
- 不把历史日志里的旧词全部机械替换
- 不调整业务功能

## 验收入口

- 契约测试：`pnpm exec tsx --test docs/changes/7-历史口径文档与测试资产收敛/tests/legacy-wording-assets.contract.test.ts`
- 回归测试：`pnpm run test:spec && pnpm run test:e2e:smoke`

## 执行默认上下文

以“当前活跃入口不误导”为原则。archive 可以保留历史事实，但 active docs、package scripts、测试标题、源码注释必须使用当前 Codex app-server / Pi native SDK / provider runtime 口径。
