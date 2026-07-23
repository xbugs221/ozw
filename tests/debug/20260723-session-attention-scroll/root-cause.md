# 首页待处理会话刷新后滚动回顶

## 用户可感知场景

用户在首页向下浏览待处理会话时，只要后台会话继续产生内容，看板就会刷新并跳回顶部。

## 调用链与模块责任

`Provider 会话变化 → WebSocket session_changed → SessionAttentionBoard.load → 待处理接口 → 列表更新`

## 关键证据

真实首页浏览器回归把看板滚动到 `scrollTop=320`，注入服务端同格式失效事件并等待真实接口返回；修复前滚动位置稳定变成 `0`。

## 根因与置信度

`Confirmed`：每次失效刷新都把 `isLoading` 设为 `true`，React 因条件渲染卸载滚动容器、改挂加载提示；请求完成后创建的新容器从顶部开始。

## 修复方案

仅首屏使用初始加载态。后台刷新继续请求并更新数据，但保持原列表滚动容器挂载。

## 回归测试

`tests/e2e/session-attention-scroll-preservation.spec.ts`

## 验证结果

修复前用例失败且读到 `scrollTop=0`；修复后同一用例通过，刷新后仍大于 `100`。视觉证据见 [scroll-preserved.png](screenshots/scroll-preserved.png)。

## 阻塞项与剩余风险

无。用户主动“处理完成”造成列表缩短时，浏览器仍会按正常布局规则调整位置。
