# 规格：聊天工具卡与消息转换类型收敛

## 验收矩阵

| 场景 | required_tests | required_evidence |
| --- | --- | --- |
| Provider payload 解析只有一个 typed 来源 | chat-tool-message-types | chat-tool-source-audit |
| 工具卡配置按 family 拆分且保留渲染行为 | chat-tool-message-types, chat-rendering-regressions | chat-tool-source-audit |

### 需求：Provider payload 解析必须统一

#### 场景：Provider payload 解析只有一个 typed 来源

- 对应测试：`docs/changes/16-聊天工具卡与消息转换类型收敛/tests/chat-tool-message-types.contract.test.ts`
- 真实数据来源：生产 `messageTransforms.ts`、`sessionMessageMerge.ts`、provider payload parser
- 入口路径：`frontend/components/chat/utils/providerPayloadParsers.ts`
- 关键断言：file update 和 Codex tool update parser 从统一模块导出；message transform 与 merge 都复用该模块；重复私有 parser 不再存在
- 剩余风险：第三方 provider 新事件形态需要后续添加样例

### 需求：工具卡配置必须按业务 family 可审查

#### 场景：工具卡配置按 family 拆分且保留渲染行为

- 对应测试：`docs/changes/16-聊天工具卡与消息转换类型收敛/tests/chat-tool-message-types.contract.test.ts`、`tests/spec/chat-tool-structured-rendering.spec.ts`
- 真实数据来源：生产工具卡配置、真实 chat tool structured rendering 浏览器 spec
- 入口路径：`frontend/components/chat/tools/configs/`
- 关键断言：`toolConfigs.ts` 退化为注册表/兼容导出；shell/file/codex/subagent 配置位于独立模块；`TODO TOOLS` 残留消失
- 剩余风险：视觉细节需由现有 Playwright 截图或人工检查补充
