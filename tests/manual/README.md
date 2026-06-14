# 手动历史回归导读

## 业务场景

`tests/manual` 保留需要人工环境、长链路确认或只在特定历史问题复核时运行的手动历史回归。它们记录曾经影响用户的真实故障，但不适合全部纳入默认 CI，例如依赖特殊 Provider 行为、旧浏览器流程或人工确认的运行条件。

## 运行命令

```bash
pnpm run test:manual:codex-resume
pnpm exec tsx --test tests/manual/node-history/*.test.ts
pnpm exec playwright test tests/manual/browser-history/*.spec.ts
```

这些命令按需运行，不进入默认 `pnpm run test`。运行前应确认当前环境满足对应历史回归的前置条件。

## 失败含义

手动历史回归失败通常意味着旧问题可能重新出现，用户可能再次看到历史顺序错乱、恢复链路失效或特殊 Provider 场景退化。处理时应先确认环境是否匹配，再决定是否把风险升级为默认回归或补充新的自动化测试。

## 新增测试

新增测试只有在确实需要人工确认、特殊环境或历史审计保留时才放在这里。若测试已经能稳定自动运行，应优先放入 `tests/backend`、`tests/spec` 或 `tests/e2e`，避免把默认入口应该覆盖的业务风险藏进手动目录。
