# 文件目的：定义终端统一入口与 tmux 保活的可验收行为。

## 验收矩阵

| 场景 | required_tests | required_evidence |
| --- | --- | --- |
| 会话卡片默认打开终端并注入恢复命令 | `contract-session-card-terminal-entry` | `screenshot-session-card-terminal`, `network-session-card-shell-init` |
| 新建会话走同一个普通终端入口 | `contract-session-card-terminal-entry` | `screenshot-new-session-terminal` |
| 浏览器断线后终端进程由 tmux 继续保活 | `contract-terminal-tmux-persistence` | `runtime-log-tmux-reattach`, `trace-terminal-reconnect` |
| 用户退出 TUI 后终端仍可自由执行普通命令 | `contract-terminal-tmux-persistence` | `runtime-log-ctrl-c-free-shell` |
| 记录/详情视图由用户显式打开 | `contract-terminal-layout-record-view` | `screenshot-session-record-view` |
| 桌面终端不再固定底部 dock | `contract-terminal-layout-record-view` | `screenshot-desktop-terminal-main-view` |

### 需求：会话入口默认进入终端

#### 场景：会话卡片默认打开终端并注入恢复命令

当用户在项目总览或工作区左侧点击已有会话卡片时，系统应打开终端主视图，并向终端注入对应 provider 的恢复命令。Codex 会话使用真实 `providerSessionId` 恢复，Pi 会话使用 `pi --session <providerSessionId>` 恢复。此点击不应默认加载 JSONL 富渲染记录。

对应测试：`docs/changes/37-终端统一入口与tmux保活/tests/session-card-terminal-entry.acceptance.test.ts`

真实数据来源：Playwright fixture 中的 Codex/Pi 会话卡片，以及项目总览会话列表。

入口路径：`/workspace/fixture-project` 中的手动会话卡片。

关键断言：点击卡片后终端 WebSocket 收到带恢复命令的 init/inject 行为；页面焦点在终端；JSONL 记录视图没有自动替代终端。

剩余风险：具体命令字符串需要沿用当前 provider CLI 版本，执行阶段需确认 Codex 当前恢复命令是否仍是仓库既有命令。

#### 场景：新建会话走同一个普通终端入口

当用户点击“新建会话”并选择 Codex 或 Pi 时，系统应打开同一个普通终端视图，并注入新建命令。界面不应出现“会话终端”这种额外概念；用户后续 `Ctrl-C` 或执行其他 shell 命令都是允许行为。

对应测试：`docs/changes/37-终端统一入口与tmux保活/tests/session-card-terminal-entry.acceptance.test.ts`

真实数据来源：项目总览的 provider picker 和真实 shell WebSocket init。

入口路径：`/workspace/fixture-project` 的“新建会话”按钮。

关键断言：新建会话与恢复会话复用终端入口；没有特殊会话终端分支；终端 init 使用启动命令而不是直接进入 JSONL 视图。

剩余风险：若 provider 新建命令需要参数化模型/推理强度，本提案只要求入口统一，不扩展模型选择能力。

### 需求：终端由 tmux 保活

#### 场景：浏览器断线后终端进程由 tmux 继续保活

当浏览器刷新、网络断开或 WebSocket close 时，后端不得杀死终端进程。终端进程必须继续运行在 `tmux` session 中，浏览器恢复后重新 attach 并看到当前输出。

对应测试：`docs/changes/37-终端统一入口与tmux保活/tests/terminal-tmux-persistence.acceptance.test.ts`

真实数据来源：本地 `tmux list-sessions`、shell WebSocket、Playwright 断线重连。

入口路径：任意项目终端视图。

关键断言：后端包含 `tmux has-session/new-session/attach-session/send-keys` 等保活流程；WebSocket close 只 detach，不 kill；重连回放或显示当前终端状态。

剩余风险：后端服务进程重启后的 attach 能力依赖 `tmux` session 是否仍由系统保留。

#### 场景：用户退出 TUI 后终端仍可自由执行普通命令

当用户在终端中按 `Ctrl-C` 退出 Codex/Pi TUI 后，终端应继续留在 shell 中，用户可以运行 `pwd`、`git status` 等普通命令。此行为不得自动更改会话卡片绑定，也不得自动切换到 JSONL 记录视图。

对应测试：`docs/changes/37-终端统一入口与tmux保活/tests/terminal-tmux-persistence.acceptance.test.ts`

真实数据来源：真实终端输入输出。

入口路径：会话卡片打开的终端。

关键断言：`Ctrl-C` 后 shell 仍可输入；会话卡片 `sessionId` 不被终端中手动启动的新会话覆盖。

剩余风险：不同 TUI 对 `Ctrl-C` 的处理略有差异，QA 需覆盖 Codex 和 Pi。

### 需求：记录/详情是显式查看入口

#### 场景：记录/详情视图由用户显式打开

用户需要查看 JSONL 中的结构化历史、工具调用、消息细节时，应点击“记录”或“详情”入口。只有这个入口会加载 JSONL 渲染视图。

对应测试：`docs/changes/37-终端统一入口与tmux保活/tests/terminal-layout-record-view.acceptance.test.ts`

真实数据来源：Codex/Pi JSONL fixture。

入口路径：会话卡片上的“记录/详情”入口或终端主视图中的同名入口。

关键断言：默认会话点击不加载记录；显式点击记录后才渲染 JSONL 历史；记录视图可返回终端。

剩余风险：记录视图命名需和现有中英文 i18n 保持一致。

#### 场景：桌面终端不再固定底部 dock

在桌面视图中，终端应作为主工作区的平行视图出现，而不是默认固定在底部 dock。文件面板仍可作为侧边辅助视图存在，但终端不再作为底部附属区域遮挡主内容。

对应测试：`docs/changes/37-终端统一入口与tmux保活/tests/terminal-layout-record-view.acceptance.test.ts`

真实数据来源：桌面 Playwright 视口下的工作区页面。

入口路径：`/workspace/fixture-project`，点击顶部或工作区终端入口。

关键断言：页面没有可见底部终端 dock；终端填充主工作区；会话记录/详情与终端是平行切换关系。

剩余风险：旧布局本地存储可能残留，需要执行阶段提供迁移或忽略旧底部 dock 偏好。
