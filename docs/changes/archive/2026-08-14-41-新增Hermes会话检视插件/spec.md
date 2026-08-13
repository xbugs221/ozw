# 规格：Hermes Dashboard 会话检视插件

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence | 真实数据来源 | 入口路径 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 独立插件入口 | Dashboard 发现插件并通过深链打开会话 | hermes-inspector-dashboard | inspector-browser-demo | 临时 HERMES_HOME、真实插件目录和真实 Dashboard 插件扫描 | `/session-inspector?profile=default&session=<id>` | 插件 Tab 可见，深链直接选中目标会话，原生页面仍可访问 | 尚无原生 Sessions 行级按钮 |
| 可理解的有序执行流程 | 合并 compression lineage，并按 ozw 当前源码的折叠层级阅读交错 reasoning/commentary/tool/final | hermes-inspector-dashboard | inspector-browser-demo、inspector-browser-screenshots、inspector-three-surface-parity | 真实 SessionDB 写入的父子会话；当前 OZW 真实组件渲染的 Codex/Claude 同语义 fixture | Inspector 时间线与临时 parity harness | completed 过程默认闭合；逐层展开后可见纵向顺序严格保持；工具 output 归属原 call；三方同 viewport/同状态截图与动态折叠证据存在 | 同一 assistant DB 行未保存字段级交错，只能采用声明的稳定投影 |
| 只读且运行时解耦 | 无 ozw 运行时仍可检视且不修改数据库 | hermes-inspector-dashboard | inspector-readonly-state | 无 OZW_HOME/ozw 命令的 Dashboard 进程与检视前后 SQLite 投影 | 同一浏览器检视流程 | 插件正常加载，sessions/messages 业务行前后相同，无写操作入口 | Dashboard 自身运行元数据不属于插件业务写入 |

## 新增需求

### 需求：插件必须作为独立 Dashboard Tab 安装和访问

插件必须通过 Hermes Dashboard 公共插件机制注册，不得修改或替换原生 Chat、Sessions 页面。

#### 场景：Dashboard 发现插件并通过深链打开会话

- **给定** 插件产物已安装到临时 `$HERMES_HOME/plugins/hermes-transcript-inspector/dashboard/`
- **并且** 真实 Hermes Dashboard 已在回环地址启动
- **当** 用户打开 `/session-inspector?profile=default&session=<真实会话 id>`
- **则** Dashboard 导航必须出现 `Hermes 会话检视`
- **并且** 插件必须直接选中 URL 指定的 profile 和会话
- **并且** 原生 `/chat` 与 `/sessions` 路由必须继续存在
- **测试** `docs/changes/archive/2026-08-14-41-新增Hermes会话检视插件/tests/hermes-inspector-dashboard.acceptance.spec.ts`
- **证据** `inspector-browser-demo`
- **剩余风险** 第一版需要在插件内选择会话，原生 Sessions 行级按钮另案处理

### 需求：插件必须完整呈现可持久化的执行细节

插件必须把 compression continuation 显示为一个连续时间线，并对齐验收时 ozw 当前源码的 turn 级过程折叠、thinking、工具分组、紧凑工具行、同卡 output 与 final Markdown。格式化 JSON、通用键值卡或仅存在命名组件不能作为主阅读面。

#### 场景：按真实跨行顺序阅读 compression lineage 的完整执行流程

- **给定** 一个真实父会话以 `compression` 结束，子会话继续执行
- **并且** 父会话跨消息行依次包含多行 reasoning R1、成功工具 T1/result、assistant commentary、单行 reasoning R2、失败工具 T2/error 和 Markdown 最终回答
- **并且** 随后 compression 边界在父子会话重复同一用户 prompt，子会话继续返回可见内容，另有普通 branch 和 sibling branch
- **当** 用户打开子会话 Inspector
- **则** 用户 prompt 和 Markdown 最终回答必须默认可见，completed turn 的正文前过程必须默认闭合，其正文不可见
- **当** 用户展开正文前过程
- **则** R1 摘要、T1、commentary、R2、T2 与 Markdown final 的可见纵向坐标必须严格递增，不能按 reasoning/tool/assistant 类型重新分桶
- **并且** 多行 R1 默认只显示最后一条非空行摘要，展开 R1 后才显示全文；单行 R2 直接显示且不产生无意义的内层折叠
- **并且** 每段连续工具活动必须使用独立工具组；工具组展开后，T1 摘要在 output 关闭时仍直接显示 `terminal / pwd`
- **并且** T1 output 与 T2 error output 必须分别位于各自 call 容器内并可独立开闭；打开 T1 不得打开 T2，T2 的关闭摘要必须已经显示错误状态
- **并且** Markdown 最终回答必须生成正确的 `h2`、`ul`、`ol`、`a`、行内 `code` 和 fenced `pre > code` DOM
- **并且** raw JSON 默认不存在；显式开启再关闭 raw 时，有序语义内容和全部折叠状态必须保持不变
- **并且** compression 边界重复的用户 prompt 只能出现一次
- **并且** 工具调用与结果必须通过 call id 配对；缺失配对时显示边界提示
- **并且** 页面必须声明这里只展示已持久化 reasoning，不代表隐藏推理
- **测试** `docs/changes/archive/2026-08-14-41-新增Hermes会话检视插件/tests/hermes-inspector-dashboard.acceptance.spec.ts`
- **证据** `inspector-browser-demo`、`inspector-browser-screenshots`
- **剩余风险** provider 未持久化的 reasoning 不在可观察范围内；同一 assistant 数据库行中的 `reasoning_content`、`content`、`tool_calls` 没有精确交错记录，插件只能采用已声明的稳定协议投影

#### 场景：已知工具摘要、unmatched 边界和 tool-only turn 可直接理解

- **给定** compression child 末尾存在一个只有工具、没有 reasoning/final 的 turn
- **并且** 该 turn 连续调用 `read_file(path=src/app.ts)`、`search(query=TODO,path=src)`、`plan(2 steps)`、`subagent(description=审核部署流程)`
- **并且** 末尾存在 `legacy_tool` 的未匹配结果 `missing-call-1`
- **当** 用户查看该 completed tool-only turn
- **则** `turn-tool-list-group` 外层默认闭合，展开后 `turn-tool-list` 内层仍默认闭合
- **并且** 外层与内层可独立开闭，打开或关闭一层不得隐式改变另一层
- **当** 用户展开内层工具列表
- **则** 四个已知工具的闭合主摘要必须分别显示 `src/app.ts`、`TODO / src`、`2 steps`、`审核部署流程` 等业务信息
- **并且** 主摘要不得出现对象大括号、带引号字段名或完整 JSON
- **并且** unmatched 结果必须显示包含 `未匹配`、`legacy_tool`、`missing-call-1` 的可见边界，正文 output 仍由自己的 disclosure 控制
- **测试** `docs/changes/archive/2026-08-14-41-新增Hermes会话检视插件/tests/hermes-inspector-dashboard.acceptance.spec.ts`
- **证据** `inspector-browser-demo`
- **剩余风险** 未注册的新工具使用通用紧凑 fallback，但仍不得在主摘要输出完整 JSON

#### 场景：桌面和移动端保持 ozw 的紧凑阅读层级

- **给定** 同一交错会话包含长 Markdown 代码行、工具参数和错误输出
- **当** 用户分别以 1440×900 和 390×844 打开 Inspector
- **则** 桌面主列必须以紧凑过程容器、工具组和工具行呈现，不能用大号通用卡片占满主列
- **并且** 移动端 session picker 默认收起且可展开，所选会话标题、用户气泡和 process summary 必须进入第一屏
- **并且** 页面宽度不得超过 viewport；长 command、output 和 fenced code 只能在自身区域换行或局部滚动
- **并且** 当前宿主主题下正文、小字、summary、command、output、copy/output control 的实际前景/有效背景对比度必须至少为 4.5:1，大标题至少为 3:1
- **并且** command 左右 control 的中心点必须由 `elementFromPoint` 命中自身，两个 control 及其矩形不得互相覆盖，也不得与 command/output 文本 Range 矩形相交
- **并且** command 必须为左右 control 保留至少 `control width + 8px` 的安全内边距，展开 output 的正文必须位于 command 行下方
- **并且** 移动端长 thinking/tool summary 的 `scrollWidth/scrollHeight` 不得超过可见框，不得使用 `text-overflow: ellipsis` 或 `white-space: nowrap` 隐藏正文
- **并且** 每种关键状态必须生成本次运行的固定截图，不得依赖可选环境变量或沿用上次运行证据
- **测试** `docs/changes/archive/2026-08-14-41-新增Hermes会话检视插件/tests/hermes-inspector-dashboard.acceptance.spec.ts`
- **证据** `inspector-browser-screenshots`
- **剩余风险** Hermes 宿主主题色可以与 ozw 不同，但折叠层级、信息密度、错误语义和阅读顺序不得偏离

#### 场景：OZW Codex、OZW Claude 与 Hermes 使用同语义场景对照

- **给定** 临时 OZW parity harness 直接 import 当前仓库真实 `TurnNonBodyGroup`、`MessageComponent`、`ToolRenderer` 与生产 CSS
- **并且** Codex、Claude 与 Hermes 使用相同的 user、R1、T1/result、commentary、R2、T2/error、final 语义内容和 1440×900 viewport
- **当** 浏览器分别执行 `outer open → R1 thinking open → T1 tool group open → T1 Output open`
- **则** 三个渲染面必须分别保存固定截图，且 T2 tool group 在截图状态仍保持 closed
- **并且** 三个渲染面都必须通过真实 `<details>.open` 证明四层 disclosure 可独立操作，不得只给最终 DOM 或复制静态图
- **并且** 三方截图必须裁为相同 760×640 transcript 区域，不能以不同导航 chrome 的整页截图代替可比证据
- **并且** 验收必须输出 `parity-metrics.json`，比较 outer summary、thinking summary、tool group summary、command card、user bubble 的 fontSize、lineHeight、borderRadius、padding、height 和纵向 gap；Claude/Hermes 相对 Codex 超过合同窄容差时测试失败
- **并且** Hermes、OZW Codex 和 OZW Claude 必须分别保存本次运行的折叠操作视频或等价 trace
- **并且** OZW 对照页不得复制 Hermes HTML/CSS，也不得以旧截图替代当前组件渲染
- **测试** `docs/changes/archive/2026-08-14-41-新增Hermes会话检视插件/tests/hermes-inspector-dashboard.acceptance.spec.ts`
- **证据** `inspector-three-surface-parity`、`inspector-browser-demo`
- **剩余风险** Dashboard 宿主导航与 OZW 应用 chrome 不同，因此截图比较关注 transcript 裁剪区的层级、密度和状态，而非整页像素完全相同
- **说明** Codex/Claude 对照使用 synthetic ChatMessage 直接进入当前 OZW 生产 renderer，只证明 renderer parity，不覆盖 Codex/Claude native raw normalizer

#### 场景：Hermes 交付视频只展示稳定 Inspector 折叠流程

- **给定** 主 QA page 仍需访问 `/sessions`、`/chat` 和 OZW parity harness
- **当** 生成 `inspector-browser-demo.webm`
- **则** 必须使用独立录制 page/context，整个视频的主 frame navigation 只能是 `/session-inspector`
- **并且** 录制前必须等待 timeline、final Markdown 和稳定页面状态，录制期间不得出现 console error/warning、pageerror、request failure 或错误 alert
- **并且** 视频只执行 `outer → thinking → T1 group → Output` 逐层展开，再按相反顺序逐层收起；每一步都断言真实 `details.open` 和 Inspector URL
- **并且** 视频不得进入 `/sessions`、`/chat`、TUI、右侧错误页或 OZW parity 页面
- **并且** 录制结束后四层全部收起，Inspector 根节点仍可见，视频文件必须大于 10KB
- **测试** `docs/changes/archive/2026-08-14-41-新增Hermes会话检视插件/tests/hermes-inspector-dashboard.acceptance.spec.ts`
- **证据** `inspector-browser-demo`

### 需求：检视必须只读且不依赖 ozw 运行时

插件运行时只能通过 Dashboard 的受认证只读 Session API 获取数据，不得启动、连接或要求 ozw 服务。

#### 场景：无 ozw 运行时仍可检视且不修改数据库

- **给定** Dashboard 进程未设置 `OZW_HOME`、PATH 中没有 ozw 命令，也没有 ozw 服务
- **并且** 已记录检视前真实 sessions/messages 业务投影
- **当** 用户完成会话搜索、打开详情、展开 reasoning、工具参数、结果和 raw JSON
- **则** 所有内容必须正常显示
- **并且** Inspector 生命周期发出的全部 `/api/` 请求 method 必须为 GET
- **并且** 插件页面不得出现发送、steer、停止、审批、删除或重命名入口
- **并且** 检视后 sessions/messages 业务投影必须与检视前一致
- **测试** `docs/changes/archive/2026-08-14-41-新增Hermes会话检视插件/tests/hermes-inspector-dashboard.acceptance.spec.ts`
- **证据** `inspector-readonly-state`
- **剩余风险** Dashboard 自身可能更新与插件无关的运行状态，本场景只比较会话业务表

## 显式延期

- 原生 Sessions 每行的 Inspector 按钮及带 session context 的插件 slot。
- 运行中会话的实时 tail。
- 文件跳转、diff、subagent 树和执行控制。

## OZW 对齐基线

折叠、渲染与样式以验收时下列源码的当前行为为准，不以旧截图或组件命名为准：

- `frontend/components/chat/view/subcomponents/TurnNonBodyGroup.tsx`
- `frontend/components/chat/view/subcomponents/MessageComponent.tsx`
- `frontend/components/chat/tools/ToolRenderer.tsx`
- `frontend/components/chat/tools/components/CollapsibleDisplay.tsx`
- `frontend/components/chat/tools/components/OneLineDisplay.tsx`

浏览器合同必须验证真实 `<details>` 状态、内容可见性、父子归属、Markdown DOM 和可见元素纵向坐标；`data-component` 或 `data-testid` 只能用于定位，不能作为成果本身。
