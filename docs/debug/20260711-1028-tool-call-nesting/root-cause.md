# 工具调用折叠嵌套过多

## 用户可感知场景
- URL: 本地会话聊天页
- 用户角色/账号: 本地用户
- 操作步骤: 展开“工具调用 N 次”或“思考与工具调用”
- 期望结果: 直接看到命令，输出可单独折叠
- 实际结果: 混合过程组的工具调用还需再展开一层

## 模块责任边界
- 前端: `TurnNonBodyGroup` 负责回合汇总，`MessageComponent` 负责命令与输出卡
- 后端、数据层、运维/部署、第三方服务: 不涉及

## 模块协作与接口契约
- 调用链: 回合展示块 → 外层汇总 → 工具消息 → 命令/输出
- 数据归属: 工具消息归聊天状态所有
- 接口契约: 展开外层后命令直接可见，只有输出保留折叠
- 失败传播: 不涉及
- 日志、trace、metric: 规格测试
- 主责修复模块: 前端聊天渲染
- 需要协同确认的模块: 无

## 最底层证据
- 浏览器 console、Network/API、后端日志、数据库/缓存、认证/权限、配置/环境: 不涉及纯渲染结构问题

## 根因
混合过程组曾额外渲染工具折叠；此外实际编排工具名 `functions.exec` 未注册为命令卡，导致落入 Parameters，并把 JavaScript 包装当成命令展示。

## 修复假设
移除中间工具组折叠，为 `functions.exec` 注册命令卡并从包装参数提取 `cmd`；保留左侧输出折叠按钮。

## 端到端测试计划
- 测试文件: `tests/specs/chat-rendering-parity.spec.tsx`
- 使用的真实数据/账号: 生产组件源码契约；无账号要求
- 截图节点: 当前环境未启动可复查会话，未截图

## 验证结果
- 命令: `pnpm exec tsx --test tests/specs/chat-rendering-parity.spec.tsx`
- 结果: 单元测试 4/4、规格测试 20/20 通过；前端类型检查通过
- 复查 URL: 本地会话聊天页
- 截图文件: 无

### 2026-07-11 浏览器复验
- 服务已重新构建并重启，地址：`http://127.0.0.1:4001/projects/ozw/c403`
- 真实会话展开后显示 63 张命令卡；示例命令为 `rtk read /home/zzl/dotfiles/skills/code-router/SKILL.md`
- 页面没有 `exec / Parameters` 折叠，浏览器控制台 0 error
- 修复 `custom_tool_call_output` 历史映射后，首组 15 张命令卡中 14 张生成输出按钮（另一张为空输出）
- 已点击输出按钮并确认内容展开；页面无 Parameters，浏览器控制台 0 error
- 截图：`screenshots/command-list-expanded.png`、`screenshots/command-output-expanded.png`

### 默认 TUI 回归复验
- 工具汇总标题：单个显示“一次工具调用”，多个显示“N次工具调用”
- 从项目主页进入真实会话 `c403` 后，TUI 标签为选中状态且存在一个 xterm 实例
- Render 切回 TUI 实测 121ms，浏览器控制台 0 error
- 截图：`screenshots/session-default-tui.png`

## 阻塞项
缺少已运行且包含对应历史消息的浏览器会话，因此无法做真实页面截图。
