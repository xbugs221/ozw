# 规格：工作区 Git 功能移除

## 需求：工作区不得继续暴露 Git 功能

主工作区删除 Git 功能后，不得留下用户可见入口、可恢复的旧 dock 状态、Git panel 源码树或后端 `/api/git` API。

### 场景：工作区入口和源码契约不包含 Git

- **给定** 用户打开桌面或移动工作区
- **当** 工作区渲染主 tab、标题和 dock 布局
- **则** 不得显示 Git tab 或 GitPanel
- **且** 源码中不得保留 `frontend/components/git-panel`
- **且** workspace layout 状态模型不得接受 `git` panel

### 场景：后端不再支持 Git API

- **给定** 后端服务加载 API route
- **当** 用户或旧客户端访问 `/api/git`
- **则** 服务端不得挂载 Git route
- **且** `backend/routes/git.ts` 不得存在

### 场景：旧 Git 布局状态安全降级

- **给定** 浏览器本地状态仍保存旧 `activeTab=git` 或右侧 Git dock
- **当** 用户重新进入工作区
- **则** active tab 必须降级到仍支持的工作区 tab
- **且** 右侧 dock 不得恢复空白 Git 面板

对应规格测试：

- `tests/specs/workspace-git-removal.spec.ts`
- `tests/spec/workspace-git-removal-evidence.spec.ts`
