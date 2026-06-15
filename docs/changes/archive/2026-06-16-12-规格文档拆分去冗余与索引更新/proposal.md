# 提案：规格文档拆分去冗余与索引更新

## 背景

仓库已经把长期需求沉淀到 `docs/specs/`，但一些规格文件承载了多轮历史提案的全部内容。规格文档过长会导致两个问题：执行者读不完当前事实，测试维护者也难以判断应更新哪个入口。

## 变更内容

新增文档治理结构：

```
docs/specs/index.md
docs/specs/repo-simplification.md
docs/specs/typescript-tooling.md
docs/specs/runtime-dependencies.md
docs/specs/provider-indexing.md
docs/specs/chat-performance.md
docs/specs/workflow-compatibility.md
docs/specs/pi-session-controls.md
docs/specs/pi-session-recovery.md
docs/specs/pi-tool-card-rendering.md
```

拆分 `dependencies-and-tooling.md` 和 `pi-session-input-icon-model-toolcards.md`，同时更新 README 与测试分类说明。

## 成功标准

- `docs/specs/index.md` 能按领域列出规格、测试入口和 owner 模块。
- 单篇 active spec 控制在可审查长度内，超长主题被拆分。
- 每个拆出的规格都保留对应 `### 需求`、场景、测试文件和入口路径。
- 过期 `co/Codex SDK/native-sdk` 表述不再进入活跃当前口径文档。
- 相关测试引用不再指向旧长文档作为唯一事实来源。
