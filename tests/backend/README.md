# 后端测试导读

## 业务场景

`tests/backend` 覆盖后端 API、会话读模型、Provider 运行态、文件系统状态和无需浏览器即可验证的服务端业务合同。这里的测试重点是证明前端或外部调用者拿到的数据可信，而不是只检查某个函数能返回 200。

## 运行命令

```bash
pnpm run test:server:smoke
pnpm run test:server
```

`pnpm run test:server:smoke` 只运行关键服务端业务 smoke 子集，用于快速确认 Pi 消息读取、Pi sessions read model、Provider 会话绑定和 sessions discovery 没有退化。它不是完整后端回归。

`pnpm run test:server` 运行 `tests/backend/*.test.ts`，覆盖完整后端 Node 回归，是默认 `pnpm run test` 的一部分。

## 失败含义

后端测试失败通常意味着用户可见的数据链路有风险：会话列表可能缺失，消息详情可能读不到，Provider 状态可能错绑，或者服务端 API 合同与前端预期不一致。优先检查真实读写路径、临时 HOME/XDG 状态隔离和 API 返回结构。

## 新增测试

新增测试应放在这里，当它验证的是后端 API、读模型、运行态事件归档、Provider 会话绑定或磁盘状态恢复。若必须打开真实页面或验证浏览器交互，应放入 `tests/e2e` 或 `tests/spec` 的浏览器入口。
