# 规格：移除 OpenAI 单次调用并统一 Codex app-server steer

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence |
| --- | --- | --- | --- |
| 需求：Codex 生产执行只能进入 app-server | 场景：`/api/agent` 不再调用单次 Codex exec | `codex-runtime-removal-contract`、`agent-route-regression` | `codex-runtime-source-audit` |
| 需求：OpenAI 直连语音能力被移除 | 场景：附件路由不再依赖 OpenAI Whisper 或 GPT SDK | `codex-runtime-removal-contract` | `codex-runtime-source-audit` |
| 需求：依赖和文档口径不再暴露旧能力 | 场景：包依赖、前端调用和规格不再指向 OpenAI 单次路径 | `codex-runtime-removal-contract`、`provider-runtime-regression` | `codex-runtime-source-audit` |

### 需求：Codex 生产执行只能进入 app-server

Codex 任务不允许再通过 `codex exec --json` 或 `backend/openai-codex.ts` 执行。所有生产入口都必须进入 Codex app-server runtime，从而继承 thread/turn、active turn、live transcript 和 `turn/steer` 能力。

#### 场景：`/api/agent` 不再调用单次 Codex exec

- **对应测试**：`docs/changes/30-移除OpenAI单次调用并统一Codex-app-server-steer/tests/codex-runtime-removal-contract.test.ts`
- **真实数据来源**：生产源码中的 `backend/routes/agent.impl.ts`、`backend/domains/codex-app-server/*`、`package.json`。
- **入口路径**：`POST /api/agent` 对应的 route implementation。
- **关键断言**：
  - `backend/openai-codex.ts` 不存在。
  - 生产源码不 import `openai-codex`，不调用 `queryCodex`。
  - 生产源码不构造 `['exec', '--json']` 或等价 `codex exec --json`。
  - `/api/agent` 源码必须引用 Codex app-server runtime 或专用 app-server runner。
- **剩余风险**：源码契约不能证明外部 GitHub PR 流程真实成功，因此还需要 `tests/backend/agent-route.test.ts` 或后续新增 route 回归测试覆盖业务响应。

### 需求：OpenAI 直连语音能力被移除

ozw 不再暴露 OpenAI Whisper 转写和 GPT 文本增强能力，也不再直接依赖 `openai` npm SDK。

#### 场景：附件路由不再依赖 OpenAI Whisper 或 GPT SDK

- **对应测试**：`docs/changes/30-移除OpenAI单次调用并统一Codex-app-server-steer/tests/codex-runtime-removal-contract.test.ts`
- **真实数据来源**：生产源码中的 `backend/server/http/attachment-routes.ts`、前端源码和 `package.json`。
- **入口路径**：附件上传 HTTP route 和前端附件/语音调用点。
- **关键断言**：
  - 生产源码不包含 `https://api.openai.com/v1/audio/transcriptions`。
  - 生产源码不动态或静态导入 `openai` npm SDK。
  - `package.json` 不声明 `openai` 依赖。
  - 前端源码不再调用 `/api/transcribe-audio`。
- **剩余风险**：本场景明确接受功能损失；语音输入未来需要新提案接入本地或其他 provider。

### 需求：依赖和文档口径不再暴露旧能力

活跃规格、测试和依赖必须表达当前事实：Codex 使用 app-server，Pi 使用 native SDK，不再有 OpenAI 单次 Codex 运行时或 OpenAI 语音增强依赖。

#### 场景：包依赖、前端调用和规格不再指向 OpenAI 单次路径

- **对应测试**：`docs/changes/30-移除OpenAI单次调用并统一Codex-app-server-steer/tests/codex-runtime-removal-contract.test.ts`、`tests/specs/provider-runtime-boundary.spec.ts`
- **真实数据来源**：`package.json`、`pnpm-lock.yaml`、`docs/specs/*`、`tests/specs/*`。
- **入口路径**：依赖安装、规格测试和 provider runtime 边界测试。
- **关键断言**：
  - `package.json` 不再直接声明 OpenAI SDK，生产源码不再直接导入 OpenAI SDK。
  - `pnpm-lock.yaml` 可保留 Pi native SDK 的传递依赖；本变更不重写 Pi runtime。
  - 活跃规格不要求 `backend/openai-codex.ts` 继续存在。
  - provider runtime 边界仍证明 Codex 进入 app-server facade。
- **剩余风险**：历史 archive 可保留当时事实；本提案只约束活跃文档和生产源码。
