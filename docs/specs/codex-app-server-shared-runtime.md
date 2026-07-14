# 文件目的：沉淀 Codex 共享 daemon、无损会话接管与网络策略的长期行为。

## 共享 daemon 与安全接管

- ozw 通过独立 daemon 的 app-server proxy 接入，关闭 ozw 只关闭 proxy，不停止 daemon。
- 无 ozw tmux 时，Codex 终端通过 `codex --remote unix://PATH resume <threadId>` 连接同一 daemon。
- 只有经过真实连接握手、目标 thread 归属和活动轮次核验，才允许接管；旧式或未知活动会话必须阻止普通 resume，并提示迁移或等待。
- 接管不得启动第二个 app-server、interrupt 或额外 turn；原 thread/turn 必须保持连续。

## 网络策略

- 显式 HTTP/SOCKS 代理只注入 daemon，本地 Socket 绕过代理，诊断不得泄露凭据。
- 无代理时使用系统路由，不探测或伪造 TUN 代理。
- proxy off 清理大小写代理变量；配置漂移在活动轮次中只提示确认后重启，空闲时才允许受控重启。

## 测试入口

- `pnpm exec tsx --test tests/specs/codex-shared-runtime.spec.ts`
