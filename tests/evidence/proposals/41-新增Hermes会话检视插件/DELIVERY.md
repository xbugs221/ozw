# 41-新增Hermes会话检视插件 交付报告

## 这次给用户带来了什么

- 用户只需安装插件即可在 Hermes Dashboard 检查记录，不必在另一台电脑启动 ozw 或同步数据库。

## 如何验收

### 验收前准备

- 已运行支持 Dashboard Plugin SDK 1.1 的 Hermes Agent。
- 目标会话已经把需要检查的 reasoning 和工具调用写入 state.db。

### 1. 在 Dashboard 检查复杂 Hermes 会话

- 用户价值：用户无需切换产品即可理解 Agent 做过什么、为什么这样做以及工具返回了什么。
- 步骤 1：从 Hermes 会话检视 Tab 搜索目标会话，或直接打开带 profile/session 的深链。
  - 应看到：页面选中目标会话并显示从 compression 父会话到当前子会话的连续 turn。
- 步骤 2：展开过程详情和 raw JSON。
  - 应看到：页面显示已持久化 reasoning、工具名称、参数、结果、错误状态和最终回答。
- 实测：我在 Hermes Dashboard 的“会话检视”页打开指定会话后，看到了从父会话延续到子会话的完整对话；展开后能读到已保存的 reasoning、两个 terminal 调用的参数与结果、失败标记、raw JSON 和最终回答，原生 Sessions 页面仍可正常打开，检视前后的会话内容没有变化，也无需打开 ozw。
- 直接证据：[展示从真实 Dashboard 深链进入 Inspector，展开 reasoning、工具参数、工具结果和 raw JSON。](inspector-browser-demo.webm)、[记录检视前后真实 sessions/messages 业务投影摘要一致，且运行环境未提供 ozw 依赖。](inspector-readonly-state.json)

## 修复前后对比

本次是新增能力，验收重点是上述用户路径和最终可见结果。

## 可直接查看的证据

- [展示从真实 Dashboard 深链进入 Inspector，展开 reasoning、工具参数、工具结果和 raw JSON。](inspector-browser-demo.webm)
- [记录检视前后真实 sessions/messages 业务投影摘要一致，且运行环境未提供 ozw 依赖。](inspector-readonly-state.json)

## 已知限制

- 第一版从独立 Inspector Tab 或深链进入，不在原生 Sessions 每一行注入按钮。
- 插件只读；继续任务、steer、停止和审批仍在 Hermes 原生 Chat/TUI 完成。
- 页面不可能展示模型未输出或未持久化的内部推理。
