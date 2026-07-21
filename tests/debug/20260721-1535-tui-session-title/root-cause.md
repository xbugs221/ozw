# TUI 手动会话卡片只显示编号占位标题

## 用户可感知场景

用户打开 `http://127.0.0.1:4001/projects/ozw`，项目首页的 `#479` 手动会话卡片显示“会话479”，未显示首条用户请求。

## 调用链与模块责任

```text
Codex TUI JSONL 首条用户消息
  → Provider 会话索引解析 title/routeTitle
  → Provider 会话与 cN 路由记录合并
  → 项目首页手动会话行选择完整 title
```

## 关键证据

- 修复前，`#479` 的 Provider JSONL 和索引已有真实首条请求，但项目配置中的 `title/routeTitle` 仍为“会话479”。
- 修复前概览接口返回的 `title/routeTitle/summary` 均被路由占位值覆盖。
- TUI 路径只绑定 Provider 会话，不经过 WebSocket 聊天命令的首条请求标题写入。

## 根因与置信度

`Confirmed`：`mergeRoutedProviderSession` 无条件让 cN 路由字段覆盖 Provider 字段，导致生成占位标题覆盖已解析的首条用户请求；项目首页此前又优先使用紧凑 `routeTitle`。

## 修复方案

- 合并时仅把“会话N / cN / New Session”识别为生成占位值，并让 Provider 标题替换它。
- 用户自定义标题继续由路由记录优先，避免改名回归。
- 项目首页手动会话行优先使用完整 `title`，空间不足时再由 CSS 截断。
- 手动会话列表保持纵向单列，默认显示最近 5 条。
- 行内信息顺序为左侧时间、中间标题、右侧编号。

## 回归测试

- `pnpm exec tsx --test tests/specs/provider-session-list-read-model.spec.ts tests/spec/home_session_card_activity_ui.ts`
- `pnpm run typecheck`
- `pnpm run build`

附加运行 `tests/backend/session.rename.test.ts`：24 项中 23 项通过；唯一失败为历史测试仍要求拒绝 Claude 手动会话，与当前已支持 Claude 的产品行为及本次改动无关。

## 验证结果

- 重启 `ozw.service` 后状态为 `active`。
- 真实概览接口中 `#479.title` 恢复为完整首条用户请求，HTTP 200。
- Playwright 打开真实项目页，`#479` 行显示编号、完整可用宽度标题和时间；控制台 0 错误。
- 截图：`screenshots/ozw-479-title-restored.png`。

## 阻塞项与剩余风险

- 无本次修复阻塞项。
- 历史 Claude 拒绝测试应由独立变更按当前产品契约更新。
