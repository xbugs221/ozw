# 规格：Render 按视口渐进加载历史

## 验收矩阵

| 需求 / 场景 | required_tests | required_evidence |
| --- | --- | --- |
| 首屏按设备视口准备窗口 / 桌面和手机只准备当前页与一页预留 | `contract-render-two-page-budget` | `desktop-first-screen`、`mobile-first-screen`、`initial-network` |
| 首屏按设备视口准备窗口 / 停留最新页不继续读取旧历史 | `contract-render-two-page-budget` | `initial-network` |
| 进入预留页才加载更早历史 / 上翻触发下一逻辑页 | `contract-render-scroll-demand-page` | `paging-network` |
| 进入预留页才加载更早历史 / 前插后保持锚点并停止继续扫描 | `contract-render-scroll-demand-page` | `anchor-after-prepend`、`paging-state` |
| 挂载有界且折叠内容延迟创建 / 离屏消息不扩大 DOM | `contract-render-lazy-bounded-dom` | `lazy-before-expand`、`dom-state` |
| 挂载有界且折叠内容延迟创建 / 重内容只在逐层展开后创建 | `contract-render-lazy-bounded-dom` | `lazy-before-expand`、`lazy-after-expand`、`dom-state` |

### 需求：Render 首屏按设备视口准备窗口

#### 场景：桌面和手机只准备当前页与一页预留

- 测试文件：`tests/render-viewport-demand-loading.spec.ts`
- 真实数据来源：隔离 HOME 中 `fixture-mixed-long-virtual-session` 的 1050 轮 Codex JSONL，包含普通正文、Markdown、diff、长工具输出和子任务记录。
- 入口路径：`/session/fixture-mixed-long-virtual-session`，分别使用桌面和手机视口点击 Render。
- 关键断言：最新内容可见；折叠后已加载布局覆盖约两个视口且保持有界；消息接口只使用有 `limit` 的小批次；不同视口都按自身高度形成两页预算。
- 剩余风险：极端字体缩放和浏览器辅助字号需要执行阶段补充手工 QA。

#### 场景：停留最新页不继续读取旧历史

- 测试文件：`tests/render-viewport-demand-loading.spec.ts`
- 真实数据来源：同一真实 Codex JSONL 和真实 `/messages` 网络记录。
- 入口路径：Render 首屏停留最新消息，不执行滚动、搜索或书签操作。
- 关键断言：首屏稳定后消息请求数不再增长；不得出现无 `limit` 请求或持续增加 offset 的后台扫描。
- 剩余风险：Provider 文件在测试期间主动追加不属于本场景，由现有冻结快照回归覆盖。

### 需求：进入预留页才加载更早历史

#### 场景：上翻触发下一逻辑页

- 测试文件：`tests/render-viewport-demand-loading.spec.ts`
- 真实数据来源：同一 1050 轮 Codex JSONL 的真实分页接口。
- 入口路径：从 Render 最新页向上滚入预留屏。
- 关键断言：进入预留屏前不请求；进入后请求更早的有界 offset/cursor；恢复一页预留后停止；再次进入新的预留屏才继续请求。
- 剩余风险：单个 turn 跨越多个原始分页时，一个逻辑页允许由多个小请求组成。

#### 场景：前插后保持锚点并停止继续扫描

- 测试文件：`tests/render-viewport-demand-loading.spec.ts`
- 真实数据来源：真实 Render DOM、滚动尺寸和 `/messages` 响应。
- 入口路径：用户停在一条已显示消息附近，上翻触发旧记录前插。
- 关键断言：前插前后的锚点消息仍在近似相同位置；页面不跳到新页顶部或最新消息；预留恢复后网络保持安静。
- 剩余风险：展开折叠项导致的主动高度变化不属于前插锚点误差。

### 需求：挂载有界且折叠内容延迟创建

#### 场景：离屏消息不扩大 DOM

- 测试文件：`tests/render-viewport-demand-loading.spec.ts`
- 真实数据来源：1050 轮混合长会话的真实浏览器 DOM。
- 入口路径：Render 首屏、分页前插后和展开一个工具组后。
- 关键断言：`.chat-message` 和虚拟展示行保持在 150 上限内；已加载数据增加不导致所有消息挂载。
- 剩余风险：浏览器扩展注入节点不计入聊天消息上限。

#### 场景：重内容只在逐层展开后创建

- 测试文件：`tests/render-viewport-demand-loading.spec.ts`
- 真实数据来源：长代码、220 行 diff、140 行工具输出和 25 个子任务工具步骤。
- 入口路径：先观察关闭的 turn/工具摘要，再逐层点击对应折叠按钮。
- 关键断言：关闭时工具卡和重内容节点不存在；只展开一个分支时其他分支仍不创建；点击工具输出后只创建该输出摘要，继续点击“显示更多”后才出现尾部内容。
- 剩余风险：Markdown 摘要文本仍需进行轻量字符串处理，不视为重内容挂载。
