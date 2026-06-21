# 规格：仓库精简与历史残余清理

约束 lucide、public assets、薄层、历史兼容和脚本资源清理。

## 测试入口

- `pnpm exec tsx --test tests/manual/node-history/repo-simplification-boundary.ts`
- `pnpm exec tsx --test tests/spec/test_suite_taxonomy.ts`

## 需求：系统不得依赖 lucide-react 图标库

项目不得继续依赖或导入 lucide 图标库。

### 场景：依赖清单不包含 lucide-react

- **当** 开发者检查 `package.json`
- **则** `dependencies` 中不得存在 `lucide-react`
- **且** 锁文件不得保留 lucide-react 包解析记录

### 场景：源码不导入 lucide-react

- **当** 执行契约测试扫描 `frontend/`
- **则** 不得发现 `from 'lucide-react'` 或 `from "lucide-react"`
- **且** 不得继续使用 `LucideIcon` 类型

### 场景：保留按钮仍可访问

- **当** 用户使用侧边栏、设置、文件、git、聊天和工作流的保留操作
- **则** 关键按钮必须仍有可访问名称
- **且** 测试应验证行为或 `aria-label`，不得验证图标组件名

## 需求：系统不得引用已删除的 public assets

应用入口不得继续请求已经删除的 public 图标和 logo 文件；PWA 使用的 manifest 与图标必须指向当前存在的 public 资源。

### 场景：HTML 入口不引用失效 favicon

- **当** 浏览器加载 `index.html`
- **则** HTML 不得引用 `/favicon.svg`、`/favicon.png`、`/favicon.ico` 或旧 `/icons/icon-*.png`
- **且** 若发布 PWA 安装入口，必须引用当前存在的 `/manifest.webmanifest` 和 `/pwa/` 图标
- **且** 仍必须保留正常加载前端入口脚本

### 场景：manifest 不引用失效 icons

- **当** 浏览器请求 PWA manifest
- **则** manifest 不得包含指向 `/icons/` 的已删除 icon 列表
- **且** manifest 中每个图标文件必须存在于 `public/`
- **且** manifest JSON 必须保持合法

### 场景：provider 和 auth UI 不引用失效 logo

- **当** 用户打开登录、设置或 provider 选择相关 UI
- **则** 页面不得请求 `/logo.svg`、`/icons/codex.svg`、`/icons/codex-white.svg` 或 `/icons/claude-ai-icon.svg`
- **且** provider 名称仍应以文本或现有非 asset 组件可识别

---

## 需求：精简范围必须限定在 tracked 仓库文件

执行本变更时不得修改 `.gitignore` 已忽略的运行态、缓存、依赖、构建产物或本地工具状态。

### 场景：实现变更不触碰 ignored 路径

- **当** 开发者查看本变更的文件列表
- **则** 所有新增、修改、删除路径都必须来自 `git ls-files` 或将要新增的 tracked 源码/测试/文档路径
- **且** 不得包含 `node_modules/`、`dist/`、`.wo/`、`.agents/cache/`、`.openspec/cache/`、`tests/test-results/`、`authdb/`、数据库文件或日志文件

### 场景：ignored 文件只报告不处理

- **当** 精简扫描发现 ignored 路径中存在旧缓存或生成文件
- **则** 执行阶段可以在总结中说明
- **但** 不得删除、移动或格式化这些 ignored 文件

## 需求：前端源码必须减少无复用薄层

完成后，前端源码中只服务单一调用方的薄层文件应被合并或删除，核心业务域边界仍要保留。

### 场景：单一调用方的子组件被合并

- **当** `view/subcomponents` 下某个组件只被同一目录的一个父组件引用
- **且** 该组件没有独立状态、复杂副作用或复用测试
- **则** 应合并到父组件或同域局部组件文件
- **且** 合并后用户可见 UI 和可访问名称保持不变

### 场景：单一调用方的 types/constants/utils 被合并

- **当** 某个 `types`、`constants` 或 `utils` 文件只服务单个组件
- **则** 应内联到该组件或同域文件
- **且** 不得继续保留只导出一两个局部值的薄壳文件

### 场景：复杂业务域不会被压成大文件

- **当** 文件属于聊天工具渲染、代码编辑器 markdown/mermaid、workflow 详情或 shell 连接管理
- **则** 只有无调用方残余和重复 props 可以删除
- **且** 不得为了减少文件数破坏清晰业务边界

### 场景：上一份提案的残余入口被清理

- **当** lucide 依赖已经移除
- **则** 前端不得保留空的退役 i18n key、props 透传、tab 类型或图标 adapter
- **且** 不得保留只为已删除 public asset 服务的 UI 入口

## 需求：后端源码必须收敛历史兼容和重复 helper

后端应保持项目、会话、workflow、Git、Shell 和 runtime diagnostics 的稳定契约，同时删除已无调用方的迁移残余和重复判断逻辑。

### 场景：项目 read model 响应保持稳定

- **当** 客户端请求项目列表或项目详情
- **则** 项目名称、路径、会话集合、workflow 集合、provider 状态和可见性规则保持兼容
- **且** 不得重新引入上一份提案已删除的项目 metadata

### 场景：会话路由 helper 不重复实现

- **当** 后端处理手动会话、`cN` route、workflow child session 和 provider draft
- **则** 相同的 route/session 判定逻辑应集中在一个可测试 helper 中
- **且** 不得在多个 route 或 read model 文件中保留语义相同的正则和字符串拆分逻辑

### 场景：历史迁移分支只在有测试价值时保留

- **当** 代码中存在 `.ozw`、项目内 `.wo` 或 legacy workflow 字段的兼容读取
- **则** 若仍用于用户数据迁移，必须有对应测试证明
- **否则** 应删除该分支或把它降级为测试夹具中的历史输入

### 场景：runtime diagnostics 不重复查找可执行文件

- **当** 后端检查 oz flow、co、Codex、Pi 等运行依赖
- **则** executable 查找、PATH 诊断和错误格式化应复用同一套工具
- **且** 保持缺失命令时的错误信息可读

## 需求：脚本和 public 资源必须可追溯

仓库保留的脚本和 public 资源必须有明确入口；没有入口的历史资源应删除或移动到测试辅助目录。

### 场景：scripts 文件都有调用来源

- **当** 执行契约测试扫描 `scripts/`
- **则** 每个脚本必须被 `package.json` script、README、源码或测试引用
- **且** 没有引用来源的脚本不得继续留在发布文件集合中

### 场景：public 资源都有静态入口

- **当** 执行契约测试扫描 `public/`
- **则** 每个 public 文件必须被 HTML、manifest、前端源码、后端静态服务或 README 引用
- **且** icon/PWA 生成脚本、缓存清理页和 service worker 退役文件若无入口引用必须删除

### 场景：发布清单不包含测试和历史工具残余

- **当** 开发者检查 `package.json` 的 `files` 字段
- **则** 只应包含运行 ozw 所需的 server、shared、dist、必要 scripts 和文档
- **且** 不应因为历史诊断脚本把无关资源发布出去

---

## 需求：源码中不再包含 `ccflow` 相关标识符

### 场景：开发者在 `frontend/`、`backend/`、`shared/` 中搜索 `ccflow`

- **当** 执行全文搜索（大小写不敏感）
- **则** 结果中不应出现任何函数名、变量名、常量名、环境变量名或正则表达式名包含 `ccflow`/`Ccflow`/`CCFLOW` 的源码行
- **且** 纯历史注释中提及旧项目名称允许保留，但不应出现在活跃标识符中

### 场景：运行环境变量读取逻辑

- **当** server 启动时读取 `TRUST_LOCALHOST_AUTH`
- **则** 应当读取 `OZW_TRUST_LOCALHOST_AUTH` 环境变量，而不是 `CCFLOW_TRUST_LOCALHOST_AUTH`
- **且** co 客户端已在 49 号提案中彻底移除，不应存在 `CCFLOW_CO_HOME` 或 `OZW_CO_HOME` 的读取逻辑

### 场景：前端读取浏览器本地设置

- **当** `settingsStorage.ts` 读取 localStorage 时
- **则** 应当使用常量 `OZW_SETTINGS_KEY`，其值保持为 `'ozw-settings'`
- **且** 其他模块应导入 `readCbwSettings`，而不是 `readCcflowSettings`

## 需求：移除不必要的历史兼容写法

### 场景：设置存储不再回退到已退役的 Claude 设置

- **当** `settingsStorage.ts` 初始化时
- **则** 代码中不应存在 `LEGACY_PROVIDER_SETTINGS_KEY` 常量
- **且** localStorage 中不存在 `ozw-settings` 时不应尝试读取 `claude-settings`，而应直接返回空对象

### 场景：设置控制器不再兼容退役 tab 名称

- **当** `useSettingsController.ts` 的 `normalizeMainTab` 执行时
- **则** 不应再包含对 `tools`、`tasks`、`git`、`api` 的特殊分支映射
- **且** 传入未知 tab 名称时直接回退到 `'appearance'`，无需兼容转换

### 场景：`StandaloneShell` 不再暴露无用的 `compact` 参数

- **当** 查看 `StandaloneShell.tsx` 的 props 类型时
- **则** 不应包含 `compact?: boolean`
- **且** 组件体中不应出现 `void compact` 或 `compact` 的任何使用

### 场景：`MicButton` 不再暴露无用的 `mode` 参数

- **当** 查看 `MicButton.tsx` 的 props 类型时
- **则** 不应包含 `mode?: string`
- **且** 查看 `MicButton` 的唯一调用方 `CommitComposer.tsx` 时不应传入 `mode` 属性

## 需求：清理后现有功能保持完整
