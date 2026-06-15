# 规格：聊天输入发送与会话控制面重构

## 验收矩阵

| 需求 | 场景 | required_tests | required_evidence | 真实数据来源 | 关键断言 | 剩余风险 |
| --- | --- | --- | --- | --- | --- | --- |
| Hook 变薄 | 输入/加载业务规则进入小模块 | chat-control-boundary | chat-control-source-audit | 真实聊天 hook 源码 | composer/session 模块存在，hooks 行数和 fetch 逻辑收敛 | 复杂副作用需代码审查 |
| 发送行为稳定 | 新会话、cN route、运行中补充不回退 | chat-composer-runtime、codex-ws-turn-ownership | chat-submit-trace | 现有 composer/runtime specs | command plan 保留 provider 差异 | Pi 外部 SDK 行为需真实运行 |
| 附件队列稳定 | 上传限制和失败提示可测试 | chat-control-boundary | attachment-upload-network | 真实 attachment hook/API | 附件队列模块存在并约束数量/大小 | 大文件浏览器行为需 QA |
| 会话加载稳定 | reload、delta append、上滑加载不重排 | chat-message-merge-core、chat-control-boundary | session-load-snapshot | 真实 message merge tests | loader 不绕过 reducer，保留 append identity | 长会话性能需浏览器证据 |
| 模型控制稳定 | 选择不覆盖用户值且不冗余 PUT | chat-control-boundary、chat-composer-runtime | session-control-log | 真实 SessionModelControls/hook | 控制状态模块存在，重复选择短路 | provider catalog 新字段需后续测试 |
| 文件提及稳定 | @文件搜索和 slash command 不回退 | file-mention-search | file-mention-trace | 现有 file mention specs | 控制面拆分不破坏模糊搜索 | 浏览器键盘交互需 e2e |

### 需求：Hook 变薄

#### 场景：输入/加载业务规则进入小模块

- **给定** 开发者审查聊天 hooks
- **当** 重构完成
- **则** composer、submit、attachment、session loader、scroll anchor 和 recovery 模块必须存在
- **且** `useChatComposerState.ts`、`useChatSessionState.ts` 不再直接承载主要业务规则
- **对应测试**：`docs/changes/11-聊天输入发送与会话控制面重构/tests/chat-control-boundary.contract.test.ts`
- **入口路径**：`pnpm exec tsx --test docs/changes/11-聊天输入发送与会话控制面重构/tests/chat-control-boundary.contract.test.ts`
- **关键断言**：目标模块存在，hooks 行数和 direct fetch/业务 helper 数收敛
- **剩余风险**：复杂副作用仍需人工审查

### 需求：发送行为稳定

#### 场景：新会话、cN route、运行中补充不回退

- **给定** 用户在新会话、manual `cN` route 或运行中会话里发送消息
- **当** 控制面拆分后
- **则** 新会话创建、provider command、Codex steer、Pi follow-up/queue 和 optimistic user message 状态保持稳定
- **对应测试**：`tests/spec/chat-composer-runtime.spec.ts`、`tests/specs/codex-ws-turn-ownership.spec.ts`
- **入口路径**：`pnpm exec playwright test --config=playwright.spec.config.ts tests/spec/chat-composer-runtime.spec.ts`；`pnpm exec tsx --test tests/specs/codex-ws-turn-ownership.spec.ts`
- **关键断言**：发送路径有稳定 command plan，运行中补充不被错误静默排队
- **剩余风险**：Pi SDK 真实运行需 QA

### 需求：附件队列稳定

#### 场景：上传限制和失败提示可测试

- **给定** 用户添加多个文件或粘贴图片
- **当** 附件队列处理文件
- **则** 数量、大小、去重、上传、失败提示和清理规则由 `attachmentQueue` 承载
- **对应测试**：`docs/changes/11-聊天输入发送与会话控制面重构/tests/chat-control-boundary.contract.test.ts`
- **入口路径**：同上
- **关键断言**：附件模块存在并导出业务入口，hook 不直接持有所有限制常量和上传分支
- **剩余风险**：大文件浏览器上传需要 network evidence

### 需求：会话加载稳定

#### 场景：reload、delta append、上滑加载不重排

- **给定** 用户打开长会话、上滑加载旧历史或收到终态 refresh
- **当** 会话加载模块拆分后
- **则** 旧消息引用稳定，新增 delta 只追加，滚动锚点不跳动，terminal reconcile 不重复消息
- **对应测试**：`tests/specs/chat-message-merge-core.spec.ts`、`docs/changes/11-聊天输入发送与会话控制面重构/tests/chat-control-boundary.contract.test.ts`
- **入口路径**：`pnpm exec tsx --test tests/specs/chat-message-merge-core.spec.ts`
- **关键断言**：loader 通过 reducer/merge 入口，不在 hook 内直接拼接主要 transcript
- **剩余风险**：长会话 DOM 性能需浏览器证据

### 需求：模型控制稳定

#### 场景：选择不覆盖用户值且不冗余 PUT

- **给定** 用户选择 Codex/Pi 模型和思考深度
- **当** catalog 异步加载或重复选择同值
- **则** 用户选择不被覆盖，同值选择不触发冗余 model-state PUT
- **对应测试**：`docs/changes/11-聊天输入发送与会话控制面重构/tests/chat-control-boundary.contract.test.ts`、`tests/spec/chat-composer-runtime.spec.ts`
- **入口路径**：同上
- **关键断言**：session control state 模块存在，控制面规则不散落在多个 hook
- **剩余风险**：provider catalog 新字段需新增测试

### 需求：文件提及稳定

#### 场景：@文件搜索和 slash command 不回退

- **给定** 用户在输入框使用 `@` 文件提及或 slash command
- **当** 输入控制面拆分后
- **则** 多 token 文件模糊搜索、键盘选择和命令加载保持稳定
- **对应测试**：`tests/spec/chat_file_mention_search.ts`
- **入口路径**：`pnpm exec tsx --test tests/spec/chat_file_mention_search.ts`
- **关键断言**：控制面拆分不破坏文件提及搜索和命令状态
- **剩余风险**：完整键盘交互需 e2e trace
