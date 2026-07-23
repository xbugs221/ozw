# TUI 缺少剪贴板截图快捷上传

## 用户可感知场景

电脑或手机进入会话的 TUI 后，只能从文件选择器上传图片，无法通过一个按钮直接读取剪贴板截图并把临时路径填入当前输入行。

## 调用链与模块责任

`ChatInterface` 负责 TUI 顶栏和终端输入通道；`clipboardImageFiles` 只筛选、转换剪贴板图片；现有 `/upload-attachments` 接口负责保存到 `~/ozw-uploads/<用户>/<批次>/` 并返回绝对路径。

## 关键证据

- 旧界面只有 `chat-tui-upload-attachment-button`，没有剪贴板读取入口。
- 普通聊天输入框已有粘贴图片逻辑，但 TUI-first 页面不渲染该输入框。
- 真实浏览器上传返回 HTTP 200，文件保存为 `/home/zzl/ozw-uploads/2/1784788442230-b976370c/01be51919bebc1925950.png`。

## 根因与置信度

Confirmed：TUI 顶栏未接入浏览器剪贴板图片读取能力，现有临时上传和终端路径插入能力本身正常。

## 修复方案

新增“粘贴截图”按钮；在明确的用户点击动作中调用浏览器剪贴板接口，仅保留 `image/*`，复用原上传接口和终端输入通道。纯文本等非图片内容静默忽略；不支持或无权限时显示提示。

## 回归测试

- `tests/spec/chat-tui-clipboard-image.test.ts`：验证按钮和路径插入链路、只转换图片、忽略文本和无图片场景。

## 验证结果

- `pnpm run typecheck:web`：通过。
- `pnpm run typecheck:test`：通过。
- 剪贴板单元测试：2/2 通过。
- 真实 Chrome：剪贴板 PNG 上传返回 200，绝对路径已写入 TUI。
- 390×844 手机视口：剪贴板与文件上传按钮均可见，按钮尺寸均为 32×28。
- 截图：`screenshots/desktop-tui-clipboard-upload.png`、`screenshots/mobile-tui-clipboard-button.png`。

## 阻塞项与剩余风险

浏览器剪贴板读取依赖安全上下文和用户授权；不满足条件时会提示用户，原文件选择上传入口仍可使用。历史边界测试另有 2 个与本次无关的既存源码正则断言失败。
