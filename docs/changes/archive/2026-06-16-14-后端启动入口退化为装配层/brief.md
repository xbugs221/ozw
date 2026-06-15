# 简报：后端启动入口退化为装配层

## 用户问题

`backend/server/server-bootstrap.ts` 已经拆出部分 HTTP 和 realtime 模块，但自身仍超过 2000 行，并继续承载直接业务路由、WebSocket path 分派、启动日志和部分 handler 逻辑。后端入口一旦继续膨胀，审查成本和回归风险都会上升。

## 交付目标

把 server bootstrap 收敛为依赖注入、模块注册和生命周期协调层；业务 URL、WebSocket gateway、system update 和启动输出分别进入 typed 子模块。

## 非目标

不修改现有 HTTP URL、WebSocket URL、认证策略或 Provider runtime 行为。

## 验收入口

- `pnpm exec tsx --test docs/changes/14-后端启动入口退化为装配层/tests/server-bootstrap-composition.contract.test.ts`
- `pnpm exec tsx --test tests/specs/backend-type-module-boundary.spec.ts tests/specs/backend-service-test-fixture.spec.ts`

## 执行默认上下文

保留现有 `startBackendServer` 启动语义，分批迁移 direct route、WebSocket gateway 和 startup banner，不做大范围 provider runtime 重写。
