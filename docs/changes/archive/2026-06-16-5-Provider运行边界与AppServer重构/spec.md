# 规格：Provider 运行边界与 AppServer 重构

## 验收矩阵

| 场景 | required_tests | required_evidence |
| --- | --- | --- |
| Codex 只能通过 app-server runtime | `provider-runtime-boundary-contract` | `provider-runtime-source-audit` |
| cN route 与 provider session 绑定集中管理 | `provider-session-binding-contract` | `provider-binding-state` |
| active-turn overlay 与 live snapshot 生命周期分离 | `active-turn-live-store-contract` | `active-turn-runtime-log` |

### 需求：Provider runtime 主路径边界清晰

#### 场景：Codex 只能通过 app-server runtime

- **给定** 用户在手动聊天页选择 Codex
- **当** 后端处理 `codex-command`
- **则** 命令必须进入 Codex app-server facade
- **并且** 生产源码不得导入 `@openai/codex-sdk`
- **测试文件**：`docs/changes/5-Provider运行边界与AppServer重构/tests/provider-runtime-boundary.contract.test.ts`
- **真实数据来源**：真实 backend 源码
- **入口路径**：源码边界审计与 app-server 现有规格测试
- **关键断言**：runtime-router 存在；Codex adapter 调用 app-server；旧 SDK import 不存在
- **剩余风险**：不验证真实外部 Codex 账号

### 需求：Route session 与 provider session 绑定单一职责

#### 场景：cN route 与 provider session 绑定集中管理

- **给定** 一个 cN route session 已绑定 provider session id
- **当** websocket、messages API、complete reconcile 和 abort 查询绑定
- **则** 都必须通过 `provider-session-binding` 模块
- **并且** 不允许多个模块各自拼装绑定字段
- **测试文件**：`docs/changes/5-Provider运行边界与AppServer重构/tests/provider-runtime-boundary.contract.test.ts`
- **真实数据来源**：真实 route runtime 源码和 session messages handler 源码
- **入口路径**：源码边界审计
- **关键断言**：绑定读写函数存在；主要调用点导入并使用该模块
- **剩余风险**：底层持久化格式保持现状

### 需求：运行态恢复和完成清理可推理

#### 场景：active-turn overlay 与 live snapshot 生命周期分离

- **给定** provider turn 正在运行并产生 live transcript
- **当** 页面刷新、complete、abort 或 error 发生
- **则** active-turn overlay 和 live snapshot 必须按各自生命周期清理
- **并且** complete 后 JSONL 读到真实历史时 live snapshot 不再作为权威历史
- **测试文件**：`docs/changes/5-Provider运行边界与AppServer重构/tests/provider-runtime-boundary.contract.test.ts`
- **真实数据来源**：真实 active-turn/live transcript 源码和现有 regression tests
- **入口路径**：源码边界审计与现有 provider runtime tests
- **关键断言**：两个 store 模块分离；complete/abort/error 均有清理路径；消息读取只在缺 JSONL 时使用 snapshot
- **剩余风险**：外部 provider 写盘延迟仍由现有 live-before-JSONL 策略兜底
