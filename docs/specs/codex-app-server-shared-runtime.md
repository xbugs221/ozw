# 文件目的：沉淀 Codex 共享 daemon、无损会话接管与网络策略的长期行为。

## 共享 daemon 与安全接管

- ozw 通过独立 daemon 的 app-server proxy 接入，关闭 ozw 只关闭 proxy，不停止 daemon。
- 无 ozw tmux 时，Codex 终端通过 `codex --remote unix://PATH resume <threadId>` 连接同一 daemon。
- 只有经过真实连接握手、目标 thread 归属和活动轮次核验，才允许普通接管；旧式活动或未知会话先显示风险警告。
- daemon 能只读核实但尚未加载的历史 thread，若不存在活动轮次，应通过 remote TUI 恢复并迁入共享运行时。
- 用户明确确认强制接管后，系统按原 Ozw 卡片编号（`cN`）创建受管 tmux，并由共享 remote TUI 新建 thread 后绑定回该卡片。
- 强制接管使用一次性短期确认令牌；令牌过期、重放或卡片绑定变化时必须拒绝。
- 强制接管不得停止、恢复或写入旧 thread，也不得隐式发送输入；旧终端继续独立运行。

## 网络策略

- 显式 HTTP/SOCKS 代理只注入 daemon，本地 Socket 绕过代理，诊断不得泄露凭据。
- 无代理时使用系统路由，不探测或伪造 TUN 代理。
- proxy off 清理大小写代理变量；配置漂移在活动轮次中只提示确认后重启，空闲时才允许受控重启。

## 测试入口

- `pnpm exec tsx --test tests/backend/codex-shared-runtime.test.ts tests/specs/terminal-unified-entry.spec.ts`
- `pnpm exec playwright test tests/e2e/codex-shared-app-server-handoff.spec.ts`
