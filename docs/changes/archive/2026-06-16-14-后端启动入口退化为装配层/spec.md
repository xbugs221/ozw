# 规格：后端启动入口退化为装配层

## 验收矩阵

| 场景 | required_tests | required_evidence |
| --- | --- | --- |
| 启动入口不再注册业务 URL | server-bootstrap-composition | server-bootstrap-source-audit |
| WebSocket 分派有独立边界模块 | server-bootstrap-composition, backend-boundary-regression | server-bootstrap-source-audit |

### 需求：server bootstrap 只负责装配和生命周期

#### 场景：启动入口不再注册业务 URL

- 对应测试：`docs/changes/14-后端启动入口退化为装配层/tests/server-bootstrap-composition.contract.test.ts`
- 真实数据来源：生产 `backend/server/server-bootstrap.ts` 和 `backend/server/http/*-routes.ts`
- 入口路径：`backend/server/server-bootstrap.ts`
- 关键断言：bootstrap 中没有直接 `app.get/post/put/delete/patch` 注册；system update 在 HTTP route 模块中注册；bootstrap 体量受控
- 剩余风险：静态测试不能证明 child process update 输出全部正确，需要执行阶段结合 server fixture

### 需求：WebSocket 连接边界必须可审查

#### 场景：WebSocket 分派有独立边界模块

- 对应测试：`docs/changes/14-后端启动入口退化为装配层/tests/server-bootstrap-composition.contract.test.ts`、`tests/specs/backend-type-module-boundary.spec.ts`
- 真实数据来源：生产 WebSocket server、chat/shell handler 和认证中间件源码
- 入口路径：`backend/server/websocket-gateway.ts`
- 关键断言：WebSocket path 分派离开 bootstrap；chat/shell handler 保持独立；unknown path 仍明确拒绝
- 剩余风险：浏览器真实断线重连体验需要既有 e2e 补充验证
