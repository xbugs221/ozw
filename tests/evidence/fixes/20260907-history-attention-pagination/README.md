# 技术复查

## 根因

- `Confirmed`：Codex/Pi 历史请求先正向解析 JSONL，再按原始行号取尾部窗口。thinking、tool use 和 tool result 因此会消耗每页配额。
- `Confirmed`：`activity_revision` 之前仅根据 `file_mtime_ms` 递增，回填或触碰文件会让已处理会话再次出现。
- `Confirmed`：首页列表上限为 100，旧的“全部处理完成”只提交当前这 100 条。

## 修复

- 历史分页仍使用稳定 raw-line cursor 保证无重叠，但配额只由 user/assistant 对话内容推进，并把页边界延伸到用户问题。
- 活动版本改为对话时间与消息数共同变化时递增；文件 mtime 仍用于索引新鲜度，不再代表用户需处理的新活动。
- 数据库版本升到 2，一次性修复旧版 mtime 逻辑已经误提升的确认游标。
- 新增服务端单事务“全部处理完成”入口，不受列表分页上限影响。

## 回归覆盖

- `tests/specs/codex-history-message-order.spec.ts`：工具密集分页、raw-line cursor 无重叠。
- `tests/specs/session-attention-board.spec.ts`：Codex/Pi 文件触碰、旧错误版本迁移、235 条全部确认、并发新活动保留。
- `tests/backend/database-storage-performance.test.ts`：数据库版本和 schema 契约。
- `tests/e2e/session-attention-stable-layout.spec.ts`：真实认证页面中的单条处理、键盘处理和全部处理。

## 验证记录

- 相关 Node 回归：17/17 通过。
- 增量读取与虚拟列表回归：11/11 通过。
- 会话 HTTP/read-model 回归：25/25 通过。
- 数据库启动与发布入口：3/3 通过。
- 真实本机数据库的隔离副本迁移：4 条已处理后再出现的会话中，3 条旧 mtime 噪声被修复，1 条确有处理后新对话的会话保留。
- TypeScript 类型检查：通过。
- 真实首页 Playwright 验收：1/1 通过。
- 历史滚动 Playwright 合并执行中，首个用例在 `networkidle` 等待阶段超时；后续两个历史分页用例已通过，因为避免继续空转而中止剩余用例。
