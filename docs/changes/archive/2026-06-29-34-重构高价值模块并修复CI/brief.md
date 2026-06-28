# 重构高价值模块并修复 CI 简报

## 用户问题

当前仓库的高价值模块仍有重新膨胀风险，尤其是聊天会话入口、消息面板和项目状态 hook。这些模块直接影响会话浏览、实时消息、项目刷新和后续提案落地。同时 GitHub CI 最近连续失败，最新确认的失败 run 为 `28289064798`，失败步骤是 `Node spec tests`。

## 交付目标

- 选定并重构高价值模块：`ChatInterface.tsx`、`ChatMessagesPane.tsx`、`useProjectsState.ts`。
- 将搜索定位、状态校准、消息面板布局、项目刷新/选择状态拆到可测试控制器或运行时模块。
- 更新 durable 规格、索引文档和默认测试，避免只依赖一次性 change tests。
- 修复 GitHub CI/CD 失败，并让本地与远端 CI 使用同一质量门语义。
- 保留用户可见行为：聊天、项目列表、会话历史、消息定位和实时刷新不得退化。

## 非目标

- 不重写聊天渲染架构。
- 不改变 API URL、WebSocket message type 或项目配置格式。
- 不把 browser e2e 全量强塞进当前 GitHub node-checks 工作流。
- 不为通过 CI 新增无条件 skip、条件跳过或放宽现有断言。

## 验收入口

- `pnpm exec tsx --test docs/changes/34-重构高价值模块并修复CI/tests/high-value-module-boundary.acceptance.test.ts`
- `pnpm exec tsx --test docs/changes/34-重构高价值模块并修复CI/tests/ci-quality-gate.acceptance.test.ts`
- `pnpm exec tsx --test docs/changes/34-重构高价值模块并修复CI/tests/docs-tests-sync.acceptance.test.ts`

## 执行阶段默认上下文

```text
高价值模块
  |
  +-- ChatInterface.tsx       聊天会话协调、搜索定位、状态校准
  +-- ChatMessagesPane.tsx    消息虚拟滚动、历史加载入口、面板布局
  +-- useProjectsState.ts     项目列表、刷新、选择和会话索引状态
  +-- .github/workflows/ci.yml
        GitHub node-checks 质量门
```

执行时必须先复现或记录 GitHub CI 最近失败，再修复源码、测试和文档，并用本地 CI 等价命令证明修复。
