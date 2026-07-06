# 文件目的：拆分终端统一入口与 tmux 保活的执行任务和验证条件。

## 1. 先运行创建阶段契约测试

- [x] 运行 `pnpm exec tsx --test docs/changes/37-终端统一入口与tmux保活/tests/terminal-tmux-persistence.acceptance.test.ts`，预期当前实现因缺少 `tmux` 保活而失败。
- [x] 运行 `pnpm exec tsx --test docs/changes/37-终端统一入口与tmux保活/tests/session-card-terminal-entry.acceptance.test.ts`，预期当前实现因会话卡片仍直接选择会话/渲染详情而失败。
- [x] 运行 `pnpm exec tsx --test docs/changes/37-终端统一入口与tmux保活/tests/terminal-layout-record-view.acceptance.test.ts`，预期当前实现因桌面底部 dock 仍存在而失败。

## 2. 改造后端终端保活

- [x] 引入 `tmux` session 管理层，能创建、检测、attach、send-keys、kill 指定终端。
- [x] WebSocket close 改为 detach，浏览器断开后进程仍在 `tmux` 中运行。
- [x] 删除 plain/provider 保活差异，普通 shell 和 provider TUI 共享同一保活机制。
- [x] 增加明确错误，缺少 `tmux` 时提示用户安装或配置，不静默丢进程。

## 3. 改造前端终端入口

- [x] 建立会话启动命令构造器，Codex/Pi 新建与恢复命令都有测试覆盖。
- [x] 点击会话卡片打开终端，终端获得恢复命令，JSONL 记录不自动打开。
- [x] 新建会话打开终端，provider picker 后进入同一普通终端入口。
- [x] 保留记录/详情入口，用户点击后才加载 JSONL 渲染视图。

## 4. 调整桌面布局

- [x] 移除桌面底部终端 dock，Playwright 桌面截图中终端填充主工作区。
- [x] 清理旧布局持久化，旧 `bottomDock` 偏好不会让终端重新出现在底部。
- [x] 保持移动端单视图，移动端仍可在终端、文件、记录之间切换。

## 5. 回归与 QA

- [x] 运行本提案全部契约测试，`docs/changes/37-终端统一入口与tmux保活/tests/*.acceptance.test.ts` 全通过。
- [x] 运行 shell 相关端到端测试，`tests/e2e/shell-tab.spec.ts` 和 `tests/e2e/shell-relay-reconnect.spec.ts` 更新后通过。
- [x] 生成 QA 证据，`test-results/terminal-tmux-entry/` 包含截图、trace 和 runtime log。
- [x] 运行相关类型检查，shell、main-content、project overview 改动不破坏 TypeScript。

## 执行记录

- 历史测试更新原因：`tests/e2e/shell-tab.spec.ts` 原先断言桌面终端位于 `dock-panel-bottom`，与本提案“桌面终端迁移为主工作区平行视图”的新意图冲突，因此改为断言主工作区 `.xterm`、无下方终端 dock、移动端辅助按键仍可用。
- 历史测试更新原因：`tests/e2e/shell-relay-reconnect.spec.ts` 原先依赖旧项目点击流程打开终端 dock，改为使用 `?tab=shell` 主视图入口触发 shell WebSocket。
- QA 证据说明：本轮 Playwright 运行生成了本地 trace、截图和视频运行产物；这些运行产物不进入 git，按验收合同仅作为本地 evidence。
