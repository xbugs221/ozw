# 文件 Tab 完整展示修复记录

## 根因

文件树服务端使用固定集合跳过 `node_modules`、`dist`、`build`、`.git`、`.svn` 和 `.hg`，这与用户希望检查工作区全部内容的需求冲突。文件 Tab 初始请求使用深度 0，展开目录时按需读取下一层，因此移除过滤不会改变默认折叠行为。

## 实现

- 删除固定目录跳过集合及其调用。
- 保留文件 Tab 的 `showHidden: true`，明确展示隐藏条目。
- 保留 `depth=0` 初始加载和展开时的懒加载。
- 更新 helper 边界测试，并增加文件树规格回归场景。

## 验证

- `pnpm run typecheck:node`
- `pnpm run typecheck:web`
- `pnpm run typecheck:test`
- `tsx --test tests/backend/file-routes-boundary.test.ts tests/backend/server-boundary-refactor.test.ts`
- Playwright 文件树规格测试：默认折叠、完整展示，2/2 通过
