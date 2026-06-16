# 规格：移除项目域runtime-compat后备

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence | 真实数据来源 | 入口路径 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| runtime compat 必须删除 | 源码不存在 compat/legacy runtime 文件和导入者 | `contract-runtime-compat-removal` | `runtime-compat-source-audit` | tracked 源码 | `backend/domains/projects` | 旧运行体 `.js/.d.ts` 不存在，focused modules 不导入旧运行体 | source audit 不能证明所有业务行为兼容 |
| 公共 facade 必须稳定 | 项目域公共入口继续可导入 | `contract-runtime-compat-removal`, `existing-backend-boundary` | `runtime-compat-source-audit` | tracked 源码 | `backend/projects.ts`, `project-domain-service.ts` | 核心入口仍出现在 facade 中 | 未覆盖所有外部包消费者 |
| 真实业务行为必须不退化 | Provider session、manual route、搜索和删除回归通过 | `existing-project-domain-business`, `existing-provider-session-list`, `root-typecheck` | `project-domain-regression-log` | 临时 HOME、真实项目配置、真实 JSONL | 项目域 service exports | 业务测试通过，typecheck 通过 | 浏览器完整 e2e 不在最小验收内 |

### 需求：runtime compat 必须删除

#### 场景：源码不存在 compat/legacy runtime 文件和导入者

执行完成后，`backend/domains/projects/project-domain-runtime-compat.*`、`backend/domains/projects/project-domain-legacy-runtime.*` 不得存在。`backend/domains/projects/*.ts` 也不得从旧运行体导入任何业务入口。

对应测试：`docs/changes/19-移除项目域runtime-compat后备/tests/project-domain-runtime-compat-removal.acceptance.test.ts`。

### 需求：公共 facade 必须稳定

#### 场景：项目域公共入口继续可导入

`backend/projects.ts` 继续作为 public facade，`project-domain-service.ts` 继续暴露项目清单、session messages、manual route、search、rename/delete 和 provider index 入口。

对应测试：`docs/changes/19-移除项目域runtime-compat后备/tests/project-domain-runtime-compat-removal.acceptance.test.ts` 和 `tests/specs/backend-type-module-boundary.spec.ts`。

### 需求：真实业务行为必须不退化

#### 场景：Provider session、manual route、搜索和删除回归通过

删除 runtime compat 后，18 号项目域业务测试、Provider session list 回归、backend boundary 和 typecheck 必须通过。失败不能通过重新添加 compat、启用 `allowJs` 或扩大 public `any` 来规避。

对应测试：`docs/changes/18-项目域核心类型化拆分/tests/project-domain-business.acceptance.test.ts`、`tests/specs/provider-session-list-read-model.spec.ts`、`pnpm run typecheck`。
