# 移动端根路由侧栏无法关闭

## 用户可感知场景

在宽度小于 768px 的 ozw 首页 `/` 中，左侧项目导航默认显示。用户点击“隐藏侧边栏”后，导航仍然保持可见，无法独立使用新增的待处理会话看板。

## 调用链与模块责任

```text
AppContent
  → useDeviceSettings: window.innerWidth < 768
  → shouldInlineMobileSidebar = true
  → 根路由渲染强制内联 Sidebar
  → 未传 onCollapseSidebar
  → Sidebar 将关闭操作降级为空函数
```

`AppContent.tsx` 负责侧栏是否渲染及关闭回调；`SidebarHeader.tsx` 的按钮本身正常。

## 关键证据

- 修复前回归测试可稳定复现：点击关闭后 `project-list` 仍为 visible，10 秒超时。
- `AppContent.tsx` 的强制内联分支不依赖 `sidebarOpen`，且渲染 `<Sidebar>` 时没有传入 `onCollapseSidebar`。
- 修复后同一浏览器路径可依次完成“打开→关闭→看板可见→重新打开”。

## 根因与置信度

`Confirmed`。旧首页没有独立工作内容时，移动端根路由会强制内联项目导航。待处理看板上线后，该前提已不成立，但布局分支没有同步移除。

## 修复方案

- 删除移动端根路由的强制内联分支。
- 移动端统一由 `sidebarOpen` 控制侧栏：首页默认显示看板，菜单按钮打开导航，侧栏关闭按钮收起导航。
- 桌面端 `sidebarVisible` 和具体项目工作区的内联布局保持不变。

## 回归测试

- `tests/spec/project-mobile-inline-sidebar.spec.ts`
  - 新增根路由看板侧栏开关场景。
  - 保留项目工作区内联布局、主界面可见性和底部按钮尺寸回归。
  - 将“主界面”断言从旧的固定聊天 Tab 收窄为当前实际激活的移动工作区，兼容会话默认终端 Tab。

## 验证结果

- 针对性 Playwright：4/4 通过。
- `tsc -p tsconfig.web.json --noEmit`：通过。
- `tsc -p tsconfig.test.json --noEmit`：通过。
- 修复后实际服务截图：`screenshots/live-root-board-sidebar-collapsed.png`。

## 阻塞项与剩余风险

无阻塞项。修复只改变小于 768px 时根路由的初始侧栏状态；桌面端和项目内侧栏不受影响。
