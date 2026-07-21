# Render 历史加载期间滚动位置反复回弹

## 用户可感知场景
- URL: http://localhost:4001/projects/matsci_proj/rescu/c8
- 用户角色/账号: 本机已登录用户
- 操作步骤: 打开会话的 Render 页签；历史消息仍在加载时向上触发旧消息加载，随后立即向下滚动。
- 期望结果: 用户最后一次滚动优先，视口停留在用户选择的位置。
- 实际结果: 用户从 `scrollTop=144` 滚到 `900` 后，异步加载在约 45ms 内又把位置恢复为 `144`。

## 模块责任边界
- 前端:
  - 责任: 加载旧消息、插入页面并维护阅读锚点，同时尊重加载期间发生的用户滚动。
  - 证据: `ChatInterface.tsx` 在异步等待后无条件写入加载开始时保存的 `scrollTop`。
- 后端:
  - 责任: 按游标返回真实会话历史页。
  - 证据: 历史请求正常返回，页面 `scrollHeight` 从 1682 增长到 2312。
- 数据层:
  - 责任: 提供 `matsci_proj/rescu/c8` 的真实会话记录。
  - 证据: Render 页签正常显示真实消息并可继续分页。
- 运维/部署:
  - 责任: 在 localhost:4001 提供已构建前端与 API。
  - 证据: 页面、WebSocket 和历史接口均可访问。
- 第三方服务:
  - 责任: 无。
  - 证据: 该复现不依赖第三方服务。
- 其他模块:
  - 模块名称: 浏览器滚动容器
  - 责任: 接收滚轮输入并维护当前 `scrollTop`。
  - 证据: 浏览器先接受用户滚动到 900，随后才被前端赋值覆盖。

## 模块协作与接口契约
- 调用链: 用户滚轮 → Render 滚动处理器 → 历史消息 API → React 插入旧消息 → 前端恢复阅读锚点。
- 数据归属: 后端拥有会话历史；前端拥有当前视口位置与用户交互状态。
- 接口契约:
  - 请求方法/路径或事件名称: `GET /api/projects/:project/sessions/:session/messages`。
  - 请求参数/消息体: `limit`、`offset` 等分页参数。
  - 响应结构/状态码/错误码: 200，返回消息页与后续游标。
  - 鉴权和权限要求: 当前本机登录令牌。
  - 超时、重试、幂等要求: GET 可重试；前端等待响应期间不得覆盖更新后的用户意图。
  - 兼容性要求: 旧消息插入时仍需保留原有阅读锚点能力。
- 失败传播: 网络异常由现有错误处理结束加载；本缺陷发生在成功响应后的视口恢复阶段。
- 日志、trace、metric: 浏览器控制台 0 个业务错误；Playwright 轨迹记录了 144 → 900 → 144。
- 主责修复模块: 前端 Render 历史滚动控制。
- 需要协同确认的模块: 无。

## 最底层证据
- 浏览器 console: 0 errors；仅 WebGL 性能警告。
- Network/API: 真实历史请求成功，未使用模拟数据。
- 后端日志: 无服务端错误迹象。
- 数据库/缓存: 未发现数据异常，问题与返回内容无关。
- 认证/权限: 页面及接口访问正常。
- 配置/环境: localhost:4001，真实开发实例。

## 根因
Render 历史分页开始时捕获旧滚动位置；React 提交和虚拟列表测量期间允许用户继续滚动，但 `useLayoutEffect`、稳定高度等待完成处及整页加载结束处仍无条件恢复旧快照，导致较新的用户滚动被覆盖。

## 修复假设
为 Render 滚动交互维护递增版本。每次历史加载捕获版本；只在版本未变化时恢复旧阅读锚点。滚轮、触摸、指针拖动和键盘滚动都会使版本失效，因此加载期间最新用户意图优先，同时未交互时继续保持原有锚点。

## 端到端测试计划
- 测试文件: `tests/e2e/history-scroll-preservation.spec.ts`
- 使用的真实数据/账号: 项目现有 Playwright 真实后端、认证数据库与长会话夹具；分页响应仍来自真实 API，仅延迟返回以稳定覆盖竞态窗口。
- 截图节点: 真实实例故障复现、修复后用户位置保持。

## 验证结果
- 命令: `pnpm run typecheck:web`；`pnpm run typecheck:test`；`pnpm exec tsx --test tests/specs/chat-performance-boundary.spec.ts`；`pnpm run build`；`systemctl --user restart ozw.service`；`pnpm exec playwright test --config=playwright.real.config.ts --grep "加载旧消息期间用户的新滚动位置优先"`。
- 结果: 类型检查和构建通过；滚动边界测试 7/7 通过；服务 PID 从 4067019 更新为 2928610，4001 页面返回 200，WebSocket 重新鉴权成功；重启后真实 c8 端到端测试连续三次通过。旧历史接口状态 200，滚动轨迹为触发加载 160 → 用户下滚 1004 → 加载完成 1004 → 用户上滚 764 → 用户下滚 1027，没有回弹。
- 复查 URL: http://localhost:4001/projects/matsci_proj/rescu/c8
- 截图文件: `screenshots/before-reproduction.png`、`screenshots/failure-jumped-back.png`、`screenshots/fixed-user-scroll-preserved.png`、`screenshots/after-restart-recording.png`
- 录像文件: `scroll-after-restart-verified.webm`（3.48 秒，1280×720，VP8）。
- 坐标证据: `scroll-after-restart-state.json`。

## 阻塞项
None.
