# 41：新增 Hermes 会话检视插件

## 用户问题

用户主要通过原生 Dashboard 创建、恢复、steer、停止和审批任务。Dashboard 的会话详情无法清晰呈现压缩前后的完整对话、reasoning、工具调用参数与结果；用户目前只能在工作电脑打开 ozw，并额外同步或挂载 VPS 的 `state.db` 来核查细节。

ozw 已经验证了 Hermes 历史的只读投影和结构化渲染，但把 ozw 继续接入 Hermes 执行链路会混淆两者定位，也增加跨机器数据库访问和运行时耦合。

## 交付目标

- 在 Hermes Web Dashboard 中安装一个独立的 `Hermes 会话检视` 插件 Tab。
- 用户从插件会话列表或带 `session/profile` 的深链进入只读详情页。
- 详情必须沿用 ozw 当前源码的 turn 阅读模型：用户气泡、完成 turn 默认折叠的正文前过程、有序 thinking/tool/commentary 事件、紧凑工具摘要、同卡可折叠输出，以及最后的 assistant Markdown 正文；原始 JSON 仅作为辅助审计面板。
- compression continuation 必须按真实 lineage 合并，不能重复用户消息或丢失父会话内容。
- 插件使用 Hermes Dashboard 现有认证和只读 Session REST API，运行时不要求安装或启动 ozw。
- ozw 与插件在构建期复用 Hermes transcript 的纯归一化规则；插件不搬入 ozw 的项目、终端、TUI 或 provider 状态管理。
- 插件视觉语义以验收时 ozw 现有源码为基线，特别是 `TurnNonBodyGroup`、`MessageComponent`、`ToolRenderer`、`CollapsibleDisplay` 和 `OneLineDisplay` 的层级、默认折叠和紧凑密度；旧截图只能作为历史证据，不能代替源码合同。
- 主时间线必须保留持久化消息之间的交错顺序，不允许先收集全部 reasoning、再收集全部工具、最后收集全部 assistant 正文。

## 非目标

- 不在插件中发送消息、steer、停止、审批、删除、重命名或修改会话。
- 不替换 Hermes 原生 `/chat`、`/sessions` 或 TUI。
- 不增加 Hermes 项目工作区管理。
- 不直接读取 VPS 上正在写入的 SQLite/WAL，也不引入 ozw 服务作为插件后端。
- 不展示模型未输出、未持久化的内部推理。
- 第一版不提供逐行 `sessions:row-actions` 插槽、实时 tail、文件跳转或完整 diff 编辑器。

## 用户路径

```text
Hermes Dashboard
    → Hermes 会话检视
    → 选择 profile / 搜索并选择会话
    → 查看完整 turn
         ├─ user bubble
         ├─ process details（完成历史默认折叠）
         │    ├─ thinking / commentary（保持原顺序）
         │    └─ tool group
         │         └─ compact tool row → collapsible output
         └─ assistant final Markdown
    → 返回原生 Chat 继续介入
```

## 验收入口

- 在临时 `HERMES_HOME` 中使用真实 Hermes `SessionDB` 写入故意交错的 compression lineage：多行 thinking → 工具及结果 → assistant commentary → 单行 thinking → 失败工具及错误 → Markdown 最终回答，并包含 compression echo 和普通 branch。
- 把真实插件产物安装到该 Hermes Home，启动真实 `hermes dashboard`。
- 使用真实浏览器从插件深链打开会话，验证完成 turn 默认折叠、逐层展开、视觉纵向顺序、单行/多行 thinking、工具输出归属、Markdown DOM、raw 不干扰语义状态，以及桌面/移动端布局。
- 同一浏览器验收直接加载 OZW 当前真实组件，分别渲染 Codex、Claude 同语义 turn；与 Hermes 在 1440×900、相同四层展开状态下各保存截图，并分别保存 outer→thinking→tool group→Output 的动态操作证据。
- 固定截图裁同宽 transcript 区，并输出三方 DOM/geometry/style 指标；同时覆盖 read/search/plan/subagent 已知工具摘要、unmatched result 边界和 tool-only turn 外层/工具列表双层折叠。
- 检视前后比较真实 SQLite 业务行，证明插件只读。
- 在没有 ozw 命令、服务和运行时环境变量的 Dashboard 进程中完成同一流程。

## 执行阶段默认上下文

- 实现仓库：ozw。
- 插件源码：`integrations/hermes-dashboard-inspector/`。
- 运行时宿主：相邻或显式 `HERMES_AGENT_REPO` 指向的 Hermes Agent。
- 插件作为 GPL-3.0 独立产物发布，不并入 Hermes Agent 的 MIT 核心。
