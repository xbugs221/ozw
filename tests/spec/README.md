# 规格测试导读

## 业务场景

`tests/spec` 存放规格派生的验收测试。它们验证需求文档承诺的业务行为，例如会话管理、工作流读模型、测试分类合同和浏览器规格入口，而不是只检查组件是否能挂载。

## 运行命令

```bash
pnpm run test:spec:node
pnpm run test:spec:browser
pnpm run test:spec
```

顶层非 `.spec.ts` 文件由 Node 运行，`*.spec.ts` 由 Playwright 运行。`pnpm run test:spec` 会串联两个入口。

`pnpm run test:spec:node` 直接运行 TypeScript 规格测试，不默认执行 `build:server`。需要验证发布构建产物时，独立运行 `pnpm run build:server`。

## 失败含义

规格测试失败表示实现没有满足已批准的业务合同，审阅者应回到对应 proposal/spec 判断用户风险。常见风险包括会话身份错乱、历史恢复不完整、分类入口退化或浏览器规格流程不可用。

## 新增测试

新增测试应放在这里，当它来自规格验收、需要长期锁定业务合同，或需要同时约束 Node 与浏览器入口边界。只验证后端 API 的测试放入 `tests/backend`；需要完整真实页面链路的测试放入 `tests/e2e`。

## 历史 OpenSpec 验收

本目录仍保留 OpenSpec 派生的验收说明。测试描述业务行为，不依赖实现细节；实现完成后必须全部通过。

## 24-session-management-refactor

- `test_session_management_refactor.js`: 派生自 `openspec/changes/24-session-management-refactor/specs/session-management-refactor/spec.md`，覆盖 ozw 会话身份、并发绑定、pending 恢复、事件重放、历史校准和 steer 干预。

## 27-workflow-session-index-recovery

- `test_project_workflow_control_plane_index_recovery.js`: 派生自 `openspec/changes/27-workflow-session-index-recovery/specs/project-workflow-control-plane/spec.md`，覆盖工作流详情 read model 对索引异常和恢复状态的展示。

## 29-merge-upstream-critical-fixes

- `upstream-critical-fixes.spec.js`: 派生自 `openspec/changes/29-merge-upstream-critical-fixes/specs/upstream-critical-fixes/spec.md`，覆盖安全 frontmatter 解析、Claude CLI 路径传递、SDK permission 语义、二进制下载和 Service Worker 缓存修复。

## 运行

```bash
# 运行全部 Playwright spec 测试
pnpm run test:spec

# 或运行单个变更的验收测试
node --test tests/spec/test_session_management_refactor.js

# 运行 29-merge-upstream-critical-fixes 验收测试
openspec/changes/29-merge-upstream-critical-fixes/test_cmd.sh

# 或分别运行各测试文件
node --test tests/spec/test_project_workflow_control_plane_index_recovery.js
node --test tests/spec/upstream-critical-fixes.spec.js
```

这些测试是验收标准。进入实现阶段后，agent 只能修改实现代码，不能修改这些测试来降低验收标准。
