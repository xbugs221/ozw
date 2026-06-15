# manual/browser-history 历史资产清单

本文档说明 `tests/manual/browser-history` 下历史浏览器回归的当前处置。该目录只保留需要人工环境、长链路复核或历史问题审计的真实业务资产，不作为默认门禁；已能稳定自动化且本次确认仍属当前业务门禁的用例已迁入 `tests/spec` 或 `tests/e2e`。

## 处置原则

- `保留`：仍记录有效业务风险，但依赖人工环境、历史数据、外部服务或长链路条件，暂不进入默认门禁。
- `已迁移`：仍有当前业务价值，且已拆入 `tests/spec` 或 `tests/e2e` 的自动回归。
- `删除`：仅覆盖旧 `co` 路径且没有当前 Provider 价值，已确认无默认门禁引用。

## browser-history 清单

| 文件 | 处置 | 原因 |
| --- | --- | --- |
| `tests/manual/browser-history/chat-realtime-dedup.spec.ts` | 保留 | 覆盖实时事件与持久化历史去重，仍是当前风险；依赖长链路实时刷新观察，作为人工历史回归保留。 |
| `tests/manual/browser-history/co-browser-reconnect.spec.ts` | 保留 | 文件名来自旧 `co` 浏览器恢复链路，但内容用于追溯 reconnect 历史问题；不作为当前 Provider 默认门禁。 |
| `tests/manual/browser-history/co-session-followup.spec.ts` | 保留 | 关注 follow-up 去重和旧 `cN/co` 数据口径，保留作历史数据核对，不进入默认门禁。 |
| `tests/manual/browser-history/co-tail-window-and-cursor-refresh.spec.ts` | 保留 | 覆盖旧 `co` session tail/cursor 持久化，保留作历史读模型审计。 |
| `tests/manual/browser-history/codex-followup-ws-dedup-order.acceptance.spec.ts` | 保留 | Codex follow-up、WebSocket 去重和顺序仍有风险，但依赖实时顺序链路，作为人工历史回归保留。 |
| `tests/manual/browser-history/codex-streaming-stop-and-delta.spec.ts` | 保留 | 覆盖 Codex 手动会话刷新、停止按钮和 delta 增量追加，依赖真实流式会话，作为人工历史回归保留。 |
| `tests/manual/browser-history/converge-realtime-no-direct-transcript.spec.ts` | 保留 | 跨 Codex/Pi 收敛行为依赖真实 Provider 场景，短期作为人工历史回归。 |
| `tests/manual/browser-history/converge-workflow-child-session-wo-co.spec.ts` | 保留 | 旧 `wo/co` 文件名描述历史收敛路径，保留作跨 Provider 工作流子会话审计。 |
| `tests/manual/browser-history/file-mention-lazy-loading.spec.ts` | 保留 | 文件 mention 懒加载仍是当前页面风险，但需要较大 fixture 和性能观察，作为人工历史回归保留。 |
| `tests/manual/browser-history/frontend-idle-no-polling.spec.ts` | 保留 | 前端空闲轮询控制是当前资源消耗风险，保留作人工网络观察回归。 |
| `tests/manual/browser-history/main-content-title-resume-id.spec.ts` | 保留 | 验证 resume id 展示，依赖历史 provider 会话数据，短期按需运行。 |
| `tests/manual/browser-history/manual-session-edit-detail-and-tool-labels.spec.ts` | 保留 | Edit tool 详情与标签是当前用户路径，但依赖历史工具调用 fixture，作为人工回归保留。 |
| `tests/manual/browser-history/mobile-session-view-regression.spec.ts` | 保留 | 移动端会话历史、滚动和 composer 可见性需要多视口人工复核，作为历史回归保留。 |
| `tests/manual/browser-history/mobile-single-view-workspace.spec.ts` | 保留 | 移动端 workspace 单视图布局已有当前移动规格覆盖，历史用例保留作人工对照。 |
| `tests/manual/browser-history/pi-session-daily-followup-steer-refresh.acceptance.spec.ts` | 保留 | Pi daily/follow-up/steer/live refresh 依赖真实 Pi native SDK 长链路，按需人工回归。 |
| `tests/manual/browser-history/settings-sidebar-simplification.spec.ts` | 已迁移 | 设置页与 sidebar 简化已由 `tests/spec/settings-sidebar-simplification.spec.ts` 覆盖，历史文件仅作人工对照。 |
| `tests/manual/browser-history/wo-v130-qa-json-link.spec.ts` | 保留 | 绑定特定 wo v1.3.0 QA JSON 历史资产，作为人工审计保留。 |
| `tests/manual/browser-history/workflow-action-dialog.spec.ts` | 保留 | 网页 UI 创建工作流和绑定变更依赖完整后端工作流链路，作为人工历史回归保留。 |
| `tests/manual/browser-history/workflow-presentation.spec.ts` | 已迁移 | 工作流卡片与详情页展示已迁入 `tests/spec/workflow-presentation.spec.ts`，纳入当前 browser spec 门禁。 |
| `tests/manual/browser-history/workspace-dock-layout.spec.ts` | 保留 | workspace dock 布局仍是风险，但需要人工拖拽/视口观察，作为历史回归保留。 |
| `tests/manual/browser-history/workspace-dock-regression.spec.ts` | 保留 | dock resize 和 Git panel 稳定性需要人工交互复核，作为历史回归保留。 |
| `tests/manual/browser-history/workspace-dock-width-regression.spec.ts` | 保留 | dock 宽度退化需要人工视口复核，作为历史回归保留。 |
| `tests/manual/browser-history/workspace-regression.spec.ts` | 保留 | desktop workspace tabs 与 chat 可见性已有邻近默认规格，历史用例保留作人工对照。 |
| `tests/manual/browser-history/workspace-scroll-and-pane-controls.spec.ts` | 保留 | workspace 滚动容器和 pane 控制需要人工滚动/拖拽复核，作为历史回归保留。 |
