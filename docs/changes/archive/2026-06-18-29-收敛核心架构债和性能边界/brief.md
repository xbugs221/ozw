# 29 - 收敛核心架构债和性能边界

## 背景

当前代码审查发现多处高价值重构点集中在核心运行时、后端安全边界、工具配置注册表和性能热点上。单独拆成多个小提案会产生大量交叉依赖，因此本提案统一覆盖这些问题，并用源码契约测试锁定重构目标。

## 目标

- 切断 provider runtime 对前端 chat 工具的反向依赖，把 transcript reducer 和类型下沉到 shared。
- 拆分 chat runtime、project overview runtime、agent route、server runtime 和 tool config registry 的巨型模块。
- 移除关键后端入口的 `@ts-nocheck` 和宽泛 `any` 依赖。
- 优化 `loadAllMessages` 全量拉取与项目刷新比较的性能边界。
- 保留已有效的文件提及按需扫描和消息虚拟化保护。

## 非目标

- 不改变现有 UI 视觉风格。
- 不重写聊天协议、provider 协议或项目数据模型。
- 不引入新的状态管理框架。
- 不把现有业务流程迁移到新的后端服务。

## 验收入口

- `pnpm exec tsx --test docs/changes/29-收敛核心架构债和性能边界/tests/core-boundary-contract.test.ts`
- `pnpm exec tsx --test docs/changes/29-收敛核心架构债和性能边界/tests/performance-boundary-contract.test.ts`
- `pnpm run typecheck`
- `pnpm exec tsx --test tests/specs/chat-message-merge-core.spec.ts tests/specs/backend-type-module-boundary.spec.ts tests/backend/agent-route.test.ts`
- `pnpm exec vitest run --config vitest.config.ts tests/unit/chat-tool-runtime.test.ts`
- `pnpm exec playwright test tests/e2e/project-overview-real-performance.spec.ts`
- `pnpm run build`

仓库 `oz-flow.yaml` 的 validation 必须包含上述边界命令，避免重构只完成文件拆分但没有证明系统仍可运行。
