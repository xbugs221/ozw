# 规格：Pi 会话输入控件与模型状态

约束会话模式 Icon、Codex/Pi 模型下拉框、思考深度和失败重试状态。

## 测试入口

- `pnpm exec tsx --test tests/manual/node-history/pi-session-controls-icon-label-contract.test.ts`
- `pnpm exec tsx --test tests/manual/node-history/session-model-controls-direct-select.contract.test.ts`

## 需求：会话模式 Icon 与模型/深度下拉框直接渲染

### 场景：Codex 模式直接显示两个下拉框

- **给定** Codex 会话激活
- **当** 用户查看输入区右侧的会话控制区域
- **则** 必须直接看到两个 `<select>` 下拉框
- **且** 左侧下拉框显示当前模型
- **且** 右侧下拉框显示当前推理深度
- **且** 不能存在 trigger button
- **且** 不能存在浮动弹出面板
- **且** 左侧图标必须显示 ChatGptLogo

### 场景：Pi 模式直接显示两个下拉框

- **给定** Pi 会话激活
- **当** 用户查看输入区右侧的会话控制区域
- **则** 必须直接看到两个 `<select>` 下拉框
- **且** 左侧下拉框的 testid 必须为 `session-model-select`
- **且** 右侧下拉框的 testid 必须为 `session-depth-select`
- **且** 不能存在 trigger button（`session-model-controls-trigger` 不得渲染）
- **且** 不能存在浮动弹出面板
- **且** 左侧图标必须显示 PiLogo（紫色圆形背景，内含 "Pi" 文字）

### 场景：下拉框响应式布局

- **给定** 会话控制区域渲染
- **当** 在桌面端视口宽度 ≥ 640px
- **则** 两个下拉框必须水平排列（`flex-row`）
- **当** 在移动端窄视口（如 390px 宽）
- **则** 两个下拉框必须纵向堆叠以避免右侧被裁剪
- **且** select 宽度在移动端为 `w-28`、桌面端为 `w-32`、宽屏为 `w-36`

## 需求：Pi 模型和思考深度下拉框直接显示

### 场景：Codex 模式下拉框内显示紧凑值

- **给定** Codex 会话激活且 model = gpt-4o, reasoningEffort = medium
- **当** 用户查看模型和推理深度下拉框
- **则** 模型下拉框选项使用紧凑的 label（如 `4o`/`4m` 等）
- **且** 推理深度下拉框显示当前 medium 的值

### 场景：Pi 模式下拉框显示 modelLabel 和 depthLabel

- **给定** Pi 会话激活且 piModel = openai/gpt-4o, piThinkingLevel = medium
- **当** 用户查看模型下拉框和深度下拉框
- **则** 模型下拉框显示当前模型的友好名称（如 GPT-4o）
- **且** 深度下拉框显示 Medium

### 场景：Pi 模式深度为 off

- **给定** Pi 会话激活且 piThinkingLevel = off
- **当** 用户查看深度下拉框
- **则** 深度下拉框选项必须显示 Off

### 场景：Pi 下拉框重复选择去重

- **给定** Pi 会话已选择 piModel = openai/gpt-4o, piThinkingLevel = off
- **当** 用户在下拉框中再次选择相同的模型 openai/gpt-4o 或深度 off
- **则** 不得触发冗余的 model-state PUT 请求
- **且** handleSetPiModel / handleSetPiThinkingLevel 必须在 next value 等于当前值时直接 return

## 需求：失败态与重复操作的状态一致性

### 场景：model-state 持久化失败后前端记录警告

- **给定** Pi 会话模型状态 HTTP PUT 请求返回 500
- **当** 持久化失败
- **则** 前端必须记录可诊断的 `Failed to persist session model state: 500` 控制台警告

### 场景：失败深度持久化不污染刷新后状态

- **给定** Pi 会话选择了 off 深度并成功持久化
- **且** 用户尝试切换到 high 深度但持久化失败（PUT 返回 500）
- **当** 用户刷新浏览器后
- **则** 深度下拉框必须回退到最近成功持久化的 off 状态
- **且** 界面不得显示失败的 high 深度

### 场景：断线失败后重试不重复指令

- **给定** Pi 会话在发送指令时断线
- **当** 重试同一指令
- **则** 该指令仅发送一次（piCommandCount=1）

### 场景：重复提交去重

- **给定** 用户快速重复提交同一输入
- **当** 刷新页面
- **则** 同一输入仅显示一次，不做重复显示
