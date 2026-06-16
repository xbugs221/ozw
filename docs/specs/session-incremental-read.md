# 规格：会话消息增量读取

## 验收矩阵

| 需求 | 场景 | 规格测试 | 真实数据来源 | 入口路径 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- |
| JSONL 增量读取不全文件读 | Codex afterLine 只读取新增尾部内容 | `tests/specs/session-incremental-read.spec.ts` | 临时 HOME 中真实 Codex JSONL 长会话 | `getCodexSessionMessages(sessionId, null, 0, afterLine)` | 只返回 afterLine 后的消息，`total` 仍是完整非空行数，不调用 `FileHandle.readFile`，cache hit 从旧 EOF 读取 | 进程内 cursor cache miss 时允许从头回退以保证正确性 |
| JSONL 增量读取不全文件读 | Pi afterLine 只读取新增尾部内容 | `tests/specs/session-incremental-read.spec.ts` | 临时 HOME 中真实 Pi JSONL 长会话 | `getPiSessionMessages(sessionId, null, 0, afterLine)` | 只返回 afterLine 后的消息，`total` 仍是完整非空行数，不调用 `FileHandle.readFile`，cache hit 从旧 EOF 读取 | Pi provider 若未来不再 append-only，需要单独恢复策略 |
| 增量读取保持业务语义 | afterLine 边界不漏总行数 | `tests/specs/session-incremental-read.spec.ts` | Codex JSONL 尾部追加和过大 cursor | `getCodexSessionMessages` | 空新增行返回当前总行数，过大 cursor 不重复返回旧消息，`afterLine=0` 仍可回读现有消息 | 截断/替换路径不追求性能，只要求安全回退 |
| Codex 历史分页保持 raw line cursor | 一页 UI message 数量不同于 JSONL 行数时仍不重叠 | `tests/specs/codex-history-message-order.spec.ts` | 临时 HOME 中真实 Codex JSONL 多轮工具调用历史 | `getCodexSessionMessages(sessionId, limit, offset, null)` | 响应提供 `nextRawLineOffset`，相邻页不覆盖同一 raw JSONL 行 | UI 仍需按后端 cursor 翻页，不能自行用 message 数量推 offset |

### 需求：JSONL 增量读取不全文件读

浏览器已经持有 raw line cursor 并请求新增消息时，后端必须避免读取完整 JSONL 文件；常见 append refresh 应从已知旧 EOF 字节位置读取新增尾部。

#### 场景：Codex afterLine 只读取新增尾部内容

- 给定一个 Codex JSONL 长会话已经通过初始读取建立 cursor
- 当同一文件追加两条尾部消息，前端以旧 `total` 作为 `afterLine` 再次请求
- 那么响应只包含新增尾部消息
- 并且 `total` 等于完整 JSONL 非空行数
- 并且读取期间不得对 `.jsonl` FileHandle 调用 `readFile()`
- 并且 cache-hit 读取不得从 byte `0` 开始扫描

#### 场景：Pi afterLine 只读取新增尾部内容

- 给定一个 Pi JSONL 长会话已经通过初始读取建立 cursor
- 当同一文件追加两条尾部消息，前端以旧 `total` 作为 `afterLine` 再次请求
- 那么响应只包含新增尾部消息
- 并且 `total` 等于完整 JSONL 非空行数
- 并且读取期间不得对 `.jsonl` FileHandle 调用 `readFile()`
- 并且 cache-hit 读取不得从 byte `0` 开始扫描

### 需求：增量读取保持业务语义

I/O 优化不能牺牲 cursor、消息顺序和边界语义。

#### 场景：afterLine 边界不漏总行数

- 给定 Codex JSONL 已有完整历史
- 当 `afterLine` 等于当前总行数
- 那么响应返回空新增消息，同时 `total` 仍是当前总行数
- 当 `afterLine` 大于当前总行数
- 那么响应不重复返回旧消息，同时 `total` 仍是当前总行数
- 当 cache miss 且 `afterLine=0`
- 那么仍能回读现有消息

#### 场景：Codex 历史分页返回 raw line cursor

- 给定 Codex JSONL 中一行可能产生 0 条、1 条或多条 UI message
- 当调用 `getCodexSessionMessages` 读取第一页历史
- 那么响应必须返回 `nextRawLineOffset`
- 当下一页使用该 cursor 继续读取
- 那么相邻页不得覆盖同一 raw JSONL 行
- 并且前端不得依赖 `messages.length` 推导下一页 offset

## 契约测试

### `tests/specs/session-incremental-read.spec.ts`

- 覆盖 Codex/Pi JSONL afterLine cache-hit 从旧 EOF 读取新增尾部、禁止 `FileHandle.readFile` 全文件读取，以及 Codex cursor 边界回退。
- 真实数据来源：测试创建隔离 HOME，并写入真实 provider JSONL 行形态。
- 入口路径：`pnpm exec tsx --test tests/specs/session-incremental-read.spec.ts`
- 用户可见断言：长会话追加刷新只显示新增尾部消息，不重复显示历史前缀，且保留完整 raw line `total`。

### `tests/specs/codex-history-message-order.spec.ts`

- 覆盖 Codex 历史分页响应中的 `nextRawLineOffset`，以及相邻分页不能重叠同一 raw JSONL 行。
- 真实数据来源：测试创建隔离 HOME，并写入包含 provider-internal 消息、重复 user echo 和大量工具调用的 Codex JSONL。
- 入口路径：`pnpm exec tsx --test tests/specs/codex-history-message-order.spec.ts`
