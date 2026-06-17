# manual/browser-history 历史资产清单

本文档说明 `tests/manual/browser-history` 下历史浏览器回归的当前处置。该目录只保留需要人工环境、长链路复核或历史问题审计的真实业务资产，不作为默认门禁；已能稳定自动化且本次确认仍属当前业务门禁的用例已迁入 `tests/spec` 或 `tests/e2e`。

## 处置原则

- `人工保留`：仍记录有效业务风险，但依赖人工环境、历史数据、外部服务或长链路条件，暂不进入默认门禁。
- `已迁移`：仍有当前业务价值，且已拆入 `tests/spec` 或 `tests/e2e` 的自动回归。
- `默认门禁候选`：仍有当前业务价值，且适合迁入 `tests/spec` 或 `tests/e2e`，迁移前不得删除。
- `待删除`：仅覆盖旧 `co` 路径且没有当前 Provider 价值，已确认无默认门禁引用。

## browser-history 清单

| 文件 | 处置 | 原因 |
| --- | --- | --- |
| `tests/manual/browser-history/chat-realtime-dedup.spec.ts` | 人工保留 | 当前业务价值：实时事件与持久化历史去重仍会影响聊天可信度；运行前置：需要真实长链路刷新会话；证据路径：`test-results/manual-history/chat-realtime-dedup/` 保存 trace 或 log。 |
| `tests/manual/browser-history/co-browser-reconnect.spec.ts` | 人工保留 | 当前业务价值：reconnect 历史问题仍用于核对会话恢复退化；运行前置：需要可复现旧 `co`/provider 历史数据；证据路径：`test-results/manual-history/co-browser-reconnect/` 保存 trace 或 log。 |
| `tests/manual/browser-history/co-session-followup.spec.ts` | 人工保留 | 当前业务价值：follow-up 去重和旧 `cN/co` 数据口径用于迁移回归核对；运行前置：需要旧历史会话 fixture；证据路径：`test-results/manual-history/co-session-followup/` 保存 trace 或 log。 |
| `tests/manual/browser-history/co-tail-window-and-cursor-refresh.spec.ts` | 人工保留 | 当前业务价值：tail/cursor 持久化仍影响历史读模型审计；运行前置：需要旧 `co` session 历史数据；证据路径：`test-results/manual-history/co-tail-window-and-cursor-refresh/` 保存 trace 或 log。 |
| `tests/manual/browser-history/codex-followup-ws-dedup-order.acceptance.spec.ts` | 人工保留 | 当前业务价值：Codex follow-up、WebSocket 去重和顺序仍影响消息正确性；运行前置：需要真实 Codex 实时顺序链路；证据路径：`test-results/manual-history/codex-followup-ws-dedup-order/` 保存 trace 或 log。 |
| `tests/manual/browser-history/codex-streaming-stop-and-delta.spec.ts` | 人工保留 | 当前业务价值：停止按钮和 delta 增量追加仍是流式会话核心路径；运行前置：需要真实 Codex 流式会话；证据路径：`test-results/manual-history/codex-streaming-stop-and-delta/` 保存 trace 或 log。 |
| `tests/manual/browser-history/converge-realtime-no-direct-transcript.spec.ts` | 人工保留 | 当前业务价值：跨 Codex/Pi 收敛行为仍保护 provider 读模型边界；运行前置：需要真实 Provider 场景；证据路径：`test-results/manual-history/converge-realtime-no-direct-transcript/` 保存 trace 或 log。 |
| `tests/manual/browser-history/converge-workflow-child-session-wo-co.spec.ts` | 人工保留 | 当前业务价值：跨 Provider 工作流子会话仍需历史审计；运行前置：需要旧 `wo/co` 工作流样本；证据路径：`test-results/manual-history/converge-workflow-child-session-wo-co/` 保存 trace 或 log。 |
| `tests/manual/browser-history/file-mention-lazy-loading.spec.ts` | 人工保留 | 当前业务价值：文件 mention 懒加载仍影响大型项目输入体验；运行前置：需要较大文件树 fixture 和性能观察环境；证据路径：`test-results/manual-history/file-mention-lazy-loading/` 保存 trace 或 log。 |
| `tests/manual/browser-history/frontend-idle-no-polling.spec.ts` | 人工保留 | 当前业务价值：前端空闲轮询控制仍影响资源消耗；运行前置：需要浏览器网络面板观察环境；证据路径：`test-results/manual-history/frontend-idle-no-polling/` 保存 trace 或 log。 |
| `tests/manual/browser-history/main-content-title-resume-id.spec.ts` | 人工保留 | 当前业务价值：resume id 展示仍影响历史会话识别；运行前置：需要带 resume id 的历史 provider 会话；证据路径：`test-results/manual-history/main-content-title-resume-id/` 保存截图或 log。 |
| `tests/manual/browser-history/manual-session-edit-detail-and-tool-labels.spec.ts` | 人工保留 | 当前业务价值：Edit tool 详情与标签仍影响工具卡审阅；运行前置：需要包含工具调用的历史会话 fixture；证据路径：`test-results/manual-history/manual-session-edit-detail-and-tool-labels/` 保存截图或 trace。 |
| `tests/manual/browser-history/mobile-session-view-regression.spec.ts` | 人工保留 | 当前业务价值：移动端会话历史、滚动和 composer 可见性仍是用户路径；运行前置：需要多视口人工复核；证据路径：`test-results/manual-history/mobile-session-view-regression/` 保存截图或 trace。 |
| `tests/manual/browser-history/mobile-single-view-workspace.spec.ts` | 人工保留 | 当前业务价值：移动端 workspace 单视图仍需与当前移动规格对照；运行前置：需要移动视口人工复核；证据路径：`test-results/manual-history/mobile-single-view-workspace/` 保存截图或 trace。 |
| `tests/manual/browser-history/pi-session-daily-followup-steer-refresh.acceptance.spec.ts` | 人工保留 | 当前业务价值：Pi daily/follow-up/steer/live refresh 仍是 Provider 长链路风险；运行前置：需要真实 Pi native SDK；证据路径：`test-results/manual-history/pi-session-daily-followup-steer-refresh/` 保存 trace 或 log。 |
| `tests/manual/browser-history/settings-sidebar-simplification.spec.ts` | 已迁移 | 设置页与 sidebar 简化已由 `tests/spec/settings-sidebar-simplification.spec.ts` 覆盖，历史文件仅作人工对照。 |
| `tests/manual/browser-history/wo-v130-qa-json-link.spec.ts` | 人工保留 | 当前业务价值：wo v1.3.0 QA JSON 链接仍用于历史交付审计；运行前置：需要对应历史 artifact；证据路径：`test-results/manual-history/wo-v130-qa-json-link/` 保存截图或 log。 |
| `tests/manual/browser-history/workflow-action-dialog.spec.ts` | 人工保留 | 当前业务价值：网页 UI 创建工作流和绑定变更仍是完整工作流入口；运行前置：需要后端工作流链路可用；证据路径：`test-results/manual-history/workflow-action-dialog/` 保存 trace 或 log。 |
| `tests/manual/browser-history/workflow-presentation.spec.ts` | 已迁移 | 工作流卡片与详情页展示已迁入 `tests/spec/workflow-presentation.spec.ts`，纳入当前 browser spec 门禁。 |
| `tests/manual/browser-history/workspace-dock-layout.spec.ts` | 人工保留 | 当前业务价值：workspace dock 布局仍影响工作区可用性；运行前置：需要人工拖拽和多视口观察；证据路径：`test-results/manual-history/workspace-dock-layout/` 保存截图或 trace。 |
| `tests/manual/browser-history/workspace-dock-regression.spec.ts` | 人工保留 | 当前业务价值：dock resize 和 Git panel 稳定性仍影响开发路径；运行前置：需要人工拖拽交互；证据路径：`test-results/manual-history/workspace-dock-regression/` 保存截图或 trace。 |
| `tests/manual/browser-history/workspace-dock-width-regression.spec.ts` | 人工保留 | 当前业务价值：dock 宽度退化仍影响工作区阅读和编辑；运行前置：需要人工视口复核；证据路径：`test-results/manual-history/workspace-dock-width-regression/` 保存截图或 trace。 |
| `tests/manual/browser-history/workspace-regression.spec.ts` | 人工保留 | 当前业务价值：desktop workspace tabs 与 chat 可见性仍需历史对照；运行前置：需要桌面视口人工复核；证据路径：`test-results/manual-history/workspace-regression/` 保存截图或 trace。 |
| `tests/manual/browser-history/workspace-scroll-and-pane-controls.spec.ts` | 人工保留 | 当前业务价值：workspace 滚动容器和 pane 控制仍影响编辑体验；运行前置：需要人工滚动和拖拽复核；证据路径：`test-results/manual-history/workspace-scroll-and-pane-controls/` 保存截图或 trace。 |
