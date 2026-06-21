# 提案：收敛核心架构债和性能边界

## 问题

本次审查发现的问题分布在多个热点文件，但根因相互关联：共享业务逻辑边界不清、巨型运行时承载过多职责、后端入口类型保护不足、性能热点缺少明确契约。若把这些问题拆成多个小提案，会出现一个提案拆 shared、另一个提案再拆 runtime、第三个提案再补测试的重复迁移成本。

## 变更目标

1. 建立 provider transcript 的 shared 核心模块，前端和后端都只依赖 shared。
2. 把 chat session、realtime、composer 的复杂 hook 拆成稳定控制器和纯状态模块。
3. 把 project overview 的手动 session、workflow、批量选择和 actions 从主 runtime 中拆出。
4. 把 agent route 的认证、路径解析、GitHub 操作、session runner 和响应写入拆为后端领域模块。
5. 把 server runtime 的启动生命周期、watcher、项目索引回填、HTTP route deps 拆分并类型化。
6. 把 tool config registry 按工具族拆分，收敛公开 `any` 和手写别名判断。
7. 把全量消息拉取改为分块加载，把项目刷新比较改为稳定签名。

## 为什么是一个提案

这些工作都会触碰核心运行时和测试基线。统一执行可以让 shared 边界、后端类型边界、性能契约和回归测试在一次迁移中闭环，避免中间状态反复适配。

## 成功标准

- 核心热点文件规模下降到可维护预算内。
- 后端不再从 frontend 导入业务 reducer。
- 安全敏感入口没有 `@ts-nocheck`。
- HTTP route deps、agent route 和工具配置拥有可审查的类型边界。
- 性能热点有源码契约测试覆盖，避免回退到无限量全量加载和深层 JSON 序列化比较。

