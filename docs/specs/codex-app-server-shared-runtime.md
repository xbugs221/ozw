# 文件目的：沉淀独立 Codex 系统服务的客户端连接与无损会话接管行为。

## 共享 daemon 与安全接管

- Codex app-server 必须由系统服务管理器独立启动和维护；ozw 不启动、停止、重启或配置它。
- ozw 只通过客户端 proxy 接入独立服务，关闭 ozw 只关闭自己的连接。
- 客户端能力探测必须异步执行；同一可执行文件的并发探测共享一次结果，成功结果短期缓存，失败结果允许重试。
- 无 ozw tmux 时，Codex 终端通过 `codex --remote unix://PATH resume <threadId>` 连接同一 daemon。
- 只有经过真实连接握手、目标 thread 归属和活动轮次核验，才允许普通接管；旧式活动或未知会话先显示风险警告。
- daemon 能只读核实但尚未加载的历史 thread，若不存在活动轮次，应通过 remote TUI 恢复并迁入共享运行时。
- 用户明确确认强制接管后，系统按原 Ozw 卡片编号（`cN`）创建受管 tmux，并由共享 remote TUI 新建 thread 后绑定回该卡片。
- 强制接管使用一次性短期确认令牌；令牌过期、重放或卡片绑定变化时必须拒绝。
- 强制接管不得停止、恢复或写入旧 thread，也不得隐式发送输入；旧终端继续独立运行。

## 测试入口

- `pnpm exec tsx --test tests/backend/codex-shared-runtime.test.ts tests/specs/terminal-unified-entry.spec.ts`
- `pnpm exec playwright test tests/e2e/codex-shared-app-server-handoff.spec.ts`
