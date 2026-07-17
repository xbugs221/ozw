# 文件目的：记录历史空闲 Codex 会话被误判为活动外部会话的根因、修复方案与真实验证证据。

# 历史空闲 Codex 会话无法从卡片恢复

## 用户可感知场景
- URL: http://127.0.0.1:4001/projects/matx_proj/matx/c380
- 用户角色/账号: 本机已登录用户 xbugs
- 操作步骤: 从 matx 项目打开历史手动会话 c380，进入默认终端视图
- 期望结果: 已空闲的历史会话通过受控兼容路径恢复；共享服务会话通过远端终端无损接管；只有仍活动且归属未知的旧式会话被阻止
- 实际结果: c380 显示“外部 Codex 会话正在运行且未接入共享 daemon”，终端未启动

## 模块责任边界
- 前端:
  - 责任: 将会话身份和可验证的活动状态发送给 Shell WebSocket，并按阻止原因显示准确文案
  - 证据: `useShellConnection.ts` 仅从 `selectedSession.isProcessing` 生成 `externalSessionState`；字段缺失时固定为 `unknown`。`Shell.tsx` 无视具体 reason，固定显示“正在运行”
- 后端:
  - 责任: 以运行时真值判断活动状态，探测共享 daemon 线程归属，并选择 attach、remote TUI、兼容恢复或阻止
  - 证据: `codex-terminal-attach-plan.ts` 将 `unknown + providerSessionId` 一律阻止；`shell-websocket.ts` 直接信任浏览器传入状态
- 数据层:
  - 责任: 持久化 cN 与 provider thread 的绑定，不承担瞬时活动状态真值
  - 证据: c380 配置绑定 provider thread `019edb58-2755-74d0-9642-8a8aca85a374`，创建于 2026-06-18，早于共享 daemon 改造
- 运维/部署:
  - 责任: 保持正式 Ozw 服务、共享 daemon、proxy 和 Unix Socket 可用
  - 证据: `/health` 为 200；共享 daemon 和 proxy 正常运行；控制 Socket 存在
- 第三方服务:
  - 责任: Codex app-server 提供 loaded thread、thread/read 和轮次状态
  - 证据: c380 不在 loaded/list 中，但 thread/read 可读，最新轮次已完成；这表示它是可迁移的历史空闲线程，而非活动外部线程
- 其他模块:
  - 模块名称: 受管 tmux
  - 责任: 已存在时优先复连 Ozw 终端
  - 证据: 当前不存在 c380 对应 tmux，因此进入共享归属与兼容恢复决策

## 模块协作与接口契约
- 调用链: 会话卡片/直达 URL → Chat 状态查询 → Shell WebSocket `init` → 后端读取 cN 绑定 → 共享线程探测 → 接管计划 → PTY 或 `handoff-blocked`
- 数据归属: cN/provider 绑定属于项目状态文件；活动轮次属于后端 provider runtime/共享 daemon；tmux 属于 Ozw Shell 运行时
- 接口契约:
  - 请求方法/路径或事件名称: Chat WebSocket `check-session-status`；Shell WebSocket `init`
  - 请求参数/消息体: `projectName`、`projectPath`、`routeSessionId`、`providerSessionId`、`externalSessionState`
  - 响应结构/状态码/错误码: `session-status(isProcessing, turnId)`；`handoff-blocked(reason, sessionFailed)`
  - 鉴权和权限要求: 已登录 Ozw 用户；本机 Codex daemon 使用现有认证
  - 超时、重试、幂等要求: 共享线程只读探测 5 秒超时；重复打开不得创建额外 turn 或 interrupt；受管 tmux 必须复用
  - 兼容性要求: 旧活动会话继续安全阻止；旧空闲会话允许恢复；共享活动/空闲会话均允许远端接管
- 失败传播: 前端状态缺失被放大为 `unknown`，后端按最保守策略阻止，前端再把所有原因渲染成“正在运行”
- 日志、trace、metric: 正式服务日志记录 c380 身份后未执行 Shell 命令；浏览器 console 0 error；相关 HTTP 请求均成功
- 主责修复模块: Shell WebSocket 后端权威状态解析与终端接管策略
- 需要协同确认的模块: 前端阻止原因展示、Codex runtime 状态查询、真实 Playwright 场景

## 最底层证据
- 浏览器 console: 0 error，仅 WebGL 性能 warning；已发送两次 `check-session-status`
- Network/API: auth、health、projects、overview、messages、model-state 均成功
- 后端日志: c380 的 providerSessionId 已正确解析，但未执行 Shell 命令
- 数据库/缓存: c380 持久化绑定正确；瞬时 `isProcessing` 不在 overview 会话读模型中
- 认证/权限: 正式页面已认证为 xbugs
- 配置/环境: Ozw v1.2.1 正式服务与共享 daemon 均在运行

## 根因
共享架构只应阻止“仍活动且不属于共享 daemon”的旧式会话。当前 Shell 初始化把浏览器卡片快照当作活动状态来源；overview 不提供 `isProcessing`，所以历史会话以 `unknown` 进入后端。共享探测又只看 loaded/list，把可由 thread/read 读取的历史线程误判成“不归共享服务”；后端随即阻止任何 `unknown + providerSessionId`。最后，前端忽略阻止 reason，导致状态未知也显示成“正在运行”。

## 修复假设
后端无论线程是否已加载，都通过共享服务 thread/read 验证可读性，并依据最新轮次分类：已完成即空闲并通过远端终端迁移；明确活动则阻止；读取失败或状态不确定时继续保守阻止。共享服务已加载的线程照常接管。阻止响应携带稳定 reason，前端按 reason 显示准确文案。测试锁定共享活动、旧活动、旧空闲、状态未知四类行为。

## 端到端测试计划
- 测试文件: `tests/e2e/codex-shared-app-server-handoff.spec.ts`
- 使用的真实数据/账号: 隔离 Playwright HOME、真实 Codex daemon、真实官方 Codex CLI、真实浏览器；正式环境复查使用 c380
- 截图节点: 正式环境修复前 c380 阻止；隔离环境旧活动会话准确阻止；正式环境修复后 c380 成功恢复

## 验证结果
- 命令: `pnpm typecheck`、`pnpm build`、17 条后端/规范测试、3 条连续运行的真实 Playwright 场景
- 结果: 全部通过。真实旧空闲线程被共享服务加载并恢复；真实私有 app-server 活动线程保持原轮次且被安全阻止；正式 URL 已显示终端输入框且无错误提示
- 复查 URL: http://127.0.0.1:4001/projects/matx_proj/matx/c380
- 截图文件: `screenshots/before-c380-false-block.png`、`screenshots/after-c380-migrated.png`、`screenshots/after-current-service-c380.png`

## 阻塞项
None.
