# 移动端终端无法触摸滚动

## 用户可感知场景
- URL: `http://localhost:4001/projects/ozw/c403`
- 用户角色/账号: 本机首个有效用户；端到端测试使用隔离环境有效用户
- 操作步骤: 移动端进入项目终端，产生多屏输出后上下滑动
- 期望结果: 像桌面鼠标滚轮一样浏览 TMux 历史输出
- 实际结果: 触摸滑动不产生滚动

## 模块责任边界
- 前端:
  - 责任: xterm.js 初始化、触摸输入和终端 WebSocket 转发
  - 证据: `frontend/components/shell/hooks/useShellTerminal.ts` 未补充 TMux 鼠标模式下的触摸桥接
- 后端:
  - 责任: WebSocket 与 PTY/TMux 之间的字节透传
  - 证据: `backend/server/shell-websocket.ts` 仅透传输入，不区分触摸或鼠标
- 数据层:
  - 责任: 无
  - 证据: 故障不涉及持久化数据
- 运维/部署:
  - 责任: 提供已构建前端和后端进程
  - 证据: 本机服务使用 `PORT=4001`
- 第三方服务:
  - 责任: 无
  - 证据: 故障链路完全位于本机
- 其他模块:
  - 模块名称: xterm.js / TMux
  - 责任: xterm.js 编码鼠标事件，TMux 接收滚轮事件并浏览历史
  - 证据: xterm.js 在鼠标协议激活时直接跳过内置 `touchstart/touchmove` 处理

## 模块协作与接口契约
- 调用链: 触摸手势 → xterm.js → WebSocket `input` → PTY → TMux
- 数据归属: 终端历史由 TMux/xterm.js 缓冲区持有
- 接口契约:
  - 请求方法/路径或事件名称: WebSocket `/shell`，消息类型 `input`
  - 请求参数/消息体: `{ type: "input", data: string }`
  - 响应结构/状态码/错误码: PTY 输出以 WebSocket 二进制/文本消息返回
  - 鉴权和权限要求: 有效本机登录令牌
  - 超时、重试、幂等要求: 输入不重试；连接由现有终端运行时负责恢复
  - 兼容性要求: 桌面滚轮、无鼠标协议时的 xterm.js 原生触摸滚动不得回归
- 失败传播: 触摸事件被忽略，后端没有收到任何滚轮控制序列，界面无报错
- 日志、trace、metric: 浏览器追踪 WebSocket 输入；后端终端日志确认连接
- 主责修复模块: 前端终端触摸适配
- 需要协同确认的模块: TMux 鼠标协议

## 最底层证据
- 浏览器 console: 修复后真实服务复查为 0 error
- Network/API: 修复前触摸滑动时 `/shell` WebSocket 没有鼠标滚轮输入；修复后端到端测试收到 TMux SGR 滚轮序列
- 后端日志: 终端连接正常，无 API 错误
- 数据库/缓存: 不涉及
- 认证/权限: 有效
- 配置/环境: `@xterm/xterm 5.5.0`；TMux 鼠标模式启用

## 根因
xterm.js 5.5.0 在终端应用启用鼠标协议后，会跳过其内置触摸滚动处理；Ozw 只初始化 xterm.js，没有把移动端纵向触摸转换成 xterm.js 可编码的滚轮事件。

## 修复假设
仅在 xterm.js 的鼠标协议激活时，把单指纵向位移按行高阈值转换成合成滚轮事件，由 xterm.js 继续负责编码 TMux 鼠标序列。未激活鼠标协议时保留原生触摸逻辑。

## 端到端测试计划
- 测试文件: `tests/e2e/shell-tab.spec.ts`
- 使用的真实数据/账号: Playwright 隔离环境有效用户、真实 WebSocket/PTY/TMux 和 fixture-project
- 截图节点: 修复后移动端终端完成触摸上滚

## 验证结果
- 命令: `pnpm exec playwright test tests/e2e/shell-tab.spec.ts`
- 结果: 5/5 通过；生产构建成功；真实 390×844 移动视口产生 13 个向上滚轮事件，控制台 0 error
- 复查 URL: `http://localhost:4001/projects/ozw/c403`
- 截图文件: `screenshots/mobile-terminal-touch-scroll.png`

## 阻塞项
完整 Web/Test 类型检查被工作区既有未提交改动阻断：`ChatInterface.tsx` 1 处、`chat-tool-runtime.test.ts` 3 处；均与本修复文件无关。本次生产构建和终端端到端回归不受影响。
