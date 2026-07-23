# 含小数点项目无法连接终端

## 用户可感知场景

访问 `/projects/ald_proj/atom-number-1.9/c1` 时，会话历史接口正常，但终端 WebSocket 无法建立可用的 tmux 会话。

## 调用链与模块责任

浏览器项目路由 → Shell WebSocket → `createTmuxSessionName` → `tmux new-session`。

## 关键证据

- 旧逻辑生成 `ozw_ald_proj_atom-number-1.9_c1`。
- tmux 对该名称返回 `invalid session name`。

## 根因与置信度

Confirmed：名称清洗白名单错误保留了 tmux 禁止的 `.`；`:` 已被替换，但缺少覆盖其他特殊字符的契约测试。

## 修复方案

仅允许字母、数字、下划线和连字符；其余字符统一替换为下划线。

## 回归测试

`tests/backend/terminal-tmux-runtime.test.ts` 覆盖小数点，以及冒号、空白、Unicode、括号和 shell 符号。

## 验证结果

- 专项回归、Node/测试类型检查和生产构建通过。
- `ozw.service` 已重启，健康检查通过。
- 真实 URL 加载后无浏览器错误，创建的 tmux 名为 `ozw_ald_proj_atom-number-1_9_c1`。
- tmux 会话存在，Shell PTY 成功启动；见 `screenshots/after-restart.png`。

## 阻塞项与剩余风险

完整 `terminal-unified-entry.spec.ts` 有一个与本修复无关的既有源码形状断言失败；本次独立回归测试不受影响。
