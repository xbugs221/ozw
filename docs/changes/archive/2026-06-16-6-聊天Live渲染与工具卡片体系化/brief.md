# 简报：聊天 Live 渲染与工具卡片体系化

## 用户问题

聊天实时渲染曾出现用户气泡不及时变绿、live 回复等 JSONL 完成后才显示、图片工具卡路径不可点击等问题。虽然具体 bug 已修，但状态机、merge 规则、工具卡片配置和 workspace 文件链接仍分散，容易再次回归。

## 交付目标

把聊天 live 渲染、persisted reconcile、deliveryStatus、工具卡片 open-file 行为系统化，形成可测试的状态机和共享配置。

## 非目标

- 不重新设计聊天 UI
- 不改变 provider protocol
- 不移除现有 Markdown renderer
- 不把工具卡片改成复杂新设计系统

## 验收入口

- 契约测试：`pnpm exec tsx --test docs/changes/6-聊天Live渲染与工具卡片体系化/tests/chat-live-tooling.contract.test.ts`
- 回归测试：`pnpm exec playwright test --config=playwright.spec.config.ts tests/spec/chat-composer-runtime.spec.ts`

## 执行默认上下文

先抽状态机和工具配置 helper，再迁移调用点。所有变更必须保留现有用户可见行为：accepted 用户气泡立即绿色、live 内容不等 JSONL、工具路径能打开 workspace 文件。
