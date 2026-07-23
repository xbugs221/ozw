# 首页仍显示 oz flow 内部会话

## 用户可感知场景

真实首页 `/` 显示 `matx · 019f8d89-1ccf-7611-8cef-6441487a0282`，该会话实际属于 oz flow 的 `codex:executor`。

## 调用链与模块责任

`oz flow state.json → workflow_overview_index → sessionAttentionDb.list → 首页`

## 关键证据

浏览器与真实 API 均返回该会话；Provider 索引的 `origin` 为空。实际 run `20260723T055320.832789092Z` 已记录该 session，但 workflow 缓存最新仅到前一个 run。通过真实 UI 打开 matx 项目触发缓存刷新后，该卡片立即从首页消失。

## 根因与置信度

`Confirmed`。服务启动后由外部 oz flow 新建的 run 尚无 watcher；Provider transcript watcher只更新会话索引，没有同步 workflow 所有权索引。

## 修复方案

新 Provider JSONL 的 `add` 事件完成会话索引后，立即同步该项目 workflow 索引，并为新发现的 run 注册 watcher；高频 `change` 事件不重复扫描。

## 回归测试

单元测试锁定 `add → workflow sync → watcher registration` 顺序，并确认 `change` 不重复扫描。

## 验证结果

真实首页刷新缓存后漏项消失；`pnpm run test:ci` 全部通过，提交后再执行干净工作树验证。

## 阻塞项与剩余风险

运行中的 4001 服务需要在提交后由用户确认升级；当前真实首页已通过项目入口刷新缓存并确认漏项消失。
