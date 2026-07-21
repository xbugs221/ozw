# 跨项目待处理会话看板

## 目的

根路由提供跨项目、跨 Provider 的轻量待处理会话看板。Codex、Claude Code 与 Pi 的前端会话和外部终端会话统一经 Provider 会话索引进入 SQLite 读模型，不由前端扫描文件或逐项目读取会话明细。

## 长期行为

- 待处理身份使用 `(provider, sessionId)`，同号跨 Provider 会话必须保持独立。
- 列表查询最多返回 100 条，不包含消息正文；根路由只请求一次待处理列表，不请求逐项目 `overview`。
- 打开、刷新或重启不会自动处理会话。只有显式“处理完成”才写入用户已观察到的活动版本。
- 单次批量处理最多 200 条并使用一个 SQLite 事务；它不删除 Provider 会话历史。
- 若确认期间到达更高活动版本，确认游标只能停在已观察版本，会话继续待处理。
- 非正整数、非安全整数或高于当前活动版本的观察版本必须被拒绝。
- 新活动提高 `activity_revision` 后，已处理会话重新出现；手动待处理与确认状态以 SQLite 为唯一真值源。
- 旧项目配置中的 `pending` 只迁移一次。任何现代确认或手动待处理写入都终止旧配置迁移资格，重启不得覆盖新状态。

## 稳定验证

- SQLite 版本、批量确认、并发活动和迁移契约：`tests/specs/session-attention-board.spec.ts`
- 项目清单轻量边界：`tests/spec/project-list-summary-api.spec.ts`
- 三 Provider 文件、监听器、认证接口与首页的完整历史验收：`docs/changes/archive/2026-07-21-42-构建跨项目待处理会话看板/tests/provider-files-and-board.acceptance.spec.ts`

## 已知风险

Provider 文件落盘存在短暂最终一致延迟；极大历史索引的实际耗时仍受本地数据规模影响，因此列表上限和索引查询计划是长期约束。
