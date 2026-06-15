# 提案：历史口径文档与测试资产收敛

## 背景

项目经历过 Claude/co、Codex SDK、Codex app-server、Pi native SDK 多轮演进。当前主路径已经改变，但文档和测试资产里仍有旧称呼和旧目录结构。维护者搜索时容易看到冲突结论。

## 变更内容

```
active docs/specs/tests
  ├─ 当前口径统一
  ├─ 旧 co/Codex SDK 边界测试
  ├─ manual/browser-history 资产筛选
  └─ README 命令说明更新
```

执行阶段应建立 legacy wording boundary test，避免旧词重新进入活跃文档和生产源码。

## 成功标准

- active docs 不再把 Codex 描述为 SDK Thread/runStreamed
- 当前测试标题不再用过期 `native-sdk` 表达 Codex app-server
- manual/browser-history 目录中的测试被分类：迁移、保留并说明、删除
- README 明确 spec/e2e/manual 的职责边界
