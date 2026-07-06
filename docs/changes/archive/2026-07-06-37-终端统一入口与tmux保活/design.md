# 文件目的：说明终端统一入口与 tmux 保活的关键技术设计。

## 核心决策

| 决策 | 结论 |
| --- | --- |
| 用户概念 | 只保留“终端”和“记录/详情”，不暴露“会话终端” |
| 后端保活 | 使用 `tmux` 承载终端进程，WebSocket 只负责输入输出转发 |
| 会话绑定 | 会话卡片只保存业务 `sessionId`，终端用独立 `terminalId` |
| 命令启动 | 点击会话入口时生成一次 shell 命令并注入终端 |
| 手动操作 | 用户在终端里 `Ctrl-C` 或运行其他命令不触发自动会话重绑定 |

## 状态模型

| 字段 | 含义 | 是否用户可见 |
| --- | --- | --- |
| `terminalId` | 前端一个终端入口 | 否 |
| `tmuxSessionName` | 后端实际保活 session | 否 |
| `sessionId` | Codex/Pi 业务会话 ID | 部分可见 |
| `providerSessionId` | CLI 恢复时使用的真实 provider 会话 ID | 否 |
| `lastLaunchCommand` | 最近一次由系统注入的启动命令 | 否 |

关系应保持为：

```text
会话卡片 -> terminalId -> tmux session
会话卡片 -> sessionId/providerSessionId -> launch command
```

不要把 `sessionId` 和 `tmuxSessionName` 合并成一个概念。用户退出 TUI 后，终端仍然是普通 shell。

## 后端流程

| 步骤 | 行为 |
| --- | --- |
| init | 前端传入 `terminalId`、项目路径、可选启动命令 |
| ensure | 后端检查 `tmux has-session`，不存在则 `tmux new-session -d` |
| attach | WebSocket 连接 attach 到对应 `tmux` session |
| inject | 如有启动命令，通过 `tmux send-keys` 注入 |
| disconnect | WebSocket close 只 detach，不 kill |
| kill | 只有用户点击删除/结束终端才 kill 对应 `tmux` session |

## 前端流程

| 用户动作 | 前端行为 |
| --- | --- |
| 点击会话卡片 | 打开终端主视图，注入恢复命令 |
| 新建会话 | 选择 provider 后打开终端主视图，注入新建命令 |
| 点击记录/详情 | 打开 JSONL 渲染视图 |
| 点击终端 Tab | 只显示终端，不做会话识别 |
| 终端里手动启动别的会话 | 不更新会话卡片绑定 |

## 风险与取舍

| 风险 | 处理 |
| --- | --- |
| `tmux` 不存在 | 启动时检测并给出明确错误；不静默回退到易丢失 PTY |
| Windows 支持 | 可先明确为非目标或用等价后端持久层；验收以当前 Linux 开发环境为准 |
| 命令注入重复 | 每个会话卡片点击只对新建或显式重新启动的终端注入一次 |
| 旧底部 dock 偏好迁移 | 桌面端应迁移到主工作区终端视图，避免底部残留状态遮挡 |
