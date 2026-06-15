# 规格：规格文档拆分去冗余与索引更新

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence | 真实数据来源 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- |
| 规格索引可用 | index 列出领域、入口测试和 owner | spec-docs-boundary | specs-index-audit | 真实 docs/specs | index 存在并覆盖关键领域 | owner 精度需人工审查 |
| 超长规格拆分 | active spec 单篇长度有上限 | spec-docs-boundary | specs-linecount-report | 真实 markdown 文件 | 长文档被拆，单篇可审查 | 部分复杂规格仍可能接近上限 |
| 依赖工具文档拆分 | dependencies-and-tooling 不再混杂多主题 | spec-docs-boundary | dependencies-split-map | 原长文档 | 拆出 repo、TS、runtime、provider、chat、workflow 文档 | 旧需求迁移需人工核对 |
| Pi 输入规格拆分 | 控件、恢复和工具卡片分离 | spec-docs-boundary | pi-spec-split-map | 原 Pi 规格 | 拆出 controls/recovery/toolcards | Pi UI 细节后续仍可能变长 |
| 旧术语边界清晰 | 活跃当前口径不再混用旧称呼 | historical-provider-wording-assets、spec-docs-boundary | legacy-wording-report | 长期 provider 旧词回归测试 | 当前 docs 不把 Codex 描述成 SDK 主路径 | 历史兼容说明需例外列表 |
| 测试入口同步 | README/taxonomy/spec 引用一致 | test-suite-taxonomy、spec-docs-boundary | docs-test-entry-report | 真实 tests/README 与 taxonomy | 文档指向真实命令和测试文件 | 新增测试后需维护 |

### 需求：规格索引可用

#### 场景：index 列出领域、入口测试和 owner

- **给定** 新维护者打开 `docs/specs/index.md`
- **当** 查找项目、provider、workflow、chat、runtime、test、security 文档
- **则** index 必须列出对应规格文件、入口测试和主要源码 owner
- **对应测试**：`docs/changes/12-规格文档拆分去冗余与索引更新/tests/spec-docs-boundary.contract.test.ts`
- **入口路径**：`pnpm exec tsx --test docs/changes/12-规格文档拆分去冗余与索引更新/tests/spec-docs-boundary.contract.test.ts`
- **关键断言**：index 存在且包含关键领域、测试入口和源码路径
- **剩余风险**：owner 精度仍需人工审查

### 需求：超长规格拆分

#### 场景：active spec 单篇长度有上限

- **给定** 开发者审查 `docs/specs/*.md`
- **当** 文档清理完成
- **则** active spec 单篇长度应控制在 450 行以内
- **且** 超过阈值的主题必须拆分或降级为索引/历史说明
- **对应测试**：`docs/changes/12-规格文档拆分去冗余与索引更新/tests/spec-docs-boundary.contract.test.ts`
- **入口路径**：同上
- **关键断言**：没有 active spec 超过长度上限
- **剩余风险**：个别复杂规格接近上限时仍需后续维护

### 需求：依赖工具文档拆分

#### 场景：dependencies-and-tooling 不再混杂多主题

- **给定** `dependencies-and-tooling.md` 当前包含多个领域
- **当** 拆分完成
- **则** repo 精简、TypeScript、runtime dependencies、provider indexing、chat performance 和 workflow compatibility 分别进入独立文档
- **对应测试**：`docs/changes/12-规格文档拆分去冗余与索引更新/tests/spec-docs-boundary.contract.test.ts`
- **入口路径**：同上
- **关键断言**：拆分目标文件存在，原文件不再是多个业务域的唯一来源
- **剩余风险**：旧需求迁移完整性需人工 diff 核对

### 需求：Pi 输入规格拆分

#### 场景：控件、恢复和工具卡片分离

- **给定** `pi-session-input-icon-model-toolcards.md` 同时包含控件、刷新恢复和工具卡片
- **当** 文档清理完成
- **则** Pi session controls、session recovery 和 tool card rendering 分别有独立规格
- **对应测试**：`docs/changes/12-规格文档拆分去冗余与索引更新/tests/spec-docs-boundary.contract.test.ts`
- **入口路径**：同上
- **关键断言**：三个拆分文档存在并包含对应需求标题
- **剩余风险**：Pi UI 细节后续可能继续增长

### 需求：旧术语边界清晰

#### 场景：活跃当前口径不再混用旧称呼

- **给定** Codex 当前主路径是 app-server，Pi 当前主路径是 native SDK
- **当** 文档清理完成
- **则** active docs 不得把 Codex 主路径描述为旧 SDK Thread/runStreamed 或 native-sdk
- **且** 历史兼容说明必须位于明确 legacy/history 文档或例外列表
- **对应测试**：`tests/specs/historical-provider-wording-assets.spec.ts`、`docs/changes/12-规格文档拆分去冗余与索引更新/tests/spec-docs-boundary.contract.test.ts`
- **入口路径**：`pnpm exec tsx --test tests/specs/historical-provider-wording-assets.spec.ts`
- **关键断言**：当前 docs 不继续传播旧主路径口径
- **剩余风险**：历史兼容文档需要保留清晰例外

### 需求：测试入口同步

#### 场景：README/taxonomy/spec 引用一致

- **给定** 用户按 README 或 specs 运行测试
- **当** 文档拆分完成
- **则** `tests/README.md`、`docs/specs/index.md` 和 `tests/spec/test_suite_taxonomy.ts` 指向的命令和路径必须存在
- **对应测试**：`tests/spec/test_suite_taxonomy.ts`、`docs/changes/12-规格文档拆分去冗余与索引更新/tests/spec-docs-boundary.contract.test.ts`
- **入口路径**：`pnpm exec tsx --test tests/spec/test_suite_taxonomy.ts`
- **关键断言**：测试分类说明和规格索引一致，不指向不存在的旧入口
- **剩余风险**：新增测试后仍需维护索引
