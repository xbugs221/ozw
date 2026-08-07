# Changelog

本文件记录 ozw 的版本变更。条目由发布流程（`scripts/update-changelog.ts` 与 `release.sh`）在打标签时维护，依据标签区间的真实差异汇总，而非机械罗列提交信息。

## v1.3.5 - 2026-08-07

### Highlights
- Provider 监听器默认改用 inotify 事件取代每秒轮询，降低常驻 CPU 与磁盘唤醒，更适合 NAS 等低资源常驻场景。

### Changes
- 性能：`provider-watchers` 默认走 inotify 监听，仅在文件系统不支持时回退到轮询。

### Quality
- 涵盖 provider 快速发现相关节点规格测试，验证 inotify 路径下的会话发现时序。

## v1.3.4 - 2026-08-05

### Highlights
- 补齐 Claude 聊天清单发现并默认以 yolo 模式启动，Claude 会话与 Codex/Pi 一并纳入手动会话列表。
- 手动会话排序改为以创建时间为首要键，路由编号仅作稳定决胜，多 Provider 会话按真实时间交错。
- 低资源启动进一步简化，运行时更精简。
- 文件 Tab 展示完整可读目录。

### Changes
- 功能：发现 Claude 聊天清单并默认 yolo 启动。
- 重构：`compareSessionsByCreationNumber` 优先按 `createdAt` 倒序，相同时间再用 `routeIndex` 决胜。
- 性能：简化运行时并改善低资源启动。
- 修复：Pi 复用 Codex 风格；静默正常 JSON 噪声。
- 文档：提出 npm 分发与低端性能门禁方案。
- 运维：新增 NAS 双实例部署说明。

### Quality
- 对齐 CI pnpm 版本与 `packageManager` 字段；更新 pnpm 至统一基线。

## v1.3.3 - 2026-07-28

### Highlights
- 适配新版 `oz flow` 阶段名称，工作流详情页与读模型按新阶段口径渲染。

### Changes
- 兼容性：`stage-taxonomy`、`stage-session-resolver`、`status-summary` 等工作流读模型适配新版阶段命名。

### Quality
- 工作流读模型相关规格覆盖阶段映射兼容性。

## v1.3.2 - 2026-07-27

### Highlights
- 渲染会话耗时与价值（token 成本估算），便于跨会话横向比较。
- 修复特殊字符项目路径下终端无法连接的问题。

### Changes
- 功能：新增 provider-transcript 读模型与 token 成本计算，渲染每轮耗时与价值。
- 修复：含特殊字符的项目目录终端连接失败。
- 测试：修正 Pi 完整摘要测试断言。

### Quality
- 扩充 token 成本与耗时计算的单元测试断言。

## v1.3.1 - 2026-07-23

### Highlights
- 首页待处理会话卡片规整化，新增工作流会话过滤与刷新滚动回顶修复。
- 新增 TUI 剪贴板截图上传。

### Changes
- 功能：TUI 剪贴板截图上传。
- 修复：新工作流会话首页过滤；首页会话刷新后滚动回顶。
- UI：规整首页待处理会话卡片。

## v1.3.0 - 2026-07-22

### Highlights
- 修复 Hermes 缺失数据库时的无关告警。

### Changes
- 修复：Hermes 缺失数据库告警抑制。

## v1.2.9 - 2026-07-22

### Highlights
- 支持只读浏览 Hermes 对话历史，并按可用依赖开放会话与工作流。
- 渲染 Pi 会话并支持自定义 Claude Code 环境激活脚本。
- 纳入 Claude 会话能力检测，按实际可用能力开放入口。
- 移除设置智能体子页，简化导览结构。

### Changes
- 功能：只读浏览 Hermes 对话历史；渲染 Pi；自定义 Claude Code 激活脚本；Claude 能力检测。
- 重构：按可用依赖开放会话与工作流；移除设置智能体子页。
- 修复：首页工作流会话过滤与 CI。
- UI：增加返回主页链接。

## v1.2.8 - 2026-07-21

### Highlights
- 修复移动端首页侧栏无法关闭的交互问题。

### Changes
- 修复：移动端首页侧栏关闭。
- 杂项：依赖升级。

## v1.2.7 - 2026-07-21

### Highlights
- 构建跨项目待处理会话看板，统一聚合各项目的待处理会话。

### Changes
- 功能：跨项目待处理会话看板。

### Quality
- 看板读模型与首页聚合相关规格覆盖。

## v1.2.6 - 2026-07-19

### Highlights
- 修复终端会话入口行为，并对不再需要的 Node 24 警告移除。

### Changes
- 修复：终端会话入口行为。
- 杂项：移除对 Node 24 的警告。

## v1.2.5 - 2026-07-18

### Highlights
- 接入 Claude Code 会话与 tmux-TUI，Claude 会话可在工作台内接管。

### Changes
- 功能：接入 Claude-Code 会话与 tmux-TUI。

## v1.2.4 - 2026-07-18

### Highlights
- tmux 进程接管，终端保活更稳定。
- 精简侧栏项目展示。

### Changes
- 功能：tmux 进程接管。
- UI：精简侧栏项目展示。

## v1.2.3 - 2026-07-17

### Highlights
- 修复文件 Tab 错误连带渲染的问题。

### Changes
- 修复：文件 Tab 错误连带渲染。

## v1.2.2 - 2026-07-17

### Highlights
- 修复恢复历史空闲 Codex 会话接管失败的问题。

### Changes
- 修复：恢复历史空闲 Codex 会话接管。

## v1.2.1 - 2026-07-17

### Highlights
- 版本与依赖基线对齐发布。

### Changes
- 杂项：版本更新。

## v1.2.0 - 2026-07-17

### Highlights
- 修复移动端 Codex 会话启动与键盘遮挡问题。

### Changes
- 修复：移动端 Codex 会话启动与键盘遮挡。

## v1.1.9 - 2026-07-16

### Highlights
- 修复工作流子会话渲染校准振荡问题。

### Changes
- 修复：工作流子会话渲染校准振荡。

## v1.1.8 - 2026-07-15

### Highlights
- 简化 pre-commit 逻辑。

### Changes
- 工程：简化 pre-commit 逻辑。

## v1.1.7 - 2026-07-15

### Highlights
- 修复恢复会话后的终端刷新与回绑。

### Changes
- 修复：恢复会话终端刷新与回绑。

## v1.1.6 - 2026-07-14

### Highlights
- 共享 Codex app-server 实现会话无损接管。
- 排除手动会话中的子代理，避免误入列表。

### Changes
- 功能：共享 Codex-app-server 实现无损会话接管。
- 修复：排除手动会话中的子代理。

## v1.1.5 - 2026-07-14

### Highlights
- 修复统一本地钩子与 CI 运行环境，并对齐 pnpm 11.10.0 与 TypeScript 类型检查。

### Changes
- 修复：统一本地钩子与 CI 运行环境。
- 修复：隐藏工作流派生子代理会话。
- CI：对齐 pnpm 版本与 `packageManager`，修复 TypeScript 类型错误并把 typecheck 纳入 pre-commit。
- 测试：lazy-init AUTH_TOKEN，使 node 规格测试不依赖 Playwright fixture DB；适配 pnpm 11 输出行为。

## v1.1.4 - 2026-07-11

### Highlights
- 长会话历史按视口渐进加载，首屏显著加速。
- 默认进入终端而不是渲染 Tab。

### Changes
- 性能：Render 按视口渐进加载历史；优化长会话首屏渲染。
- UI：默认进入终端而非渲染 Tab；修复若干前端交互效果。
- 修复：默认进入终端而不是渲染 Tab。

## v1.1.3 - 2026-07-07

### Highlights
- 终端 tmux 会话保持稳定，纳入用户 bin 路径。

### Changes
- 修复：保持 routed 终端 tmux 会话稳定；为 provider 终端纳入用户 bin 路径。
- 文档：更新文档。

## v1.1.2 - 2026-07-07

### Highlights
- 修复会话渲染入口选择与短 URL 问题。

### Changes
- 修复：会话渲染入口选择和短 URL。

## v1.1.1 - 2026-07-06

### Highlights
- 终端统一入口与 tmux 保活，双 Provider 聊天 TUI 优先。
- 修复 Pi TUI resume 命令与渲染。

### Changes
- 功能：双 Provider 聊天 TUI 优先与终端保活渲染快照；终端统一入口与 tmux 保活。
- 修复：渲染 Pi 会话历史；Pi TUI resume 命令与渲染。
- UI：移除聊天框。

## v1.1.0 - 2026-06-30

### Highlights
- 响应中保持思考与工具调用展开，不再误折叠重要内容。

### Changes
- 修复：响应中保持思考与工具调用展开。

## v1.0.9 - 2026-06-29

### Highlights
- 涵盖编号 31–35 的迭代验收（会话消息导航书签、长会话历史预加载、回复结束折叠非正文内容、提前预取更早会话历史等）。

### Changes
- 功能/性能：会话消息导航书签、长会话历史预加载与提前预取、回复结束折叠非正文内容。

### Quality
- 对应变更提案（31–35）归档于 `docs/changes/archive`，规格与测试覆盖保留在 `docs/specs` 与 `tests`。

## v1.0.8 - 2026-06-27

### Highlights
- 新增 Codex 快速切换与子代理时间线。

### Changes
- 功能：Codex fast toggle 与 subagent timeline。

## v1.0.7 - 2026-06-27

### Highlights
- 支持 Markdown frontmatter 渲染。
- 修复 Codex 历史消息与 goal 完成渲染，新增 goal 支持。

### Changes
- 功能：Markdown frontmatter 渲染；goal 支持；proactive subagent。
- 修复：追加用户消息不能吞掉之前的；Codex 历史消息与 goal 完成渲染；消除频闪。

## v1.0.6 - 2026-06-22

### Highlights
- 首个公开发布版本。把 Codex、Pi 与 oz 工作流的智能体编程会话、项目文件、终端和跨设备访问放到同一个浏览器界面。

### Changes
- 功能：手动会话创建与续接、工作流读取/启动/恢复/终止、项目工作台（文件树/编辑器/终端）、WebSocket 实时同步、本机默认信任访问。
- 修复：用户消息去重、Codex 聊天实时渲染与图片工具链接、左侧项目清单删除、工作流详情自动刷新、Pi UI/ls/grep/find。
- UI：图片缩放、会话内重命名当前会话。
- 工程：移除 task-master 残留与测试路径污染。

### Quality
- 初始发布基线，含后端服务测试夹具与读模型分层，规格与测试资产分布于 `docs/specs` 与 `tests`。

> 更早的内部迭代未对应公开标签。
