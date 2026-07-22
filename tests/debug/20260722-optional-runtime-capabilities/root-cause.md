# 运行依赖不应阻塞整个工作台

## 用户可感知场景

用户只安装部分 Agent 或未安装 `oz` 时，OZW 仍应可启动，并且只能发起已安装 Agent 对应的会话；未安装 `oz` 时应提示工作流不可用。

## 调用链与模块责任

服务启动入口此前调用 `checkRequiredRuntimeDependencies`；运行时诊断 API 提供 CLI 探测结果；项目页和工作流弹窗分别决定会话与工作流入口。

## 关键证据

启动入口会在数据库初始化前强制检查 `oz`。项目页固定渲染 Codex、Pi、Claude Code 按钮，未使用诊断结果。

## 根因与置信度

Confirmed：依赖探测同时承担了“诊断”和“启动门禁”职责，前端未将探测结果映射到可发起的会话类型。

## 修复方案

移除启动门禁；能力报告返回可启动手动会话和工作流布尔值；前端按能力报告展示 Codex、Pi、Claude Code，并在缺少 `oz` 或 Codex 时禁用相应工作流动作和说明原因。Hermes 只读取消息，不属于可发起会话能力。

## 回归测试

`pnpm exec tsx --test tests/backend/runtime-dependencies.test.ts tests/spec/runtime_readiness.ts`

## 验证结果

10 项通过；前端与后端 TypeScript 类型检查通过。

## 阻塞项与剩余风险

Hermes 只读取消息，不属于可新建会话提供方；不在本次前端入口中展示。

## 设置页简化

设置中的智能体子页不参与会话可用性判断，且与运行诊断重复，已移除其标签和面板；安装状态统一由运行诊断与新会话入口表达。
