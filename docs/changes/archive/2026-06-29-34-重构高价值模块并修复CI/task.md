# 任务：重构高价值模块并修复 CI

## 1. 先运行创建阶段契约测试

- [x] `pnpm exec tsx --test docs/changes/34-重构高价值模块并修复CI/tests/high-value-module-boundary.acceptance.test.ts`
- [x] `pnpm exec tsx --test docs/changes/34-重构高价值模块并修复CI/tests/ci-quality-gate.acceptance.test.ts`
- [x] `pnpm exec tsx --test docs/changes/34-重构高价值模块并修复CI/tests/docs-tests-sync.acceptance.test.ts`
- [x] 确认初始失败原因是目标重构、CI 合同或文档同步尚未完成，而不是测试语法和路径错误。

## 2. 记录 CI 失败事实

- [x] 运行 `gh run view 28289064798 --json status,conclusion,workflowName,headBranch,event,url,jobs`
- [x] 将失败 run 元数据写入 `test-results/github-ci/latest-failure.json`
- [x] 明确记录失败步骤为 `Node spec tests`
- [x] 本地运行 `pnpm run test:spec:node`，确认当前本地结果和远端失败的关系

## 3. 重构高价值模块

- [x] 拆出聊天搜索定位 focused module
- [x] 拆出聊天状态校准 focused module
- [x] 拆出消息面板布局/测量 focused module
- [x] 拆出项目刷新 focused module
- [x] 拆出项目状态 reducer focused module
- [x] 三个入口文件降到合同预算内

## 4. 修复测试和文档

- [x] 新增或更新 `docs/specs/high-value-module-refactor.md`
- [x] 更新 `docs/specs/index.md`
- [x] 新增默认规格测试 `tests/specs/high-value-module-refactor.spec.ts`
- [x] 新增默认 CI 合同测试 `tests/spec/ci-quality-gate-contract.ts`
- [x] 如旧测试与新边界冲突，按本提案意图更新旧测试

## 5. 修复 GitHub CI/CD

- [x] 新增或校准 `pnpm run test:ci`
- [x] 让 `.github/workflows/ci.yml` 使用或镜像 `test:ci`
- [x] 保留 `Node spec tests`，不得跳过
- [x] 运行本地 `pnpm run test:ci`
- [x] 推送后记录新的 GitHub CI 通过 run 到 `test-results/github-ci/after-fix-run.json`

## 6. 最终验收

- [x] 三个 change contract 测试通过
- [x] 默认新增测试通过
- [x] `pnpm run typecheck` 通过
- [x] `pnpm run test:ci` 通过
- [x] GitHub `CI / node-checks` 通过

## 历史测试更新说明

- `tests/unit/chat-runtime-controllers.test.ts` 的冻结尾部预期改为当前规格：有 `message-position-3` 锚点时窗口截止到该锚点。
- `tests/unit/chat-message-dedup.test.ts` 的 live tool result 预期改为当前合并策略：同 `toolCallId` 的 JSONL shell 会被 live result 覆盖，不再保留第二张重复工具卡。
- 本地已生成 `test-results/github-ci/after-fix-run.json` 作为修复后质量门 evidence；真实 GitHub 通过 run 需要推送后再替换为远端 run 元数据。
