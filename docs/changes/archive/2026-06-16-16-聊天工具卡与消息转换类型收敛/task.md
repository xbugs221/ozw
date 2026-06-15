# 任务：聊天工具卡与消息转换类型收敛

## 1. 先运行创建阶段契约测试

- [x] 运行 `pnpm exec tsx --test docs/changes/16-聊天工具卡与消息转换类型收敛/tests/chat-tool-message-types.contract.test.ts`
- [x] 确认初始失败来自 parser/工具配置 family 模块缺失或巨型配置仍存在

## 2. 抽出 provider payload parser

- [x] 新建 `providerPayloadParsers.ts`
- [x] 让 `messageTransforms.ts` 和 `sessionMessageMerge.ts` 复用统一 parser

## 3. 拆分工具配置

- [x] 新建工具配置注册表
- [x] 按 shell/file/codex/subagent family 拆分配置
- [x] 保留 `getToolConfig` 和 `shouldHideToolResult` public 行为

## 4. 回归聊天行为

- [x] 运行 chat merge、rendering parity 和 browser spec 相关子集
- [x] 重点检查大 stdout 折叠、file operation 链接、subagent 工具顺序
