# 简报：规格文档拆分去冗余与索引更新

## 用户问题

当前部分规格文档过长且主题混杂，尤其 `docs/specs/dependencies-and-tooling.md` 已超过两千行，包含依赖清理、TypeScript、测试分类、workflow、provider、聊天性能等多个主题。维护者很难快速判断哪个文档是当前事实，测试入口也容易和文档不同步。

## 交付目标

拆分超长规格，建立规格索引和拆分映射，去除重复矩阵与过期术语，并让测试入口、README 和 `tests/spec/test_suite_taxonomy.ts` 同步反映当前文档结构。

## 非目标

不改生产逻辑，不弱化已有规格要求，不删除仍有业务价值的历史兼容说明，不把运行证据写入 git。

## 验收入口

- `pnpm exec tsx --test docs/changes/12-规格文档拆分去冗余与索引更新/tests/spec-docs-boundary.contract.test.ts`
- `pnpm exec tsx --test tests/spec/test_suite_taxonomy.ts tests/specs/backend-type-module-boundary.spec.ts`
- `pnpm exec tsx --test tests/specs/historical-provider-wording-assets.spec.ts`

## 执行默认上下文

先读取 `docs/specs/`、`docs/specs/historical-provider-wording-assets.md`、`docs/changes/README.md`、`tests/README.md`、`tests/spec/test_suite_taxonomy.ts` 和现有测试 `tests/specs/historical-provider-wording-assets.spec.ts`。执行阶段先做文档审计，再拆分和同步测试，不要直接删除规格内容。
