# 规格：长会话历史预加载

## 验收矩阵

| 需求 | 场景 | required_tests | 真实数据来源 | 入口路径 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- |
| 长会话历史提前预加载 | 未到顶部时请求更早消息页 | `contract-history-prefetch` | Playwright 真实 fixture 的 Codex 长会话 | history-scroll 项目的 `cN` 会话路由 | `scrollTop > 100` 时出现 `limit=100&offset>=100` 的消息请求 | 具体预加载距离由执行阶段实现决定 |
| 长会话历史提前预加载 | prepend 后阅读锚点不跳 | `contract-history-prefetch`, `existing-history-scroll-preservation` | 同一真实 fixture 长会话 | history-scroll 项目的 `cN` 会话路由 | 更早页返回后 `scrollTop` 仍大于 100，继续向上能看到早期消息 | 极端超长单条消息高度仍需人工截图复核 |
| 历史加载性能边界 | 预加载不退化成全量加载 | `contract-history-prefetch`, `existing-chat-performance-boundary` | 真实浏览器页面和源码性能边界 | 长会话页面 | 无默认无界 messages 请求，`.chat-message` DOM 数量不超过 150 | 不覆盖用户显式点击“加载全部” |
| 后端分页契约保持 | raw line cursor 不回退 | `existing-session-incremental-read` | 临时 HOME 中真实 Codex/Pi JSONL | provider read model | afterLine 只读新增尾部，`nextRawLineOffset` 语义不变 | cache miss 仍允许安全回读 |

### 需求：长会话历史提前预加载

长会话打开后，前端可以为了性能只加载最新消息页；但当用户开始向上翻阅并进入历史预加载区时，前端必须主动请求更早历史，不能等用户已经抵达顶部才开始加载。

#### 场景：未到顶部时请求更早消息页

- 测试文件：`docs/changes/32-优化长会话历史预加载/tests/history-prefetch.acceptance.spec.ts`
- 真实数据来源：仓库 Playwright fixture 中的 history-scroll Codex 长会话。
- 入口路径：history-scroll 项目的 `cN` 会话路由，由 `/api/projects` 和项目 overview 解析。
- 给定用户打开长会话并看到最新尾部消息。
- 当测试把消息滚动容器滚到一个大于 `100px`、但已经接近更早历史的上方位置。
- 那么页面必须在用户到达顶部之前发起更早消息页请求。
- 并且该请求必须是有界分页请求，包含 `limit=100` 和大于等于 `100` 的 `offset`。

#### 场景：prepend 后阅读锚点不跳

- 测试文件：`docs/changes/32-优化长会话历史预加载/tests/history-prefetch.acceptance.spec.ts`、`tests/e2e/history-scroll-preservation.spec.ts`。
- 真实数据来源：同一个 history-scroll 长会话 fixture。
- 入口路径：history-scroll 项目的 `cN` 会话路由，由 `/api/projects` 和项目 overview 解析。
- 给定更早页已经在用户到达顶部之前返回。
- 当更早消息被插入到当前消息列表前方。
- 那么用户当前阅读位置不能跳到顶部或底部。
- 并且继续向上滚动时，可以看到更早的历史消息。

### 需求：历史加载性能边界

提前预加载只能改善翻阅连续性，不能让长会话默认加载全部消息或渲染全部 DOM。

#### 场景：预加载不退化成全量加载

- 测试文件：`docs/changes/32-优化长会话历史预加载/tests/history-prefetch.acceptance.spec.ts`、`tests/specs/chat-performance-boundary.spec.ts`。
- 真实数据来源：真实浏览器页面请求记录和源码性能边界测试。
- 入口路径：长会话页面。
- 给定用户只是打开长会话并向上翻阅。
- 当预加载发生。
- 那么消息请求不得出现无 `limit` 且无 `afterLine` 的默认无界请求。
- 并且消息 DOM 数量仍不超过既有虚拟列表上限。

### 需求：后端分页契约保持

本变更主责在前端触发策略；后端 raw line cursor、afterLine 和分页响应语义必须保持。

#### 场景：raw line cursor 不回退

- 测试文件：`tests/specs/session-incremental-read.spec.ts`。
- 真实数据来源：测试创建的隔离 HOME 真实 Codex/Pi JSONL。
- 入口路径：provider read model。
- 给定 Codex/Pi 历史通过 raw line cursor 分页和 afterLine 增量读取。
- 当执行本变更后。
- 那么 afterLine 只读新增尾部，`total` 和 `nextRawLineOffset` 语义不变。
