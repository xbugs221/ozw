# Codex 新会话终端与移动键盘遮挡

## 用户可感知场景
- URL: 本地 ozw 项目页及会话终端页
- 用户角色/账号: 本机已登录用户
- 操作步骤: 项目页新建 Codex 会话；手机端聚焦终端输入框
- 期望结果: 自动启动真实 Codex TUI、正确渲染；快捷键行位于软键盘上方
- 实际结果: 需要手工运行 Codex，终端渲染失效；快捷键行被软键盘遮挡

## 模块责任边界
- 前端:
  - 责任: 创建 cN 草稿、连接终端、按可视视口布局
  - 证据: `useProjectsState`、`useShellConnection`、`ShellMobileKeyBar`
- 后端:
  - 责任: 将 cN 绑定到真实 Codex 线程并启动/复连 TUI
  - 证据: `shell-websocket`、`codex-terminal-attach-plan`
- 数据层:
  - 责任: 持久化 cN 与 provider session 的绑定
  - 证据: `provider-session-binding`
- 运维/部署:
  - 责任: 提供 Codex daemon、Unix Socket、tmux
  - 证据: 当前本机 Codex CLI 0.144.5
- 第三方服务:
  - 责任: Codex daemon/remote TUI 协议
  - 证据: 官方 CLI 本机真实运行
- 其他模块:
  - 模块名称: 浏览器可视视口
  - 责任: 软键盘弹出时报告实际可见区域
  - 证据: Android 需 `interactive-widget=resizes-content`；Playwright 缩小视口回归通过

## 模块协作与接口契约
- 调用链: 新建按钮 → POST manual-sessions → cN 路由 → shell WebSocket init → daemon/remote TUI → tmux/PTY → xterm
- 数据归属: cN 属于项目配置；真实线程编号属于 Codex；二者绑定由后端持久化
- 接口契约:
  - 请求方法/路径或事件名称: POST `/api/projects/:name/manual-sessions`；WebSocket `init`
  - 请求参数/消息体: provider、projectPath、routeSessionId、providerSessionId、终端行列
  - 响应结构/状态码/错误码: session(cN/routeIndex)；output/handoff-blocked
  - 鉴权和权限要求: 本机登录态
  - 超时、重试、幂等要求: 同一 cN 复连同一 tmux/线程
  - 兼容性要求: 桌面和移动浏览器
- 失败传播: 后端错误应显示在终端/警告层；布局随 visualViewport 更新
- 日志、trace、metric: 浏览器 console/network、后端 shell 日志、tmux/daemon 状态
- 主责修复模块: 待证据确认
- 需要协同确认的模块: Codex CLI 与移动浏览器

## 最底层证据
- 浏览器 console: 无新增错误
- Network/API: 前端点击创建 c6，WebSocket 进入 Codex 模式
- 后端日志: c6 捕获并绑定真实 Codex thread，刷新后复连成功
- 数据库/缓存: 项目路由与 provider session 绑定可被 sessions API 读取
- 认证/权限: 使用本机真实 Codex 登录态完成 TUI 启动
- 配置/环境: Codex CLI 0.144.5、共享 daemon、tmux、390px 移动视口

## 根因
移动端 `MainContent` 把终端固定成普通 Shell，未传 `selectedSession`，使新建 cN 绕过 Codex 捕获、绑定与最终化；页面 viewport 同时未声明软键盘缩放内容，快捷键行仍位于被覆盖的布局视口底部。

## 修复假设
移动端终端与桌面端统一传递 provider/session 身份，仅无会话时使用普通 Shell；viewport 声明 `interactive-widget=resizes-content`，让软键盘缩小内容区域。

## 端到端测试计划
- 测试文件: `tests/specs/terminal-unified-entry.spec.ts`、`tests/e2e/shell-tab.spec.ts`、`tests/e2e/codex-shared-app-server-handoff.spec.ts`
- 使用的真实数据/账号: 本机 Codex 登录态、本仓库项目
- 截图节点: 新建真实 TUI 成功；移动可视视口缩小时快捷键行可见

## 验证结果
- 命令: 类型检查；终端边界测试；移动键盘浏览器测试；共享 daemon 真实浏览器测试
- 结果: 类型检查通过；5/5、1/1、1/1 通过
- 复查 URL: `http://127.0.0.1:4173/workspace/fixture-project/c6`（测试运行期间）
- 截图文件: `screenshots/mobile-keybar-above-keyboard.png`、`screenshots/codex-new-session-mobile.png`

## 阻塞项
None。
