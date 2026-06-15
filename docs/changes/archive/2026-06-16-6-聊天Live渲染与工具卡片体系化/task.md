# 任务：聊天 Live 渲染与工具卡片体系化

## 先跑契约测试

- [x] 1. 运行 `pnpm exec tsx --test docs/changes/6-聊天Live渲染与工具卡片体系化/tests/chat-live-tooling.contract.test.ts`
- [x] 2. 确认失败点来自状态机/helper 缺失或重复配置
- [x] 3. 运行现有 `chat-message-merge-core` 回归
- [x] 4. 运行现有 `chat-composer-runtime` 相关 Playwright 用例
- [x] 5. 记录当前工具卡片 open-file 行为截图

## deliveryStatus 状态机

- [x] 6. 新建 `frontend/components/chat/state/deliveryStatusMachine.ts`
- [x] 7. 定义 delivery status 类型和状态迁移函数
- [x] 8. 定义 accepted -> persisted 的迁移
- [x] 9. 定义 pending -> failed 的迁移
- [x] 10. 保留 sent 历史兼容说明
- [x] 11. 将 `markAcceptedUserMessageSent` 改为调用状态机
- [x] 12. 将失败标记逻辑改为调用状态机
- [x] 13. 将 persisted confirmation 改为调用状态机
- [x] 14. 为状态机写 node spec
- [x] 15. 更新 MessageComponent 的状态色彩测试

## live turn merge policy

- [x] 16. 新建 `frontend/components/chat/utils/liveTurnMergePolicy.ts`
- [x] 17. 抽出 accepted optimistic 用户行保留判断
- [x] 18. 抽出 live row 可见判断
- [x] 19. 抽出 empty persisted refresh 保留判断
- [x] 20. 抽出 persisted echo 替换 optimistic row 规则
- [x] 21. 在 `sessionMessageMerge` 中调用 policy
- [x] 22. 在 `useChatSessionState` 中调用 policy
- [x] 23. 增加 Codex live before JSONL reducer 测试
- [x] 24. 增加 Pi live before JSONL reducer 测试
- [x] 25. 增加空 refresh 不清空 live 的测试

## 工具卡片 open-file 配置

- [x] 26. 新建 `frontend/components/chat/tools/configs/openFileToolConfig.ts`
- [x] 27. 定义 `createOpenFileToolConfig`
- [x] 28. 定义 `createImageOpenFileToolConfig`
- [x] 29. 迁移 `view_image`
- [x] 30. 迁移 `functions.view_image`
- [x] 31. 迁移 Read 的文件路径入口
- [x] 32. 迁移 Edit 标题点击配置
- [x] 33. 迁移 FileChanges 的文件列表点击配置
- [x] 34. 保持 path display 使用 project-relative 格式
- [x] 35. 保持真实 onFileOpen 使用原始 path

## ToolRenderer 边界

- [x] 36. 将 ToolRenderer 中文件打开判断降到 helper 配置
- [x] 37. 保留 diffInfo 传递给 Edit
- [x] 38. 给 OneLineDisplay 增加可访问 name 测试
- [x] 39. 给 CollapsibleDisplay 增加 title open 行为测试
- [x] 40. 确认图片工具路径不是普通文本
- [x] 41. 确认 final assistant Markdown 图片链接仍被 workspace link 拦截

## 页面回归

- [x] 42. 更新 `chat-composer-runtime.spec.ts` 使用共享 helper
- [x] 43. 保留用户气泡 green CSS 断言
- [x] 44. 保留 live before JSONL 文本可见断言
- [x] 45. 保留 view_image 点击打开图片预览断言
- [x] 46. 增加 Read 工具路径点击打开文本文件断言
- [x] 47. 增加 Edit 工具路径点击打开 diff 上下文断言
- [x] 48. 运行 `pnpm exec tsx --test tests/specs/chat-message-merge-core.spec.ts tests/specs/chat-rendering-parity.spec.tsx`
- [x] 49. 运行 `pnpm exec playwright test --config=playwright.spec.config.ts tests/spec/chat-composer-runtime.spec.ts`
- [x] 50. 保存 live、tool open、image preview 截图 evidence
