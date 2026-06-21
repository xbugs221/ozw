# 设计：统一 Codex app-server runtime 并移除 OpenAI 直连

## 关键决策

### 1. 删除旧 Codex 单次执行模块

`backend/openai-codex.ts` 不再保留为兼容层。保留一个同名 facade 会继续暗示旧语义可用，也容易让新代码重新 import `queryCodex`。执行阶段应删除该文件，并把必要的通用小函数迁到更准确的模块。

### 2. `/api/agent` 只保留业务外壳

`/api/agent` 仍负责外部 agent API 的业务外壳：

```text
HTTP /api/agent
  -> API key / platform auth
  -> project path 或 GitHub clone
  -> Codex app-server runner
  -> 可选 branch / PR
  -> SSE 或 JSON 响应
```

其中 Codex 执行部分必须进入 app-server runner。runner 可以适配 SSE writer 和 response collector，但不得 spawn `codex exec` 或复用旧 `queryCodex`。

### 3. OpenAI 语音能力直接移除

本变更不做替代转写服务。`/api/transcribe-audio` 的 OpenAI Whisper 和 GPT 增强路径应被删除；如果为了前端兼容短期保留 HTTP route，必须返回明确的不可用状态，并且不能依赖 OpenAI API key、OpenAI URL 或 `openai` npm SDK。

### 4. app-server steer 是唯一 Codex 运行中输入模式

Codex 已有 app-server steer 规格。本变更不重新定义 steer，只要求任何新旧 Codex 入口最终都落到 app-server runtime，避免单次 exec 绕开 active turn。

## 风险

- `/api/agent` 旧的 non-streaming collector 可能依赖 `codex-complete` 或旧 event shape；执行阶段需要用真实 route 测试确认响应仍包含最终结果和 session id。
- 删除转写入口可能留下前端按钮或设置项；执行阶段需要源码契约覆盖前端不再调用 `/api/transcribe-audio`。
- `pnpm-lock.yaml` 仍可能因 Pi native SDK 的传递依赖包含 OpenAI SDK；本提案只禁止 ozw 生产源码、Codex 路径和语音路径直接依赖 OpenAI SDK。

## 证据

契约测试写入 `test-results/30-remove-openai-single-runtime/source-audit.json`，记录旧 Codex 路径、OpenAI 依赖、附件路由、前端调用点的审计结果。该文件是本地验收产物，不进入版本控制。
