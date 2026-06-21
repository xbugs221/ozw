# 任务：移除OpenAI单次调用并统一Codex-app-server-steer

## 1. 先运行创建阶段契约测试

- [x] 运行 `pnpm exec tsx --test docs/changes/30-移除OpenAI单次调用并统一Codex-app-server-steer/tests/codex-runtime-removal-contract.test.ts`
- [x] 确认初始失败来自旧 Codex exec/OpenAI API 残留，而不是测试语法、路径或环境错误。

## 2. 移除 Codex 单次执行路径

- [x] 删除 `backend/openai-codex.ts`。
- [x] 将 `backend/routes/agent.impl.ts` 的 Codex 执行调用改为 app-server runner。
- [x] 保留 `/api/agent` 的 project path、GitHub clone、streaming/non-streaming、branch、PR 业务能力。
- [x] 删除或改写依赖旧模块的 `tests/backend/openai-codex.*.test.ts`。

## 3. 移除 OpenAI 语音和增强依赖

- [x] 删除 `/api/transcribe-audio` 的 OpenAI Whisper/GPT 实现，或改为明确不可用且不触达 OpenAI。
- [x] 删除前端对 `/api/transcribe-audio` 的调用和对应设置入口。
- [x] 确认 `package.json` 不直接声明 `openai`，并记录 Pi native SDK 的传递依赖不在本次范围。

## 4. 更新规格与回归测试

- [x] 更新 `tests/specs/provider-runtime-boundary.spec.ts`，确保 Codex app-server 是唯一生产 Codex 执行路径。
- [x] 更新 `tests/specs/backend-security-boundary.spec.ts` 中对 `backend/openai-codex.ts` 的旧引用。
- [x] 保留或新增 `/api/agent` 业务回归，证明 route 仍能返回 session、状态和完成结果。
- [x] 更新活跃文档，删除旧 OpenAI 单次调用口径。

## 5. 验证

- [x] `pnpm exec tsx --test docs/changes/30-移除OpenAI单次调用并统一Codex-app-server-steer/tests/codex-runtime-removal-contract.test.ts`
- [x] `pnpm exec tsx --test tests/specs/provider-runtime-boundary.spec.ts tests/specs/codex-app-server-protocol-mapping.spec.ts tests/specs/codex-app-server-steer-runtime.spec.ts`
- [x] `pnpm exec tsx --test tests/backend/agent-route.test.ts tests/backend/runtime-dependencies.test.ts`
- [x] `pnpm run typecheck`
- [x] `pnpm run build`
