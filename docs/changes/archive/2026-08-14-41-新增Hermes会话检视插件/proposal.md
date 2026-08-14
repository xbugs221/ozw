# 提案：在 Hermes Dashboard 内提供独立会话检视器

## 为什么要改

Hermes Web Dashboard 的历史渲染不足以审计复杂任务。ozw 能正确读取 Hermes `state.db` 并渲染 reasoning 与工具调用，因此用户需要在两台机器和两个产品之间切换，甚至处理 SQLite 快照同步。

真正缺失的是一个窄的观察面，而不是第四个 Hermes 执行入口。Hermes Dashboard 已支持 drop-in UI 插件、自定义 Tab 和受认证 API；把成熟的 transcript 归一化规则做成独立插件，可以把细节核查放回 Hermes 控制面，同时保持 ozw 与 Hermes 的产品边界。

## 本轮做什么

1. 新增可独立构建和安装的 Hermes Dashboard 插件 `hermes-transcript-inspector`。
2. 抽取 ozw 现有 Hermes 历史投影中的纯归一化规则，供 ozw 和插件构建共同使用。
3. 使用 Dashboard 现有 Session REST API 获取 profile、会话详情和分页消息，不新增写接口。
4. 提供插件会话列表、搜索、profile 过滤和 `session/profile` URL 深链。
5. 按 ozw 当前 turn 阅读模型呈现用户气泡、默认折叠的正文前过程、有序 thinking/commentary/tool 事件、紧凑工具行、同卡输出和 assistant Markdown，正确合并 compression lineage；原始 JSON 只能作为辅助审计入口。
6. 建立真实 Hermes Dashboard + 真实 SessionDB + 真实浏览器验收，以故意交错的数据验证视觉顺序、逐层折叠、桌面/移动端和只读边界；同一浏览器还必须用当前 OZW 真实组件分别渲染 Codex、Claude 同语义 turn，保存三方同 viewport/同展开状态截图、逐层折叠视频与只读状态快照。

## 架构边界

```text
ozw 源码仓库
├─ shared Hermes transcript normalization
└─ integrations/hermes-dashboard-inspector
      └─ build → 独立 Dashboard plugin

VPS Hermes Dashboard
└─ plugin static bundle
      └─ authenticated Session REST API
             └─ SessionDB（只读）
```

插件运行时不加载 ozw 后端、不连接 ozw WebSocket、不读取 ozw 数据库，也不要求 `ozw` 命令存在。

## 成功标准

- 用户在 Hermes Dashboard 内即可理解一个包含压缩、reasoning 和工具调用的真实会话。
- 主阅读面必须对齐 ozw 当前源码中的 turn 级过程折叠、单行/多行 thinking、工具分组、紧凑工具摘要与同卡输出，不得以格式化 JSON、通用键值表或仅带组件名字的容器代替这些行为。
- 插件必须按数据库可恢复的消息顺序展示 thinking、commentary、tool call/result 和 final body；工具结果回填原调用卡而不能把卡移动到结果行。
- 插件展示结果与验收时 ozw 当前源码的关键语义、折叠层级和信息密度一致；旧截图不具有覆盖当前源码的优先级。
- 完成 turn 的过程默认闭合，最终回答默认可读；用户可逐层、逐卡独立展开，打开 raw 不得改变语义组件的顺序或折叠状态。
- 证据必须同时包含 OZW Codex、OZW Claude 和 Hermes Dashboard 三个真实渲染面，三者使用同语义 fixture、1440×900 viewport 和 `outer → 多行 thinking → 第一个 tool group → 该工具 output` 展开状态；不得用旧 Hermes 截图或复制静态 HTML 代替。
- 动态证据必须真实操作外层过程、thinking、工具组和单工具 Output 四层 disclosure，并证明展开任一层不会意外打开同级的其他工具组。
- 已知工具至少覆盖 `read_file`、`search`、`plan`、`subagent` 的代表性参数；闭合主摘要必须直接表达路径、查询、步骤数或委托描述，不得显示参数 JSON。
- 未匹配 tool result 必须保留带工具名和缺失 call id 的可见边界；不能丢弃或伪装成 assistant 正文。
- 只有工具、没有 reasoning/final 的 turn 必须沿用 OZW 的 tool-only 双层 disclosure：外层过程与内层工具列表都默认闭合且可独立开闭。
- 三方对照除截图和视频外，还必须采集 outer summary、thinking summary、tool group summary、command card、user bubble 的 DOM/geometry/style 指标，并以窄容差比较 font size、line height、radius、padding、height 和纵向 gap；主题颜色可以不同。
- Codex/Claude synthetic ChatMessage harness 只证明当前 OZW 生产 renderer 的 apples-to-apples parity，不证明 Codex/Claude native raw normalizer parity。
- 检视不会改变 session/message 行或会话状态。
- 删除 ozw 运行时依赖后插件仍正常工作。
- 原生 Chat、Sessions 和其他 Dashboard 页面保持原行为。
