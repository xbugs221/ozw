# 跨项目待处理会话看板

## 用户可感知场景

根路由无法汇总 Codex、Claude Code 和 Pi 的外部会话，用户必须逐项目查看。

## 调用链与模块责任

`Provider JSONL → watcher → provider_session_index → session_attention_ack → 认证 API → 首页看板`

## 关键证据

review/QA 复现了未来观察版本压住真实活动、旧 `pending` 重启复活和同号跨 Provider 误选；历史 v2 回归 1 项失败，原浏览器验收也未真实覆盖跨项目、请求次数与 API 边界。

续轮 review 又复现：现代 `setManualPending(true)` 留下 `legacy_pending_migrated=0`，首次重启的 `migrateLegacyPending(false)` 会清除新待办。

## 根因与置信度

Confirmed：确认游标缺少活动版本上界；旧配置迁移资格没有在所有现代写入路径原子终止；前端选择键缺少 Provider；验收夹具共用项目且网络阶段混杂；v2 历史断言未随 SQLite 真值源迁移。

## 修复方案

事务拒绝未来/非正整数版本；迁移和所有现代确认/待办写入均原子设置 `legacy_pending_migrated=1`；前端统一使用 `provider:sessionId`；根路由合并在途读取。验收改用三个项目及同号跨 Provider 会话，并验证 100/200 边界、无正文、单请求和零 overview。

## 回归测试

SQLite 竞态契约、真实浏览器契约、v2 配置、项目摘要、Provider 索引及类型检查。

## 验证结果

SQLite 7/7、浏览器 1/1、v2 16/16、项目摘要 3/3、Provider 索引 4/4 均通过；三套类型检查通过。截图、网络、控制台和 SQLite 证据由契约生成在 `test-results/42-session-attention-board/`。

## 阻塞项与剩余风险

未执行全量测试；剩余风险是 Provider 文件 mtime 精度及超大历史数据的实际性能，均为 acceptance 已登记风险。
