# 手动会话重复名称与终端身份错位

## 用户可感知场景
- URL: `http://127.0.0.1:4001/projects/ozw`
- 用户角色/账号: 本机 ozw 用户（鉴权旁路）
- 操作步骤: 进入项目首页，查看同名手动会话卡片并点击进入终端
- 期望结果: 只展示用户创建的顶层会话；卡片 cN、tmux 与 Codex 原生会话一一对应
- 实际结果: 同一请求的 Codex 根会话与子代理都显示为同名卡片；点击子代理卡片会恢复子代理 tmux/Codex

## 模块责任边界
- 前端:
  - 责任: 展示 overview 返回的会话，并把所点卡片的 cN 与 Provider 会话号发送给终端
  - 证据: 卡片使用独立 Provider 会话对象；真实条目的 key、routeIndex、providerSessionId 均不同
- 后端:
  - 责任: 解析 Codex JSONL 来源、合并 cN 路由、过滤内部子代理
  - 证据: 新解析器能识别 `thread_source=subagent`，但旧 cN 路由合并后覆盖了该来源
- 数据层:
  - 责任: SQLite 保存 Provider 会话来源，项目配置保存 cN 绑定
  - 证据: c414/c415、c417/c418 的索引 `origin` 为空，项目配置已存在对应 cN
- 运维/部署:
  - 责任: 启动时回填 Provider 索引
  - 证据: 默认最多回填 2000 文件；本机 Pi 2247、Codex 1470，当前拼接和反转顺序使 Codex 完全未被回填
- 第三方服务:
  - 责任: Codex JSONL 提供根/子代理身份
  - 证据: 子代理首条 `session_meta` 含父线程号、深度与代理路径
- 其他模块:
  - 模块名称: tmux 终端中继
  - 责任: cN 隔离 tmux，Provider 会话号执行 `codex resume`
  - 证据: 实机 c415、c418 分别恢复对应子代理 UUID

## 模块协作与接口契约
- 调用链: Codex JSONL → 启动回填/文件监听 → SQLite → cN 路由合并 → overview API → 卡片 → `/shell` WebSocket → tmux/Codex
- 数据归属: JSONL 拥有父子关系；SQLite 是可修复副本；项目配置拥有 cN；终端仅消费最终身份
- 接口契约:
  - 请求方法/路径或事件名称: `GET /api/projects/:projectName/overview`；`/shell` WebSocket `init`
  - 请求参数/消息体: overview 使用 `projectPath`；终端使用 `routeSessionId`、`providerSessionId`、`provider`
  - 响应结构/状态码/错误码: overview 200，返回 `codexSessions[]`/`piSessions[]`
  - 鉴权和权限要求: 本机登录态或鉴权旁路
  - 超时、重试、幂等要求: 索引回填可重复；同一 Provider 会话 upsert 幂等
  - 兼容性要求: 顶层 Codex/Pi 会话继续显示；旧 cN 不删除，仅按权威 JSONL 来源隐藏
- 失败传播: 旧索引来源为空时，内部会话静默进入手动列表；终端按该错误卡片恢复真实子代理
- 日志、trace、metric: SQLite `indexed_at`、JSONL `session_meta`、tmux pane 命令与浏览器截图
- 主责修复模块: Provider 会话合并与启动回填
- 需要协同确认的模块: cN 自动导入、项目 overview、终端身份测试

## 最底层证据
- 浏览器 console: 未发现导致卡片错位的前端异常
- Network/API: overview 返回 c413-c418，其中两组三条相同标题
- 后端日志: c415/c418 的终端身份分别指向子代理 UUID
- 数据库/缓存: 旧子代理 `source_session_id` 等于自身且 `origin=NULL`
- 认证/权限: `/api/auth/status` 为已认证旁路，与故障无关
- 配置/环境: c413-c418 已在项目 `chat` 中自动导入；当前 Codex 1470、Pi 2247 份 JSONL

## 根因
旧版先把 Codex 子代理自动导入 cN，再由 SQLite 旧索引提供空来源。新版解析器虽能识别子代理，但启动回填的全局截断顺序让 Codex 文件完全饿死；即便索引已修复，cN 合并时旧路由的空 `origin` 又覆盖 Provider 的 `workflow`，因此列表无法自愈。tmux/Codex 没有随机错配，而是准确恢复了本不该显示的子代理卡片。

## 修复假设
按 Provider 公平选择回填文件，使近期 Codex 旧索引被重新解析；合并时由权威 Provider 的 `workflow` 来源覆盖旧 cN 空值；自动导入跳过内部会话。这样无需删除用户配置即可隐藏污染卡片，并保留正常 cN 到 Provider 的一一映射。

## 端到端测试计划
- 测试文件: `tests/manual/manual-session-identity-real.spec.ts`
- 使用的真实数据/账号: 当前 4001 实例、真实 ozw 项目、真实 Codex JSONL/SQLite、鉴权旁路账号
- 截图节点: 修复前重复卡片；修复后仅顶层会话

## 验证结果
- 命令: `pnpm run precommit`；`pnpm run build`；`pnpm exec playwright test --config=playwright.real.config.ts`
- 结果: 完整 CI（Vitest 63、后端 236、Node spec 84）通过；生产构建通过；真实数据端到端测试 1 项通过
- 复查 URL: 修复前 `http://127.0.0.1:4001/projects/ozw`；隔离副本验收 `http://127.0.0.1:4102/projects/ozw`
- 截图文件: `screenshots/before-duplicate-subagents.png`；`screenshots/after-top-level-sessions.png`

## 阻塞项
None
