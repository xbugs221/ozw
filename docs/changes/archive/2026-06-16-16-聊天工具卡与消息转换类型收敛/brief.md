# 简报：聊天工具卡与消息转换类型收敛

## 用户问题

聊天工具卡配置和消息转换承担 Codex/Pi 实时消息、工具调用、文件变更和大输出渲染逻辑，但 `toolConfigs.ts`、`messageTransforms.ts`、`sessionMessageMerge.ts` 中仍有弱类型和重复 payload 解析。新增 provider 事件时容易出现工具卡和消息顺序不一致。

## 交付目标

建立 typed provider payload parser，把工具卡配置按 tool family 拆分，减少 `any` 和重复解析，保持现有聊天渲染、工具折叠和消息归并行为。

## 非目标

不改变聊天 UI 视觉样式，不重写 message merge 核心排序算法。

## 验收入口

- `pnpm exec tsx --test docs/changes/16-聊天工具卡与消息转换类型收敛/tests/chat-tool-message-types.contract.test.ts`
- `pnpm exec tsx --test tests/specs/chat-message-merge-core.spec.ts`
- `pnpm run test:spec:browser`

## 执行默认上下文

优先抽 parser 和配置注册表；每个工具 family 拆出后必须保留真实工具输出样例的渲染测试。
