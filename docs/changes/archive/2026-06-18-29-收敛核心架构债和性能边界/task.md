# 任务：收敛核心架构债和性能边界

## 1. 契约测试先行

- [x] 1.1 运行 `pnpm exec tsx --test docs/changes/29-收敛核心架构债和性能边界/tests/core-boundary-contract.test.ts`，确认失败点指向核心边界而不是语法或路径错误。
- [x] 1.2 运行 `pnpm exec tsx --test docs/changes/29-收敛核心架构债和性能边界/tests/performance-boundary-contract.test.ts`，确认失败点指向性能边界而不是语法或路径错误。
- [x] 1.3 记录 `test-results/29-core-boundary/source-audit.json` 作为初始源码审计证据。
- [x] 1.4 记录 `test-results/29-performance-boundary/source-audit.json` 作为初始性能边界证据。
- [x] 1.5 梳理现有 `pnpm test` 失败项，区分历史失败和本提案相关失败。
- [x] 1.6 梳理现有 Playwright 业务流覆盖缺口，确认 project overview 和 chat 关键路径需要补测的真实用户行为。
- [x] 1.7 检查 `oz-flow.yaml` validation，确保它包含提案结构校验、契约测试、类型检查、目标回归、Playwright 和 build。

## 2. Provider transcript shared 边界

- [x] 2.1 新建 `shared/provider-runtime-transcript.ts`，写明文件用途。
- [x] 2.2 把 transcript event、overlay state、delta 合并和初始状态构造迁入 shared。
- [x] 2.3 为 shared reducer 内部函数补 docstring，说明业务语义。
- [x] 2.4 将前端 `nativeRuntimeTranscript` 改为 shared adapter。
- [x] 2.5 将 `active-turn-store.ts` 改为依赖 shared 模块。
- [x] 2.6 将 `live-transcript-store.ts` 改为依赖 shared 模块。
- [x] 2.7 移除 provider runtime 相关文件的 `@ts-nocheck`。
- [x] 2.8 补充或调整 transcript reducer 单元测试，覆盖 active turn 和 live overlay 合并。

## 3. Chat session runtime 拆分

- [x] 3.1 提取 `sessionHistoryLoader.ts`，负责分页历史加载。
- [x] 3.2 提取 `sessionBulkMessageLoader.ts`，负责分块全量加载。
- [x] 3.3 提取 `sessionHydrationController.ts`，负责 hydration 状态转换。
- [x] 3.4 提取 `sessionScrollController.ts`，负责滚动定位和 unread 计算。
- [x] 3.5 提取 message merge adapter，复用现有消息合并核心。
- [x] 3.6 将 `useChatSessionStateRuntime.ts` 缩减为 hook 装配层。
- [x] 3.7 为拆出的 session controller 补 docstring 和针对性单元测试。
- [x] 3.8 验证已有 session 加载、切换和历史定位行为不变。

## 4. Chat realtime runtime 拆分

- [x] 4.1 提取 `realtimeSessionLifecycle.ts`，负责连接、恢复和关闭。
- [x] 4.2 提取 `realtimeProviderEventController.ts`，负责 provider event 分发。
- [x] 4.3 提取 tool call event controller，负责工具调用增量和结束态。
- [x] 4.4 提取 queue/flush coordinator，统一处理 pending event。
- [x] 4.5 将 `useChatRealtimeHandlersRuntime.ts` 缩减为 hook 装配层。
- [x] 4.6 为 realtime controller 增加真实 streaming 事件样例测试。
- [x] 4.7 验证 provider 断线重连和 session 切换时不会串流。

## 5. Chat composer runtime 拆分

- [x] 5.1 提取 `composerAttachmentController.ts`，负责附件状态和上传错误。
- [x] 5.2 提取 `composerDispatchController.ts`，负责提交参数和请求调度。
- [x] 5.3 提取 draft state reducer，负责输入、清空和恢复。
- [x] 5.4 提取 submit eligibility selector，统一判断可提交状态。
- [x] 5.5 将 `useChatComposerStateRuntime.ts` 缩减为 hook 装配层。
- [x] 5.6 为 composer controller 增加附件、空输入和提交失败的业务测试。
- [x] 5.7 验证 composer 在 provider 忙碌、离线和附件失败时的状态一致性。

## 6. Project overview runtime 拆分

- [x] 6.1 提取 `projectOverviewActionController.ts`，集中处理 session/workflow 动作。
- [x] 6.2 提取 `projectOverviewSelectionState.ts`，集中处理批量选择状态。
- [x] 6.3 提取 `ProjectOverviewManualSessions.tsx`，渲染手动 session 区域。
- [x] 6.4 提取 `ProjectOverviewWorkflowSection.tsx`，渲染 workflow 区域。
- [x] 6.5 提取 provider-aware 的批量 stop/delete 调度函数。
- [x] 6.6 将 `ProjectOverviewPanelRuntime.tsx` 缩减为面板装配层。
- [x] 6.7 补真实项目列表数据的 project overview 业务测试。
- [x] 6.8 用 Playwright 验证刷新、选择、批量操作和错误提示。

## 7. Agent route 安全拆分

- [x] 7.1 提取 `backend/domains/agent/agent-auth.ts`。
- [x] 7.2 提取 `backend/domains/agent/agent-project-resolver.ts`。
- [x] 7.3 提取 `backend/domains/agent/github-operations.ts`。
- [x] 7.4 提取 `backend/domains/agent/agent-session-runner.ts`。
- [x] 7.5 提取 `backend/domains/agent/agent-response-writer.ts`。
- [x] 7.6 移除 `backend/routes/agent.ts` 的 `@ts-nocheck`。
- [x] 7.7 确保 GitHub token 不拼入 URL、日志或进程参数。
- [x] 7.8 补 agent route 的认证失败、路径越界、GitHub 操作失败和 session 启动测试。

## 8. Server runtime 和 HTTP deps

- [x] 8.1 提取 server startup lifecycle 模块。
- [x] 8.2 提取 watcher setup 模块。
- [x] 8.3 提取 project index backfill 模块。
- [x] 8.4 提取 file classification 模块。
- [x] 8.5 提取 HTTP route deps 构造模块。
- [x] 8.6 为 HTTP route deps 定义显式 TypeScript 接口。
- [x] 8.7 移除 route 注册中的 `deps: any`。
- [x] 8.8 补 server startup 集成测试，覆盖 watcher、route 注册和项目索引初始化。

## 9. Tool config registry 拆分

- [x] 9.1 设计工具族模块边界，保持现有 UI 行为。
- [x] 9.2 提取 read 工具配置模块。
- [x] 9.3 提取 edit 工具配置模块。
- [x] 9.4 提取 exec 工具配置模块。
- [x] 9.5 提取 provider 工具配置模块。
- [x] 9.6 提取 workflow 工具配置模块。
- [x] 9.7 将别名归一化改为数据驱动 map。
- [x] 9.8 将公开 payload config 的 `any` 改为 `unknown` 和类型守卫。
- [x] 9.9 补工具展示配置测试，覆盖常用 provider payload 样例。

## 10. 性能边界

- [x] 10.1 将 `loadAllMessages` 改为固定 page size 分块加载。
- [x] 10.2 为分块加载增加停止条件，避免重复页和无限循环。
- [x] 10.3 为目标消息定位复用分块加载计划。
- [x] 10.4 将 `projectRefreshReducer` 的比较逻辑改为稳定签名。
- [x] 10.5 确保项目签名只包含列表渲染和状态判断需要的字段。
- [x] 10.6 避免对 sessions、workflows、codexSessions、piSessions 做深层 `JSON.stringify`。
- [x] 10.7 保留文件提及下拉按需扫描、depth<=2 和 showHidden=false。
- [x] 10.8 保留消息列表虚拟化窗口上限。
- [x] 10.9 增加大 session 和大项目列表样例下的性能回归测试。

## 11. 验证和收尾

- [x] 11.1 重新运行 T29-CORE-BOUNDARY，确认源码契约通过。
- [x] 11.2 重新运行 T29-PERF-BOUNDARY，确认性能边界契约通过。
- [x] 11.3 运行 agent route 相关测试并保存日志证据。
- [x] 11.4 运行 tool runtime 相关测试并保存报告。
- [x] 11.5 运行 project overview Playwright 业务流并保存 trace 或截图。
- [x] 11.6 运行 `pnpm test`。
- [x] 11.7 运行 `pnpm exec playwright test`。
- [x] 11.8 更新验收证据路径，确保 `acceptance.json` 中 required evidence 都可复查。
- [x] 11.9 运行 `oz flow run`，让工作流按 `oz-flow.yaml` 的 validation 命令提交执行。
