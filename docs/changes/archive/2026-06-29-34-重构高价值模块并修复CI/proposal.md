# 提案：重构高价值模块并修复 CI

## 为什么要做

聊天入口、消息面板和项目状态 hook 是 ozw 的高价值路径。它们承担真实用户的会话浏览、实时消息、项目刷新和历史导航。一旦这些文件继续膨胀，后续书签、折叠、会话恢复和 CI 修复会相互踩踏，审查成本也会升高。

GitHub CI 最近连续失败，最新确认失败为：

| 项 | 值 |
|---|---|
| run | `28289064798` |
| workflow | `CI` |
| branch | `main` |
| event | `push` |
| failed job | `node-checks` |
| failed step | `Node spec tests` |

本次提案把“高价值模块重构”和“CI 修复”绑定验收，避免只做局部拆文件却没有门禁证明。

## 做什么

```text
重构目标
  |
  +-- ChatInterface.tsx
  |     +-- 搜索定位控制器
  |     +-- session 状态校准控制器
  |
  +-- ChatMessagesPane.tsx
  |     +-- 虚拟窗口/测量控制器
  |     +-- 历史提示和加载 UI 子组件
  |
  +-- useProjectsState.ts
  |     +-- 项目刷新控制器
  |     +-- 选择/会话索引 reducer
  |
  +-- CI
        +-- 本地 test:ci 与 GitHub node-checks 对齐
        +-- 修复 Node spec tests 远端失败
```

## 交付要求

| 类别 | 要求 |
|---|---|
| 模块边界 | 三个高价值入口降为编排层，复杂逻辑进入 focused module |
| 测试 | 新增或更新默认测试，不只保留 change tests |
| 文档 | 更新 durable spec 和 `docs/specs/index.md` |
| CI | 本地 `test:ci` 与 GitHub workflow 一致，并覆盖失败步骤 |
| 证据 | 产出模块审计、CI 门禁审计、文档同步审计和 CI 失败/修复记录 |

## CI 修复策略

- 先记录最近失败 run 和失败步骤。
- 本地运行与 GitHub node-checks 等价的质量门。
- 修复导致 `Node spec tests` 失败的根因。
- 如 CI workflow 与 package scripts 分叉，则新增 `test:ci` 并让 workflow 使用或镜像它。
- 修复后记录新的 GitHub CI 通过 run 元数据。

## 不做什么

- 不用删除断言或跳过测试替代修复。
- 不把重构扩大到无关模块。
- 不修改生产数据或远端环境。
