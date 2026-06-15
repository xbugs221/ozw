# 依赖与工具规格

本文档保留为依赖、工具链、runtime、provider、workflow 和聊天性能规格的索引入口，详细需求已按领域拆分，避免单篇文档继续承载多主题。

## 拆分后的规格

- [仓库精简与历史残余清理](./repo-simplification.md)
- [TypeScript 工具链与测试入口](./typescript-tooling.md)
- [Runtime 依赖诊断与手动会话运行](./runtime-dependencies.md)
- [Provider 索引与会话来源](./provider-indexing.md)
- [Workflow 状态读取与阶段兼容](./workflow-compatibility.md)
- [聊天性能、虚拟列表与项目刷新](./chat-performance.md)

## 需求：依赖与工具规格必须保持可追踪

### 场景：审阅者从索引进入领域规格

- Given 审阅者打开 `docs/specs/dependencies-and-tooling.md`
- When 需要查找原依赖与工具相关需求
- Then 文档应指向拆分后的领域规格、测试入口和源码 owner

## 测试入口

- `pnpm exec tsx --test docs/changes/12-规格文档拆分去冗余与索引更新/tests/spec-docs-boundary.contract.test.ts`
- `pnpm exec tsx --test tests/spec/test_suite_taxonomy.ts`
