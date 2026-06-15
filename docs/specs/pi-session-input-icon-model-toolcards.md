# 规格：Pi 会话输入区、恢复与工具卡片索引

本文档保留为 Pi 输入区、消息恢复和工具卡片规格的索引入口，详细需求已拆分到聚焦文档。

## 拆分后的规格

- [Pi 会话输入控件与模型状态](./pi-session-controls.md)
- [Pi 消息恢复与持久顺序](./pi-session-recovery.md)
- [Pi 工具卡片和思考块渲染](./pi-tool-card-rendering.md)

## 需求：Pi 会话输入相关规格必须保持可追踪

### 场景：审阅者按主题进入拆分规格

- Given 审阅者打开原 Pi 输入区规格
- When 需要查找控件、恢复或工具卡片要求
- Then 文档应指向对应拆分规格和测试入口

## 测试入口

- `pnpm exec tsx --test tests/e2e/pi-session-61-direct-controls-tool-recovery.spec.ts`
- `pnpm exec tsx --test tests/e2e/pi-session-input-tool-rendering.spec.ts`
