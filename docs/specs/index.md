# 规格索引

本文档是 active `docs/specs/` 的导航入口。每个领域列出主要规格、测试入口和源码 owner，审阅者应优先从这里定位当前事实。

## 项目与仓库

- 规格：`repo-simplification.md`、`workspace-git-removal.md`、`project-list-summary-api.md`
- 测试入口：`pnpm exec tsx --test tests/spec/test_suite_taxonomy.ts`、`pnpm exec tsx --test tests/specs/workspace-git-removal.spec.ts`
- 源码 owner：`backend/`、`frontend/`、`tests/`、`scripts/`

## Provider 与 runtime

- 规格：`provider-indexing.md`、`provider-runtime-events.md`、`runtime-dependencies.md`、`provider-live-non-streaming-render.md`、`historical-provider-wording-assets.md`
- 测试入口：`pnpm exec tsx --test tests/specs/provider-runtime-boundary.spec.ts`、`pnpm exec tsx --test tests/specs/provider-live-non-streaming-render.spec.ts`、`pnpm exec tsx --test tests/specs/hermes-readonly-provider.spec.ts`、`pnpm exec tsx --test tests/backend/runtime-dependencies.test.ts`
- 源码 owner：`backend/`、`frontend/`、`tests/specs/`

## Workflow

- 规格：`workflow-compatibility.md`、`wo-workflow-read-model.md`
- 测试入口：`pnpm exec tsx --test tests/backend/wo-workflow-contract.test.ts`、`pnpm exec tsx --test tests/specs/workflow-boundary.spec.ts`
- 源码 owner：`backend/`、`frontend/`、`tests/e2e/`

## 聊天与会话

- 规格：`chat-performance.md`、`chat-composer-runtime.md`、`chat-session-identity.md`、`chat-message-merge-core.md`、`session-attention-board.md`、`codex-app-server-steer.md`、`codex-app-server-history.md`、`terminal-unified-entry.md`、`high-value-module-refactor.md`
- 测试入口：`pnpm exec tsx --test tests/specs/chat-session-identity.spec.ts`、`pnpm exec tsx --test tests/specs/session-attention-board.spec.ts`、`pnpm exec tsx --test tests/specs/terminal-unified-entry.spec.ts`、`pnpm exec tsx --test tests/spec/chat-history-full-text-search.spec.ts`、`pnpm exec tsx --test tests/specs/codex-history-message-order.spec.ts`、`pnpm exec tsx --test tests/specs/high-value-module-refactor.spec.ts`
- 源码 owner：`frontend/`、`backend/`、`tests/spec/`

## Pi 输入与工具卡片

- 规格：`pi-session-controls.md`、`pi-session-recovery.md`、`pi-tool-card-rendering.md`
- 测试入口：`pnpm exec tsx --test tests/e2e/pi-session-61-direct-controls-tool-recovery.spec.ts`、`pnpm exec tsx --test tests/e2e/pi-session-input-tool-rendering.spec.ts`
- 源码 owner：`frontend/`、`backend/`、`tests/manual/`

## 测试与安全

- 规格：`test-suite-taxonomy.md`、`backend-security-boundary.md`、`backend-type-module-boundary.md`、`typescript-tooling.md`、`high-value-module-refactor.md`
- 测试入口：`pnpm exec tsx --test tests/spec/test_suite_taxonomy.ts`、`pnpm exec tsx --test tests/specs/spec-docs-boundary.spec.ts`、`pnpm exec tsx --test tests/specs/backend-security-boundary.spec.ts`、`pnpm exec tsx --test tests/spec/ci-quality-gate-contract.ts`
- 源码 owner：`backend/`、`tests/`、`docs/specs/`
