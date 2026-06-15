# 规格：项目域 JS 核心迁移为 TS 边界

## 验收矩阵

| 场景 | required_tests | required_evidence |
| --- | --- | --- |
| 项目域不再依赖手写 JS 核心 | project-domain-ts-boundary | project-domain-source-audit |
| 公共项目 facade 保持业务入口稳定 | project-domain-ts-boundary, existing-project-regressions | project-domain-source-audit |

### 需求：项目域实现必须纳入 TypeScript 编译

#### 场景：项目域不再依赖手写 JS 核心

- 对应测试：`docs/changes/13-项目域JS核心迁移为TS边界/tests/project-domain-ts-boundary.contract.test.ts`
- 真实数据来源：仓库真实源码、`package.json` build script、`tsconfig.node.json`
- 入口路径：`backend/domains/projects/`、`backend/projects.ts`
- 关键断言：不存在 `project-domain-core.js` 与 `project-domain-core.d.ts` 配对；`build:server` 不再调用 `copy-build-runtime-js.mjs`；Node tsconfig 继续禁用 `allowJs`
- 剩余风险：该静态契约不能证明所有历史配置迁移样例，需要配合后端回归测试

### 需求：公共项目 facade 保持业务入口稳定

#### 场景：公共项目 facade 保持业务入口稳定

- 对应测试：`docs/changes/13-项目域JS核心迁移为TS边界/tests/project-domain-ts-boundary.contract.test.ts`、`tests/backend/projects.rename.test.ts`、`tests/backend/pi-sessions-read-model.test.ts`
- 真实数据来源：生产 facade 源码和既有后端业务测试夹具
- 入口路径：`backend/projects.ts`、`backend/domains/projects/project-domain-service.ts`
- 关键断言：`getProjects`、`getSessionMessages`、`createManualSessionDraft`、`renameProject`、`searchChatHistory` 等入口仍由公共 facade 导出；facade 不反向导出 `.js` 核心
- 剩余风险：Provider 用户真实 home 目录数据规模差异需要在执行阶段补充性能采样
