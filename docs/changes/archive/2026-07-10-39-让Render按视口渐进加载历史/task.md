# 任务：让 Render 按视口渐进加载历史

## 1. 先运行创建阶段合同

- [x] 运行 `contract-render-two-page-budget`，确认当前失败于固定 100 条窗口或两页预算缺失。
- [x] 运行 `contract-render-scroll-demand-page`，确认当前失败于 Render 滚动不触发分页。
- [x] 运行 `contract-render-lazy-bounded-dom`，记录当前已满足和仍提前挂载的折叠层级。
- [x] 保存初始失败的网络、截图、滚动状态和 DOM 状态，禁止通过弱化断言绕过。

## 2. 建立 Render 独立分页状态

- [x] 为快照增加最早游标、`hasMore`、分页修订、加载锁、请求代次和前插操作。
- [x] 区分自动 Provider 事件与用户导航：继续忽略自动刷新，允许滚动/搜索/书签前插历史。
- [x] 会话切换或返回 TUI 时取消旧请求，避免跨会话写入。

## 3. 接入视口预算

- [x] 从 Render 滚动容器获取实际 `clientHeight`，监听有效尺寸变化。
- [x] 复用折叠后的展示块布局高度，填充到当前页加一页预留后停止。
- [x] 后端请求保持有界小批次，加入最大尝试次数、游标无进展和 `hasMore=false` 停止条件。
- [x] 视口变大时只补足缺失预留；视口变小时不清空数据或触发请求。

## 4. 接入上翻分页和锚点恢复

- [x] 移除 Render 的空历史滚动处理，把滚动事件连接到独立按需分页控制器。
- [x] 用户进入预留屏时加载下一逻辑页，使用锁和迟滞避免重复请求。
- [x] 前插前记录稳定消息键和相对位置，前插后恢复，不跳顶、不跳尾。
- [x] 恢复一页预留后停止网络，下一次进入新预留屏才继续。

## 5. 收紧虚拟化和折叠延迟挂载

- [x] 保持虚拟展示行不超过 150，并验证已加载数据增长不扩大 DOM 到全量。
- [x] 检查 turn、工具组、工具结果、diff、代码块、子任务的每层关闭状态，子树只能在对应打开后创建。
- [x] 摘要只保留标题、计数、状态和截断预览，不提前创建 Markdown、高亮、diff 或完整输出。

## 6. 更新长期规格与回归

- [x] 更新 `docs/specs/chat-performance.md`：从“Render 不分页”改为“禁止自动全量扫描，允许视口驱动的一页预取”。
- [x] 更新 `docs/specs/chat-rendering-parity.md` 的 Render 快照合同。
- [x] 重写 `tests/specs/chat-performance-boundary.spec.ts` 中要求空滚动处理的旧断言。
- [x] 重写 `tests/spec/frontend-runtime-noise-and-codex-render.spec.ts` 中要求点击后立即拥有完整 130 turn 的旧断言。
- [x] 保持普通聊天历史的分页、搜索和滚动锚点回归通过。

## 7. 完整验证与交付

- [x] 运行 `acceptance.json` 中全部测试。
- [x] 检查桌面、手机首屏截图和分页前插截图。
- [x] 检查 network 中没有无界请求、空闲后台扫描或跨会话请求。
- [x] 检查 console/page error 为空，并记录未验证风险。
