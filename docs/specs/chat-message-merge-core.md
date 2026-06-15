# 规格：聊天消息归并内核

## 验收矩阵

| 需求 | 场景 | 规格测试 | 真实数据来源 | 入口路径 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- |
| 消息归并必须保持 turn 顺序 | persisted echo 不移动用户气泡 | `tests/specs/chat-message-merge-core.spec.ts` | 真实 merge 函数、三轮 Codex 消息样例 | `mergePersistedAndOptimisticMessages` | 旧用户气泡不会被追加到底部，也不会重复显示 | 后端 turn id 缺失时仍需 fallback 稳定排序 |
| persisted 覆盖同 turn live 副本 | live assistant 被 persisted 同 turn 覆盖 | `tests/specs/chat-message-merge-core.spec.ts` | previous UI rows、persisted replay | `mergePersistedAndOptimisticMessages` | final assistant 只显示一次，live draft 被覆盖 | 流式 draft commit 策略由后续协议规格覆盖 |
| 乱序历史必须稳定排序 | 乱序 persisted history 按 turn 输出 | `tests/specs/chat-message-merge-core.spec.ts` | 真实 persisted message shape 和 Codex provider line order | `mergePersistedAndOptimisticMessages` | user/assistant 交替顺序稳定，相同用户消息只出现一次 | 非 Codex provider 若缺少 sequence、rowid、timestamp、共享 turn 身份和 provider order，只能退回有限推断 |
| Codex WS 事件必须绑定同一 turn | WS accepted/response/complete 不移动用户气泡 | `tests/specs/chat-message-merge-core.spec.ts`、`tests/specs/codex-ws-turn-ownership.spec.ts` | 真实 Chat message shape、Codex WS item shape、REST refresh 样例 | WebSocket message handler、`mergePersistedAndOptimisticMessages` | 每个 assistant 响应仍位于对应 user turn 后，旧 user bubble 不靠近最新 turn | 真实 provider 字段差异仍需浏览器回归截图覆盖 |
| REST 刷新不得追加历史用户气泡 | 滞后 REST 刷新不 append 历史用户 | `tests/specs/chat-message-merge-core.spec.ts` | 三轮 persisted history、previous live rows | Chat message refresh | 第一轮 user echo 回到第一轮位置，底部仍是当前 turn 内容 | 依赖稳定 turn identity 和 96 merge core |
| 重复 WS 推送必须幂等 | 重复 codex-response 不生成重复 assistant/tool 气泡 | `tests/specs/codex-ws-turn-ownership.spec.ts` | fake WebSocket 重复 item | WebSocket message handler | visible tool/assistant row 只出现一次，user bubble 不重排 | provider item id 缺失时需 fallback identity |
| Codex draft 必须节流累积且不抹除 | 增量事件完成前进入一条 live 可见消息 | `tests/specs/codex-stream-stability.spec.ts` | Codex agent_message delta/completed 事件样例 | `reduceNativeRuntimeEvent`、`filterRenderableMessages` | running/in_progress draft 累积到一条 assistant，completed final 只显示一条稳定全文 | 不覆盖外部 provider 网络层，只约束前端 reducer/renderable 边界 |
| 空 persisted assistant 不得覆盖 live draft | REST refresh 落后于 WS live draft | `tests/specs/chat-message-merge-core.spec.ts` | previous live draft、stale persisted refresh、final persisted refresh | `mergePersistedAndOptimisticMessages` | 空 persisted assistant 保留同 turn 非空 live draft，非空 final 到达后替换 draft 且只显示一次 | 依赖同 turn identity 推断 |
| 前端消息增量合并 | 长会话 append 只转换新增 raw rows | `tests/specs/chat-message-merge-core.spec.ts` | 真实 `ChatMessage` 字段和 provider raw message delta | `mergeSessionMessageDelta` | 已有 UI message 对象引用保持稳定，只追加新增 messageKey，重复 delta 不重复追加 | hook 控制流由提案归档测试验证；稳定规格只锁定纯合并能力 |
| 聊天消息合并由纯 reducer 承担 | Hook 不承载主要消息数组拼接规则 | `tests/specs/chat-message-merge-core.spec.ts` | 前端 chat 源码和生产 reducer | `chatMessageReducer`、`useChatRealtimeHandlersImpl.ts`、`useChatSessionState.ts` | reducer/state/realtime 模块存在且无 suppression，hook 不传任意 updater，13 个 `ChatMessageAction` 分支能产生稳定 transcript | 外部 Provider 新消息形态需要新增 action 与测试样例 |
| accepted 用户气泡状态机化 | accepted 事件立即转 persisted | `tests/specs/chat-message-merge-core.spec.ts` | 真实 reducer、delivery status 状态机 | `deliveryStatusMachine`、`chatMessageReducer` | accepted optimistic 用户行立即成为 persisted，pending 失败和 persisted echo 迁移不散落在 reducer 字符串逻辑中 | 旧历史消息缺少 deliveryStatus 时仍按 persisted 显示 |
| live transcript 不被 JSONL 延迟阻塞 | accepted 后 live 先于 JSONL 可见且空刷新不清空 | `tests/specs/chat-message-merge-core.spec.ts` | 真实 reducer、session merge、session state hook | `liveTurnMergePolicy`、`mergePersistedAndOptimisticMessages`、`useChatSessionState` | Codex/Pi live 内容在 persisted JSONL 到达前可见，空 persisted reload 保留 accepted 用户行和 live 内容 | 外部 provider 写盘延迟不可控，但前端事件契约可验证 |

### 需求：消息归并必须保持 turn 顺序

归并内核必须把 persisted、live 和 optimistic 行映射回原 turn，而不是按到达顺序追加。

#### 场景：persisted echo 不移动用户气泡

- 给定 previous UI 中已有三轮对话
- 并且 REST persisted history 把第一轮用户 echo 放在数组底部
- 当前端执行消息归并
- 那么第一轮用户气泡必须仍显示在第一轮位置
- 并且不得在底部出现第二份第一轮用户气泡

### 需求：persisted 覆盖同 turn live 副本

persisted assistant 到达后，同 turn live assistant 不得继续显示成重复气泡。

#### 场景：live assistant 被 persisted 同 turn 覆盖

- 给定 previous UI 中有 live assistant draft
- 并且 persisted history 返回同一 turn 的 final assistant
- 当执行消息归并
- 那么只显示 final assistant
- 并且 live draft 不得移动到下一轮用户气泡后面

### 需求：乱序历史必须稳定排序

REST 刷新或缓存恢复可能返回非 UI 顺序的消息，归并内核必须恢复稳定 turn 顺序。

#### 场景：乱序历史按 turn 稳定输出

- 给定 persisted history 中 user/assistant 顺序乱序
- 当执行消息归并
- 那么输出按业务 timestamp、turn anchor 和 provider line order 稳定排序
- 并且相同用户消息只出现一次

### 需求：Codex WS 事件必须绑定同一 turn

Codex 的 accepted、response、complete 事件必须使用同一个请求身份，不能按到达顺序猜测当前行。

#### 场景：WS 事件绑定同一 turn

- 给定用户连续发送三轮 Codex 消息
- 当每轮收到 `message-accepted`、`codex-response` 和 `codex-complete`
- 那么每个 assistant 响应必须显示在对应 user turn 后面
- 并且旧 user bubble 不得移动到最新 turn 附近

### 需求：REST 刷新不得追加历史用户气泡

REST persisted history 可能滞后或乱序，但不能把旧用户请求追加到底部。

#### 场景：滞后 REST 刷新不 append 历史用户

- 给定 WS live transcript 已显示第三轮用户和 assistant draft
- 并且 REST 刷新返回第一轮 user echo
- 当前端归并 persisted history
- 那么第一轮 user echo 必须回到第一轮位置
- 并且底部仍只显示第三轮相关内容

### 需求：重复 WS 推送必须幂等

同一 Codex item 可能被 WS 重放，前端必须按 item identity 去重。

#### 场景：重复 WS 推送幂等

- 给定同一 `codex-response` item 连续到达两次
- 当前端处理 WebSocket 消息
- 那么 assistant 或 tool 气泡只出现一次
- 并且该重复事件不得触发 user bubble 重排

### 需求：Codex draft 必须节流累积且不抹除

Codex native runtime 的 running/in_progress 增量必须在同一 live assistant 行中累积，不能每个分片覆盖前文，也不能生成重复行。

#### 场景：增量事件完成前进入一条 live 可见消息

- 给定 Codex WS 连续推送同一 `agent_message` 的 delta 文本
- 并且事件状态仍为 running/in_progress
- 当前端计算可渲染消息
- 那么输出包含用户消息和一条 live assistant draft
- 并且后续 delta 继续累积到同一条 assistant draft

#### 场景：完成事件输出稳定全文

- 给定同一 `agent_message` 收到 completed/final 事件
- 并且事件携带最终 assistant 文本
- 当前端计算稳定可渲染消息
- 那么只显示最终全文
- 并且不得额外保留前面 token 的中间行

### 需求：空 persisted assistant 不得覆盖 live draft

REST read model 可能落后于 WebSocket live draft。空 persisted assistant 行代表落后刷新，不得清空同 turn 的非空 live draft。

#### 场景：REST refresh 落后于 WS live draft

- 给定 previous UI 中已有同 turn 的非空 `codex-live` assistant draft
- 并且 persisted refresh 只返回同 turn 的空 assistant
- 当前端执行消息归并
- 那么归并后仍显示非空 live draft
- 并且不得显示空 assistant 气泡

#### 场景：最终 persisted assistant 到达

- 给定后续 persisted refresh 返回同 turn 的非空 assistant final
- 当前端执行消息归并
- 那么归并后移除 live draft
- 并且只显示 persisted final

### 需求：前端消息增量合并

长会话追加刷新收到新增 raw rows 后，前端必须只转换和合并 delta，不能重建全部已加载 UI 消息。

#### 场景：长会话 append 只转换新增 raw rows

- 给定已有 UI 消息列表已经渲染稳定
- 并且后端只返回 afterLine 之后的新增 raw rows
- 当前端执行 delta 合并
- 那么已有 UI message 对象引用必须保持不变
- 并且新增 raw message 被转换为 UI message 并追加
- 并且重复到达的同一 `messageKey` 不得再次追加

### 需求：聊天消息合并由纯 reducer 承担

Hook 只能负责订阅、事件归一化、参数组装和副作用，主要 transcript 数组拼接、替换、去重、流式完成和错误追加规则必须集中在纯 reducer 中。

#### 场景：Hook 不承载主要消息数组拼接规则

- 给定聊天页实时事件 hook、会话状态 hook 和 reducer/state/realtime 模块源码
- 当运行稳定规格测试检查 reducer 边界
- 那么 reducer/state/realtime 模块必须存在且不得使用 TypeScript suppression
- 并且 `useChatRealtimeHandlers.ts` 必须保持为薄 re-export
- 并且真实 hook 实现不得通过 `applyUpdater` 或任意 transcript updater 闭包绕过 reducer

#### 场景：Reducer action 直接产生稳定 transcript

- 给定用户发送、持久化、流式 chunk、assistant append、工具调用、错误追加、REST reload、delta append 和 live runtime event
- 当这些事件以 `ChatMessageAction` 调度到 `chatMessageReducer`
- 那么 reducer 必须覆盖全部当前 action 分支
- 并且输出 transcript 顺序稳定、错误去重、工具结果回填、pending 用户失败和 live assistant 追加行为正确

### 需求：accepted 用户气泡状态机化

delivery status 迁移必须由明确状态机承担，reducer 只能调用状态机函数，不能在多个分支内散落字符串迁移。

#### 场景：accepted 事件立即转 persisted

- 给定用户发送 Codex/Pi 手动会话消息并生成 optimistic 用户行
- 当 provider 返回 `message-accepted`
- 那么该用户行必须立即进入 `deliveryStatus: "persisted"`
- 并且 pending 失败、accepted 成功、persisted echo 覆盖都必须通过 `deliveryStatusMachine` 统一迁移

### 需求：live transcript 不被 JSONL 延迟阻塞

provider live event 先于 JSONL/read model 写盘到达时，前端必须优先保留当前 turn 的 live 可见内容。

#### 场景：accepted 后 live 先于 JSONL 可见且空刷新不清空

- 给定用户消息已 accepted，但 `/messages` 或 JSONL read model 暂未返回该 turn
- 当 live assistant、tool 或 thinking event 到达
- 那么 live 内容必须出现在 accepted 用户气泡之后
- 当随后收到空 persisted reload
- 那么前端不得清空 accepted 用户行和同 turn live 内容

## 契约测试

### `tests/specs/chat-message-merge-core.spec.ts`

- 覆盖核心业务契约：persisted user echo 原位归并、optimistic/persisted user 去重、相同 timestamp 下按 turn anchor 分组、真实 assistant shape 缺少 turn anchor 时保持 user turn、乱序 persisted assistant rows 使用 provider line order 归位、滞后 REST refresh 不追加历史用户、三轮 Codex turn 中 late duplicate live row 不移动历史用户、空 persisted assistant 不覆盖同 turn 非空 live draft、非空 persisted final 替换 live draft、长会话 delta append 保持已有 UI row 引用稳定且不重复追加。
- 覆盖 reducer 可测化契约：hook 不保留任意 transcript updater 入口，`chatMessageReducer` 覆盖全部当前 `ChatMessageAction` 分支，并验证流式、工具、错误、pending user、persisted reload/delta 和 live runtime event 的 transcript 状态。
- 覆盖聊天 live 体系化契约：accepted 用户行通过 delivery status 状态机进入 persisted；Codex/Pi live 内容可先于 JSONL/read model 可见；空 persisted reload 不清空 accepted 用户行和 live 内容。
- 真实数据来源：直接导入生产归并入口 `frontend/components/chat/utils/sessionMessageMerge.ts`，输入使用真实 `ChatMessage` 字段组合。
- 入口路径：`pnpm exec tsx --test tests/specs/chat-message-merge-core.spec.ts`
- 用户可见断言：以 visible text 顺序检查 transcript，确保旧用户气泡不追加到底部、live assistant 被 persisted final 覆盖、user/assistant turn 顺序稳定，append refresh 只在底部追加新增可见消息。

### `tests/specs/codex-stream-stability.spec.ts`

- 覆盖 Codex live transcript 业务契约：running/in_progress delta 不进入稳定可见历史，completed/final 事件只输出一条稳定 assistant 全文。
- 真实数据来源：直接导入生产 live reducer `frontend/components/chat/utils/nativeRuntimeTranscript.ts`，输入使用 Codex WS item shape。
- 入口路径：`pnpm exec tsx --test tests/specs/codex-stream-stability.spec.ts`
- 用户可见断言：未完成 Codex delta 不闪现为 assistant 气泡，完成后显示最终文本且不重复中间 token。

### `tests/specs/codex-ws-turn-ownership.spec.ts`

- 覆盖 Codex WS turn 归属业务契约：accepted/response/complete 处理路径携带稳定请求身份、运行中 `command_execution` 保持可见、重复 WS item 按 identity 幂等。
- 真实数据来源：直接导入生产 live reducer `frontend/components/chat/utils/nativeRuntimeTranscript.ts`，输入使用 Codex WS item shape。
- 入口路径：`pnpm exec tsx --test tests/specs/codex-ws-turn-ownership.spec.ts`
- 用户可见断言：运行中工具卡出现一次，重复推送不生成重复 assistant/tool 气泡。
