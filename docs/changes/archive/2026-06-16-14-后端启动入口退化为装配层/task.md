# 任务：后端启动入口退化为装配层

## 1. 先运行创建阶段契约测试

- [x] 运行 `pnpm exec tsx --test docs/changes/14-后端启动入口退化为装配层/tests/server-bootstrap-composition.contract.test.ts`
- [x] 确认初始失败来自 bootstrap 仍直接注册业务 URL、缺少 gateway/system route 模块或体量超界

## 2. 拆出 HTTP system route

- [x] 新建 typed system route 模块
- [x] 保持 `/api/system/update` URL、认证和错误响应不变

## 3. 拆出 WebSocket gateway

- [x] 把 path auth、chat/shell 分派和 unknown path 拒绝移入独立模块
- [x] 保留 chat/shell handler 的既有职责

## 4. 收敛启动输出和生命周期

- [x] 抽离启动 banner 与日志格式
- [x] 让 `server-bootstrap.ts` 只负责注册和 shutdown 顺序
- [x] 运行 backend boundary 和 server fixture 回归

## 执行记录

- 历史回归测试原先要求 bootstrap 直接 import/call 每个业务 route 注册函数；本提案进一步要求 bootstrap 退化为装配层，因此已更新为校验 bootstrap 委托 `backend-http-routes.ts`，再由该边界模块调用具体 HTTP route 模块。
