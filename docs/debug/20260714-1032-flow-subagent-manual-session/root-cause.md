# oz flow 内部子会话污染手动会话清单

## 用户可感知场景
- URL: `http://127.0.0.1:4001/`
- 用户角色/账号: 本机 ozw 用户
- 操作步骤: 运行 `oz flow`，进入项目首页查看手动会话清单
- 期望结果: 工作流及其派生子会话不进入手动会话清单
- 实际结果: Codex 工作流根会话派生的子代理被当作普通会话

## 模块责任边界
- 前端:
  - 责任: 展示后端手动会话，并按工作流来源兜底过滤
  - 证据: `frontend/utils/workflowSessions.ts` 识别工作流编号及 `origin=workflow`
- 后端:
  - 责任: 解析 Provider 元数据、建立索引、过滤工作流会话
  - 证据: `provider-transcript-read-model.ts` 丢弃 Codex `source.subagent`
- 数据层:
  - 责任: 持久化 Provider 会话来源
  - 证据: `~/.ozw/ozw.db` 中工作流根会话来源正确，派生子会话来源为空
- 运维/部署:
  - 责任: 运行发布构建
  - 证据: 本机 4001 端口运行 `dist-node/backend/index.js`
- 第三方服务:
  - 责任: Codex JSONL 提供会话来源
  - 证据: 真实首条记录含 `thread_source=subagent` 和 `source.subagent.thread_spawn`
- 其他模块:
  - 模块名称: oz flow 状态
  - 责任: 记录工作流直接会话编号
  - 证据: `state.json.sessions` 不枚举 Codex 派生子代理

## 模块协作与接口契约
- 调用链: Codex JSONL → Provider 解析器 → SQLite 索引 → overview API → 手动会话面板
- 数据归属: JSONL 拥有子代理来源；SQLite 保存派生来源；overview 最终过滤
- 接口契约:
  - 请求方法/路径或事件名称: `GET /api/projects/:projectName/overview`
  - 请求参数/消息体: 项目名
  - 响应结构/状态码/错误码: `codexSessions`/`piSessions`，成功 200
  - 鉴权和权限要求: ozw 登录态
  - 超时、重试、幂等要求: 只读查询；索引更新幂等
  - 兼容性要求: 普通顶层 Codex 会话继续显示；旧 JSONL 继续解析
- 失败传播: 来源元数据丢失会静默降级为普通会话
- 日志、trace、metric: 当前无来源分类日志；以 JSONL、SQLite 和截图取证
- 主责修复模块: Provider transcript 解析器
- 需要协同确认的模块: Provider 会话列表读模型、SQLite 索引

## 最底层证据
- 浏览器 console: 验证过程无业务错误
- Network/API: 真实后端、真实 API 与 SQLite 读模型的浏览器规格测试通过
- 后端日志: 无报错；属于错误分类
- 数据库/缓存: 派生会话 `019f4a2d-7998-7f52-aa37-2ca9cdf022fc` 的 `origin` 为空
- 认证/权限: 与故障无关
- 配置/环境: oz flow contract v1.1.2

## 根因
此前修复依赖 `state.sessions`、DAG 和提示文本；Codex 派生子代理只在 JSONL 的 `session_meta.payload.source.subagent` 声明来源。解析器未保留它，索引及过滤链路因而无法识别内部会话。

## 修复假设
把 Codex 明确的 subagent 来源标记为 workflow origin，并沿用已有过滤契约；不再猜测标题，也不依赖 oz 状态枚举派生子代理。

## 端到端测试计划
- 测试文件: `tests/backend/provider-fast-discovery.test.ts`；`tests/specs/provider-session-list-read-model.spec.ts`
- 使用的真实数据/账号: 本机真实 Codex JSONL、oz flow state、ozw SQLite 和 ozw 实例
- 截图节点: 修复后项目手动会话列表

## 验证结果
- 命令: `pnpm exec tsx --test tests/backend/provider-fast-discovery.test.ts`；`pnpm exec tsx --test tests/specs/provider-session-list-read-model.spec.ts`；`pnpm exec playwright test tests/spec/batch-readonly-workflows.spec.ts --config=playwright.spec.config.ts --grep 'Codex JSONL subagents'`；`pnpm run typecheck`
- 结果: 后端 11/11、读模型 5/5、浏览器 1/1、类型检查全部通过；真实历史 JSONL 被解析为 `origin=workflow`，父会话编号正确
- 复查 URL: `http://127.0.0.1:4001/`（当前运行的是旧构建，升级并重启后复查）
- 截图文件: `screenshots/manual-sessions-filtered.png`

## 阻塞项
None
