# 提案：移除OpenAI单次调用并统一Codex-app-server-steer

## 问题

当前代码库已经把 Codex 主路径定义为 app-server runtime，但仍保留旧的单次执行入口：

```text
/api/agent
  -> backend/routes/agent.impl.ts
  -> queryCodex()
  -> backend/openai-codex.ts
  -> codex exec --json
```

这条路径没有 app-server `thread/start`、`turn/start`、`turn/steer`、统一 active turn、统一 live transcript 和 transport 恢复语义。它让维护者必须同时理解两套 Codex 运行方式，并且给后续行为回退留下入口。

附件路由也残留 OpenAI 直连能力：

```text
/api/transcribe-audio
  -> OpenAI Whisper HTTP API
  -> openai npm SDK
  -> gpt-4o-mini 转写增强
```

用户已确认语音转写和增强都不再需要，因此继续保留 `openai` 依赖只会扩大安装、配置和权限面。

## 方案

- 移除 `backend/openai-codex.ts`。
- 把 `/api/agent` 的 Codex 执行调用改为 app-server facade 或一个薄的 `backend/domains/agent/agent-session-runner.ts`，该 runner 内部只能调用 Codex app-server runtime。
- 删除附件路由中的 `/api/transcribe-audio` OpenAI 处理器，或让该入口返回明确的 410/404，并同步移除前端调用入口。
- 从 `package.json` 和 lockfile 移除 `openai` npm 包。
- 更新规格与回归测试，使生产源码中出现旧入口时立即失败。

## 功能变化

- 语音转写和语音文本增强功能被移除。
- `/api/agent` 的 clone、existing project、SSE、non-streaming、branch、PR 外部业务能力应保留。
- Codex 任务执行从单次 `codex exec --json` 变为 app-server thread/turn 模式，运行中输入具备统一 steer 语义。

## 成功标准

- 生产源码没有 `queryCodex`、`openai-codex`、`codex exec --json` 运行路径。
- 生产源码没有 `import('openai')`、OpenAI Whisper transcription URL 或 `openai` npm 依赖。
- `/api/agent` 仍能通过真实路由进入 Codex app-server runner，并保持用户可见结果与完成状态。
- 现有 Codex app-server steer、protocol mapping、provider runtime 边界测试继续通过。

