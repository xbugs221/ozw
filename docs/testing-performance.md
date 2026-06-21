# 测试性能和质量门

## 文件目的

本文说明 ozw 的分层测试入口和耗时基线读取方式，帮助开发者按业务风险选择 `test:fast`、`test:smoke`、`test:full` 或 `qa:test:timing`。

## 质量门

`pnpm run test:fast` 用于本地日常小改动。它运行 `typecheck`、`test:vitest` 和 `test:server:smoke`，覆盖无浏览器的类型检查、低状态业务逻辑和关键后端读写链路；它不运行完整 Playwright 浏览器 e2e。

`pnpm run test:smoke` 用于提交前，尤其是改动可能影响页面入口、会话基础链路或前后端协作时。它先运行 `test:fast`，再运行 `test:e2e:smoke`，用较小浏览器集合补充真实页面信号。

`pnpm run test:full` 用于合并前和发布前。它覆盖 `typecheck`、`test:vitest`、`test:node` 和 `test:browser:full`，保留完整 Node 回归和完整 Playwright 浏览器回归。

`pnpm test` 委托 `pnpm run test:full`，默认入口仍代表完整保护，不因为新增快速入口而缩水。

## 耗时基线

`pnpm run qa:test:timing` 运行 `scripts/collect-test-timings.ts`，默认采集 `typecheck`、`test:vitest` 和 `test:server:smoke` 的真实耗时与退出码，并写入 `test-results/test-performance/latest.json`。

`pnpm run qa:test:timing:fast`、`pnpm run qa:test:timing:smoke` 和 `pnpm run qa:test:timing:full` 分别采集 fast/smoke/full profile，并写入 `test-results/test-performance/fast.json`、`test-results/test-performance/smoke.json` 和 `test-results/test-performance/full.json`。这些 profile 通过 `OZW_TEST_TIMING_PROFILE` 选择内置命令集合；`OZW_TEST_TIMING_OUTPUT` 仍可覆盖输出路径。

JSON 中每条结果包含命令 id、命令文本、`durationMs`、`exitCode`、`startedAt` 和 `finishedAt`。如果某个命令失败，脚本会保留非零退出码并以失败状态结束，避免把坏基线记录成成功。

需要临时采集其他入口时，可以设置 `OZW_TEST_TIMING_COMMANDS` 为 JSON 数组，例如：

```bash
OZW_TEST_TIMING_COMMANDS='[{"id":"fast","command":"pnpm","args":["run","test:fast"]}]' pnpm run qa:test:timing
```

## 使用建议

本地日常逻辑改动先跑 `test:fast`。涉及页面入口或会话链路的提交前检查跑 `test:smoke`。合并前、发布前、测试基础设施改动和跨模块重构跑 `test:full`。优化测试耗时前后运行 `qa:test:timing`，比较 `latest.json` 中的耗时和退出码。
