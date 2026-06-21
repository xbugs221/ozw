# 30 - 移除OpenAI单次调用并统一Codex-app-server-steer

## 背景

ozw 的 Codex 手动会话已经迁移到 Codex app-server runtime，并且规格中要求运行中输入必须通过 `turn/steer` 写入当前 active turn。仓库仍残留两类不符合当前目标的 OpenAI 直连路径：

- `backend/openai-codex.ts` 通过 `codex exec --json` 执行单次 Codex 任务，`/api/agent` 仍调用该旧入口。
- `backend/server/http/attachment-routes.ts` 仍使用 OpenAI Whisper HTTP API 和动态 `openai` npm SDK 做语音转写与转写增强。

用户已确认这两类能力都不再需要。本变更要彻底移除它们，避免继续维护两套 Codex 执行语义和一条额外 OpenAI API 依赖。

## 目标

- 删除 Codex 单次 exec 运行时，生产路径只允许通过 Codex app-server runtime 执行 Codex。
- `/api/agent` 保留项目解析、GitHub clone、branch、PR、SSE/non-streaming 外壳，但 Codex 执行内核必须接入 app-server。
- 删除 OpenAI npm SDK 和附件路由中的 OpenAI Whisper/GPT 调用，前端或后端不再暴露 OpenAI 语音转写/增强入口。
- 用源码契约和业务入口测试锁定“不得退回单次调用 SDK/CLI”的边界。

## 非目标

- 不重写 Pi native SDK runtime。
- 不改变 Codex app-server protocol、active-turn、live transcript 的既有设计。
- 不保留 `/api/transcribe-audio` 的 OpenAI 兼容实现；需要语音输入时以后另开提案接入非 OpenAI 或本地方案。
- 不改变 GitHub token、clone、branch、PR 的业务规则，只替换 Codex 执行内核。

## 验收入口

- `pnpm exec tsx --test docs/changes/30-移除OpenAI单次调用并统一Codex-app-server-steer/tests/codex-runtime-removal-contract.test.ts`
- `pnpm exec tsx --test tests/specs/provider-runtime-boundary.spec.ts tests/specs/codex-app-server-protocol-mapping.spec.ts tests/specs/codex-app-server-steer-runtime.spec.ts`
- `pnpm exec tsx --test tests/backend/agent-route.test.ts tests/backend/runtime-dependencies.test.ts`
- `pnpm run typecheck`
- `pnpm run build`

执行阶段默认先运行本提案 `tests/` 下的契约测试。初始失败应来自当前生产源码仍保留旧 Codex exec/OpenAI API 依赖，而不是测试语法或路径错误。

