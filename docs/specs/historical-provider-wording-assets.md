# 规格：历史口径文档与测试资产收敛

## 需求：活跃文档必须使用当前 Provider 口径

活跃文档和生产源码必须描述当前 Provider 运行边界：Codex 主路径是 app-server，Pi 主路径是 native SDK，通用描述使用 provider runtime。历史 archive 可以保留当时事实，但不能作为新文档的当前口径来源。

### 场景：活跃文档和生产源码不传播退役口径

- **给定** 开发者搜索 `backend/`、`frontend/`、`docs/specs/` 和 `package.json`
- **当** 他检查 Codex、Pi 和手动消息路径描述
- **则** Codex 当前路径不得被描述成已退役的 SDK/thread 直连模式
- **且** 手动消息当前路径不得被描述成已退役的 co 文件协议模式
- **测试文件**：`tests/specs/historical-provider-wording-assets.spec.ts`
- **真实数据来源**：真实源码、活跃规格文档和 package scripts
- **剩余风险**：`docs/changes/archive/` 保留历史事实，不做机械替换

## 需求：测试资产命名必须反映当前行为

测试文件名、文件头 PURPOSE 和测试标题必须让维护者看出真实运行路径。覆盖 Codex app-server 的测试不得继续使用会误导为 native SDK 的命名；覆盖 Pi native SDK 的测试可以保留 SDK 口径。

### 场景：Codex app-server 测试不使用误导性 native-sdk 命名

- **给定** 测试源码覆盖 Codex app-server 行为
- **当** 维护者查看测试文件名和文件头 PURPOSE
- **则** 文件名和 PURPOSE 必须使用 app-server 或 provider runtime 口径
- **且** 否定断言中的旧依赖字符串必须有明确的否定语义
- **测试文件**：`tests/specs/historical-provider-wording-assets.spec.ts`
- **真实数据来源**：真实 `tests/` 源码
- **剩余风险**：第三方包名或历史归档按原文保留

## 需求：manual/browser-history 资产必须有处置清单

`tests/manual/browser-history` 中的历史 browser 资产必须被迁移、保留并说明原因、删除或标记待确认。当前默认门禁不得声称已经覆盖这些 manual 历史资产。

### 场景：manual/browser-history 文件有明确处置状态

- **给定** `tests/manual/browser-history` 中存在历史 browser spec
- **当** 运行历史资产规格测试
- **则** 每个当前文件必须出现在 `docs/testing/manual-history-inventory.md`
- **且** 每个文件必须有迁移、保留、删除或待确认状态
- **且** `tests/README.md` 必须说明 manual/browser-history 不作为默认门禁
- **测试文件**：`tests/specs/historical-provider-wording-assets.spec.ts`
- **真实数据来源**：真实测试目录、README 和 inventory 文档
- **剩余风险**：价值不明资产需要用户确认后再删除
