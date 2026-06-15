# 依赖与工具规格

## 需求：系统不得包含 TaskMaster 后端能力

系统不得继续暴露 TaskMaster API、项目探测或 WebSocket 事件分支。

### 场景：后端不注册 TaskMaster 路由

- **当** 开发者阅读后端入口
- **则** 不得存在 `/api/taskmaster` 路由注册
- **且** 不得导入 `backend/routes/taskmaster.js`

### 场景：项目 read model 不再包含 TaskMaster metadata

- **当** 客户端请求项目列表或项目详情
- **则** 返回项目对象不得包含 `taskmaster` 专属字段
- **且** 后端不得扫描项目目录中的 `.taskmaster` 来生成 ozw 项目状态

### 场景：WebSocket 不再广播 TaskMaster 事件

- **当** 后端处理实时消息
- **则** 不得生成或转发 `taskmaster-*` 专属事件
- **且** 前端聊天实时处理不得把 `taskmaster-*` 作为全局项目刷新事件

## 需求：系统不得包含 TaskMaster 前端入口

用户界面不得再出现 tasks tab、TaskMaster 设置、TaskMaster banner 或侧边栏 TaskMaster 指示器。

### 场景：应用启动不再挂载 TaskMaster providers

- **当** 前端应用渲染根组件
- **则** provider 树中不得包含 `TaskMasterProvider`
- **且** 不得包含 `TasksSettingsProvider`

### 场景：工作区不显示 tasks tab

- **当** 用户进入任意项目工作区
- **则** tab 列表只显示保留的核心工作区入口
- **且** 不得显示 TaskMaster 或 tasks 入口

### 场景：旧 tasks 状态不会导致空白主视图

- **当** 历史本地状态或旧链接要求打开 `activeTab=tasks`
- **则** 应回落到保留的可用视图
- **且** 主内容区不得因为已删除面板而空白

### 场景：聊天空态不显示 NextTaskBanner

- **当** 用户在项目中打开聊天空态
- **则** 页面不得出现初始化 TaskMaster、下一任务或生成任务的提示
- **且** 聊天输入和 provider 选择仍可正常使用

### 场景：设置页不显示 tasks 设置

- **当** 用户打开设置页
- **则** 不得出现 TaskMaster 安装状态、启用 TaskMaster 集成或 tasks 设置入口
- **且** 历史调用 `initialTab=tasks` 时必须落到现有保留设置页

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

应用入口不得继续请求已经删除的 public 图标和 logo 文件。

### 场景：HTML 入口不引用失效 favicon 和 apple icons

- **当** 浏览器加载 `index.html`
- **则** HTML 不得引用 `/favicon.svg`、`/favicon.png` 或 `/icons/icon-*.png`
- **且** 仍必须保留正常加载前端入口脚本

### 场景：manifest 不引用失效 icons

- **当** 浏览器请求 `manifest.json`
- **则** manifest 不得包含指向 `/icons/` 的已删除 icon 列表
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
- **且** 不得包含 `node_modules/`、`dist/`、`.wo/`、`.taskmaster/`、`.agents/cache/`、`.openspec/cache/`、`tests/test-results/`、`authdb/`、数据库文件或日志文件

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

- **当** TaskMaster 和 lucide 依赖已经移除
- **则** 前端不得保留空的 TaskMaster/tasks i18n key、props 透传、tab 类型或图标 adapter
- **且** 不得保留只为已删除 public asset 服务的 UI 入口

## 需求：后端源码必须收敛历史兼容和重复 helper

后端应保持项目、会话、workflow、Git、Shell 和 runtime diagnostics 的稳定契约，同时删除已无调用方的迁移残余和重复判断逻辑。

### 场景：项目 read model 响应保持稳定

- **当** 客户端请求项目列表或项目详情
- **则** 项目名称、路径、会话集合、workflow 集合、provider 状态和可见性规则保持兼容
- **且** 不得重新引入上一份提案已删除的 TaskMaster metadata

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

## 需求：TypeScript 检查和构建必须可拆分且可复用缓存

ozw 应保留全量类型安全，同时为不同源码边界提供可单独运行的类型检查入口，并让重复检查和服务端构建复用显式增量缓存。

### 场景：开发者按源码边界运行类型检查

- **当** 开发者查看 `package.json`
- **则** 应存在 `typecheck:web`、`typecheck:node`、`typecheck:test`
- **且** 根 `typecheck` 应串联这些入口

### 场景：TypeScript 缓存不会污染提交

- **当** 开发者重复运行类型检查或服务端构建
- **则** TypeScript 缓存应落到 `.tmp/tsbuildinfo/`
- **且** `.tmp/` 应被 git 忽略

### 场景：服务端构建仍产出发布入口

- **当** 开发者执行 `pnpm run build:server`
- **则** 服务端产物仍应由 `tsc -p tsconfig.build.json` 生成
- **且** `tsconfig.build.json` 仍应输出到 `dist-node`

## 需求：精简后核心用户路径必须保持可用

本次精简不得破坏 ozw 当前核心使用路径。

### 场景：主工作区仍能完成常用操作

- **当** 用户进入一个已有项目
- **则** 可以打开聊天、发送消息、切换 provider、查看历史会话、打开文件树、编辑文本文件和打开 Shell
- **且** 页面不得因为被合并组件或删除资源出现空白区域

### 场景：workflow 详情仍能展示

- **当** 项目包含 oz workflow 运行记录
- **则** workflow 列表、阶段进度、artifact 链接、child session 链接和详情页仍按 read model 展示
- **且** 不得读取 ignored 的项目内 `.wo/runs` 作为当前事实来源

### 场景：设置页和诊断仍能定位运行依赖问题

- **当** oz flow、co 或 provider CLI 缺失
- **则** 设置页和后端 diagnostics 仍返回明确的缺失命令、检查动作和 PATH 信息
- **且** 不得因为合并 helper 丢失 provider 维度

## 需求：运行依赖自检覆盖 oz、Codex 和 Pi

运行依赖诊断应提供统一 read model，让新用户一次性看到服务进程能否找到 oz、Codex、Pi，以及下一步安装或登录动作。

### 场景：三类 CLI 都出现在同一诊断报告中

- **当** 后端构建 runtime readiness 报告
- **则** 返回结构必须包含 `oz`、`codex`、`pi`
- **且** 每项必须包含 command path、version、error 和 required action

### 场景：Codex/Pi 登录状态未知时给出明确动作

- **当** Codex 或 Pi CLI 可执行但登录状态无法确认
- **则** 对应 `authenticated` 应为 `unknown`
- **且** `requiredAction` 必须分别提示 `codex login` 或 `pi login`

## 需求：oz flow 合同继续决定工作流可用性

oz CLI 可执行不代表 workflow 可运行；runtime readiness 必须继续复用 `oz flow contract --json` 的能力检查。

### 场景：`oz flow` 合同仍然参与 ready 判定

- **当** `oz flow contract --json` 缺少 `run`、`resume`、`status`、`abort` 任一能力
- **则** 整体 `ready` 必须为 false
- **且** oz 诊断错误必须说明缺失能力

## 需求：源码说明和测试必须跟随重构移动

合并或移动源码时，业务目的说明和测试必须同步更新。

### 场景：新增或移动源码保留文件目的说明

- **当** 执行阶段新增或移动前端、后端、shared 源码文件
- **则** 文件开头必须说明该文件的业务目的
- **且** 非平凡函数必须保留能解释业务逻辑的 docstring

### 场景：测试不只检查组件存在

- **当** 更新前端测试
- **则** 测试应验证真实用户路径、可访问名称、API 响应或业务状态
- **且** 不得只断言某个被合并后的组件文件仍存在

---

## 需求：源码目录必须清晰表达前后端职责

开发者打开仓库根目录时，应能直接从源码目录名判断前后端边界；运行、构建、发布和维护脚本也必须指向当前源码根目录。

### 场景：开发者查看仓库根目录

- **当** 开发者查看源码目录
- **则** 后端源码应位于 `backend/`
- **且** 前端源码应位于 `frontend/`
- **且** 不应再存在 `server/` 或 `src/` 源码目录

### 场景：运行和构建入口跟随源码目录重命名

- **当** 开发者阅读 `package.json`、TypeScript 配置、Vite/Tailwind 入口、发布清单或维护脚本
- **则** Node 后端入口、构建输出、dev watcher 和 websocket rewrite 脚本必须指向 `backend/`
- **且** 前端入口和扫描配置必须指向 `frontend/`
- **且** 活跃源码、脚本、发布配置和测试注释不得继续引用已重命名的旧路径

## 需求：测试集必须按业务层级和运行入口分类

仓库中的可执行测试必须放入明确分类目录，并由对应测试命令运行。审阅者看到测试路径和文件名时，应能判断测试覆盖的业务层级、运行环境和维护入口。

### 场景：根目录不再堆积可执行测试

- **当** 审阅者打开 `tests/` 根目录
- **则** 根目录不应直接包含 `.test.ts` 或 `.spec.ts` 可执行测试文件
- **且** 测试应被移动到 `tests/backend`、`tests/spec`、`tests/e2e` 或 `tests/manual`

### 场景：每类测试有明确运行入口

- **当** 开发者阅读 `package.json` 和测试配置
- **则** 服务端测试由 `test:server` 覆盖
- **且** Node 规格契约由 `test:spec:node` 覆盖
- **且** Node 规格契约应覆盖 `tests/spec` 顶层非 `.spec.ts` 的测试，不应要求文件名必须以 `test_` 开头
- **且** 浏览器规格回归由 `test:spec:browser` 覆盖
- **且** 端到端业务流由 `test:e2e` 覆盖

### 场景：浏览器规格配置不再枚举根目录历史测试

- **当** `playwright.spec.config.ts` 被读取
- **则** `testMatch` 不应直接列出 `tests/` 根目录下的历史提案文件名
- **且** 新增浏览器规格测试只需放入 `tests/spec/**/*.spec.ts` 即可被发现

### 场景：测试文件名表达业务主题而不是重复迁移痕迹

- **当** 历史提案测试被归入最终测试目录
- **则** 文件名可以保留必要的提案编号或业务主题
- **但** 不应包含日期前缀、`test_日期` 前缀或双份迁移日期

### 场景：测试分类说明可指导后续新增测试

- **当** 后续开发者阅读 `tests/README.md`
- **则** 该说明必须列出各分类目录的职责
- **且** 必须列出对应运行命令
- **且** 必须说明新增测试不应直接放在 `tests/` 根目录

---

## 需求：tracked JS 源码必须迁移到 TypeScript

仓库中被 git 跟踪的源码、脚本、配置和测试应统一使用 TypeScript。

### 场景：前端入口和组件不再使用 JSX 文件

- **当** 开发者扫描 `frontend/`
- **则** 不得存在 `.jsx` 文件
- **且** `frontend/main.jsx` 必须迁移为 `frontend/main.tsx`
- **且** React 组件必须用 `.tsx` 表达 props、context 和事件类型

### 场景：后端和 shared 不再使用 JS 源码

- **当** 开发者扫描 `backend/` 和 `shared/`
- **则** 不得存在 `.js`、`.mjs` 或 `.cjs` 源码文件
- **且** 共享工具必须从 `.ts` 源码直接导出运行函数和类型

### 场景：脚本和配置纳入迁移范围

- **当** 开发者扫描 `scripts/` 和根目录配置文件
- **则** 保留的脚本和配置必须迁移为 `.ts`
- **且** 如果外部工具短期只能加载 JS shim，该 shim 必须列入例外清单并说明退出条件

### 场景：测试文件迁移为 TypeScript

- **当** 开发者扫描 `tests/`
- **则** server、spec、e2e、manual 测试文件和 helper 应迁移为 `.ts`
- **且** 测试仍然验证真实业务行为，而不是只验证文件扩展名

## 需求：TypeScript 配置必须覆盖全仓核心代码

迁移完成后 typecheck 应覆盖前端、后端、共享工具、脚本和测试关键路径，不能继续依赖 `allowJs`。

### 场景：tsconfig 不再允许 JS 兜底

- **当** 开发者运行 TypeScript 配置契约测试
- **则** 所有主 tsconfig 都不得设置 `allowJs: true`
- **且** 不得通过排除 JS 文件来掩盖未迁移代码

### 场景：前后端配置分离

- **当** 开发者查看 tsconfig
- **则** 前端、Node 服务端和测试应有清晰的配置边界
- **且** `pnpm run typecheck` 必须覆盖这些边界

### 场景：编译输出不进入仓库

- **当** 服务端 TypeScript 需要编译为 Node 可执行 JS
- **则** 输出目录必须位于 `.gitignore` 已忽略路径
- **且** 不得提交编译产物

## 需求：Node 运行入口必须在迁移后可执行

把 server 和 scripts 改成 TS 后，所有命令入口必须仍可运行。

### 场景：开发服务可启动

- **当** 开发者运行 `pnpm run server`
- **则** 后端应通过明确的 TS runner 或编译产物启动
- **且** 不得指向 Node 无法直接执行的 `.ts` 文件

### 场景：CLI bin 可执行

- **当** 用户执行 `ozw`
- **则** bin 入口必须指向可被 Node 执行的文件
- **且** 行为保持与迁移前的 `backend/cli.js` 一致

### 场景：postinstall 脚本可执行

- **当** 用户运行 `pnpm install`
- **则** postinstall 不得因为脚本迁移为 TS 而失败
- **且** 不得依赖未声明的传递依赖执行 TS

### 场景：测试 runner 可执行 TS 测试

- **当** 开发者运行 `pnpm run test:server` 和 `pnpm run test:spec`
- **则** Node test 与 Playwright 都必须能加载 TS 测试和 TS helper
- **且** 测试命令不应继续扫描旧 `.js` 测试模式

## 需求：JS 声明配对必须消失

迁移后不得继续维护 `.js` 实现和 `.d.ts` 声明的重复源。

### 场景：shared 声明由 TS 源码生成或导出

- **当** 开发者扫描 `shared/`
- **则** 不得存在与同名 `.js` 文件配对的 `.d.ts`
- **且** 类型必须从 `.ts` 源码中维护

### 场景：前端工具声明不再手写配对

- **当** 开发者扫描 `frontend/components` 和 `frontend/hooks`
- **则** 不得存在 `messageDedup.js`、`sessionMessageDedup.js`、`sessionActivityState.js` 这类 JS 实现配对声明
- **且** 调用方导入路径必须指向 TS 模块

## 需求：业务行为必须保持不变

TypeScript 迁移不得改变用户可见行为或 API 契约。

### 场景：项目和会话行为保持稳定

- **当** 用户打开项目、查看会话、创建手动会话或续聊
- **则** 项目列表、会话路由、provider 状态和消息渲染保持迁移前行为
- **且** 后端响应字段不因类型迁移被重命名或删除

### 场景：工作区工具保持可用

- **当** 用户使用聊天、文件树、编辑器、Shell 面板、设置页和 workflow 详情
- **则** 这些路径仍按真实业务测试通过
- **且** 页面不得因为导入扩展名或类型转换错误空白

### 场景：运行依赖诊断保持可读

- **当** oz flow、co、Codex 或 Pi 缺失
- **则** diagnostics 返回的缺失命令、检查动作和 PATH 信息保持清晰
- **且** 类型迁移不得吞掉原有错误原因

## 需求：迁移质量必须可审查

迁移不是无类型重命名，必须让审阅者能看到业务类型边界。

### 场景：新增类型表达真实业务结构

- **当** 迁移 API response、WebSocket message、workflow run、provider session、project config 等对象
- **则** 类型命名必须表达业务含义
- **且** 不得用宽泛 `Record<string, unknown>` 替代已知稳定字段

### 场景：`any` 只能用于外部输入边界

- **当** 代码需要处理未知 JSON、CLI 输出或第三方库事件
- **则** 可以在解析边界短暂使用 `unknown` 或受控 `any`
- **但** 进入业务函数前必须归一化为明确类型

---

## 需求：`pnpm test` 是全量验收入口

仓库提供覆盖全部关键质量门禁的统一测试命令。

### 场景：全量测试入口覆盖所有现有测试层

- **当** 开发者运行 `pnpm test`
- **则** 必须执行 `pnpm run typecheck`
- **且** 必须执行 `pnpm run test:server`
- **且** 必须执行 `pnpm run test:spec`
- **且** 必须执行 `pnpm run test:e2e`

### 场景：browser spec 不得被排除在全量入口之外

- **当** `pnpm test` 执行 `pnpm run test:spec`
- **则** `test:spec` 必须继续包含 `test:spec:browser`
- **且** browser spec 失败必须导致 `pnpm test` 失败

### 场景：最终验收必须全绿

- **当** 任何变更完成后运行 `pnpm test`
- **则** 命令必须以 0 退出
- **且** 不得存在为了通过而新增的无条件 skip 或条件跳过

## 需求：历史重复测试必须归并到 canonical 测试

每个业务契约应有清晰的测试归属，避免旧 proposal 副本与当前测试互相冲突。

### 场景：重复的 server 契约测试被归并

- **当** 根目录 proposal 测试与 `tests/backend` 中的测试覆盖同一业务契约
- **则** 应保留 `tests/backend` 中的 canonical 测试
- **且** 旧 proposal 测试中的独有断言必须迁入 canonical 测试后再删除旧副本

### 场景：重复的 spec 契约测试被归并

- **当** 根目录 proposal 测试与 `tests/spec` 中的测试覆盖同一浏览器或静态契约
- **则** 应保留 `tests/spec` 或明确命名的 canonical 测试
- **且** Playwright 配置不得继续引用被删除的旧路径

### 场景：当前行为优先于旧 proposal 预期

- **当** 旧测试与近期提案的实现意图冲突
- **则** 应更新或删除旧测试
- **且** 不得为了旧测试恢复已被近期提案废弃的行为

## 需求：测试运行态路径必须使用 XDG state helper

测试应跟随当前 oz flow/ozw 运行态路径策略，不得硬编码项目内路径。

### 场景：oz flow state 读写使用当前运行态根目录

- **当** 测试需要读写 oz flow `state.json`
- **则** 必须通过 `resolveFlowRunsRoot`、`resolveFlowRunStatePath` 或 fixture helper 解析路径
- **且** 不得把项目内 `.wo/runs/<run>/state.json` 当作当前真实运行态

### 场景：ozw 项目配置使用当前 state config

- **当** 测试需要验证项目会话 UI 状态、收藏、待处理或隐藏配置
- **则** 必须通过 `getProjectLocalConfigPath` 读取当前项目 state config
- **且** 不得只检查旧项目内 `.ozw/conf.json`

### 场景：展示用 artifact path 与真实 state path 区分

- **当** oz flow state 中包含 `.wo/runs/.../logs/...` 这类展示路径
- **则** 测试可以断言其作为 artifact 文本或相对路径显示
- **但** 不得把该展示路径误用为测试夹具的真实 state 读写位置

## 需求：清理后不得残留旧失败基线

测试套件中的失败不得作为长期豁免存在。

### 场景：旧失败清单被消除

- **当** 开发者运行 browser spec 和 e2e
- **则** 历史上记录的 selector、fixture 路径、UI 文案和时序应全部修复或删除
- **且** 若有新的真实回归，必须作为对应变更阻塞问题处理

### 场景：文档说明当前测试策略

- **当** 审阅者查看变更文档
- **则** 应能看到哪些测试被删除、归并、更新或修复
- **且** 能通过 `pnpm test` 复现最终验收结果

## 需求：测试契约本身应纳入验收范围

新增的测试基础设施变更必须有对应的契约测试确保不退化。

### 场景：pnpm test 入口可被契约断言

- **当** 运行 test:spec:node
- **则** 应有测试断言 `pnpm test` 覆盖 typecheck、server、spec、e2e 各层
- **且** 断言 `test:spec` 覆盖 node 和 browser 两个维度

### 场景：已删除的重复测试不再出现

- **当** 运行 test:spec:node
- **则** 应有测试断言历史上删除的旧 proposal 测试路径不再存在于 `tests/`
- **且** 断言对应的 canonical 测试仍存在于 `tests/backend/` 或 `tests/spec/`

### 场景：stale 旧文件名不重现

- **当** 运行 test:spec:node
- **则** 应有测试扫描 `tests/` 确认不引用已删除的 `.jsx`、旧运行态路径和旧重复日期路径

### 场景：fixture helper 路径与生产一致

- **当** 运行 test:spec:node
- **则** 应有测试验证 playwright fixture 导入并使用 `resolveFlowRunStatePath`
- **且** 不得硬编码 `.wo/runs` 或 `.ozw/runs` 路径

---

## 需求：前端不得复制 co/oz flow 生命周期状态机

ozw 前端应只发送用户意图、展示本地 pending 反馈、读取 co/oz flow 权威状态并渲染结果，不得用本地 Set 或 realtime payload 作为 provider/workflow 生命周期事实源。

### 场景：发送消息后不直接宣告 provider session running

- **当** 用户在 Codex 或 Pi 会话中发送消息
- **则** 前端可以显示本地 pending 用户消息和防重复提交状态
- **且** 不得仅因为点击发送就把具体 provider session 记为权威 running
- **并且** 是否显示可中断运行态必须等待 co 返回 `session-status`、`active_turn_id` 或等价 read model

### 场景：路由刷新后运行态从 co 恢复

- **当** 用户刷新或重新打开一个仍有 `active_turn_id` 的会话
- **则** 前端应通过 `check-session-status` 或项目 read model 恢复运行态
- **且** 发送按钮应显示停止按钮
- **并且** 不得依赖刷新前遗留的前端 `processingSessions`

### 场景：workflow 阶段状态来自 oz flow

- **当** 用户打开 workflow 详情或 workflow 子会话
- **则** stage、run status、当前轮次和中断状态来自 oz flow read model
- **且** chat 的 provider turn 状态只用于该子会话输入区是否可停止
- **并且** chat 本地状态不得覆盖 oz flow 展示的 stage 事实

## 需求：三 provider 的推送内容不得直接成为最终消息渲染事实

Codex、Pi 的 WebSocket 内容事件应只触发 ack、状态更新或 read model 刷新。最终 assistant 正文、reasoning、工具卡片和文件变更必须来自持久化会话消息 read model。

### 场景：运行中 provider 内容事件不直接插入 transcript

- **当** Codex 或 Pi 在运行中推送 assistant content item
- **则** 前端不得把该 payload 直接追加为最终 assistant 消息
- **且** 可触发对应会话消息 read model 的刷新
- **并且** 页面中不得出现只存在于 realtime payload、尚未落盘的 assistant 正文

### 场景：持久化 read model 更新后按权威顺序显示

- **当** provider 的持久化会话消息新增用户消息、assistant 正文、reasoning 或工具结果
- **且** 前端收到刷新事件或完成事件
- **则** 页面应按 read model 顺序渲染消息
- **并且** 工具卡片结构、折叠状态和正文顺序与刷新浏览器后的结果一致

### 场景：重复推送不会重复渲染

- **当** 同一 provider 会话连续收到重复 `projects_updated`、content event 或 complete event
- **则** 同一条 assistant 正文、用户消息和工具卡片最多显示一次
- **并且** 用户滚动位置和已加载历史窗口不应被重复推送打乱

## 需求：运行中 UI 只保留停止按钮表达

底部运行状态条应删除，避免与发送按钮状态重复。

### 场景：发送按钮变为停止按钮

- **当** 当前会话处于本地 dispatching 或 co running 状态
- **则** composer action button 应从发送变为停止
- **且** 用户能通过该按钮请求中断当前 turn
- **并且** 没有 co active turn 时不得向错误 turn 发送 abort

### 场景：底部状态条不再出现

- **当** 当前会话正在运行
- **则** 输入框上方或底部不得显示旧的 `ProcessingStatus` 条
- **且** 页面不得显示 fake tokens、运行秒数、`esc to stop` 等旧状态条内容
- **并且** 断线提示、附件、模型选择和 follow latest 控件保持可用

## 需求：错误和超时只作为 UI 反馈，不改写权威生命周期

网络超时、provider 错误和 abort 失败应反馈给用户，但不得让前端永久持有与 co/oz flow 不一致的运行态。

### 场景：网络超时后可恢复

- **当** 发送后服务端长时间没有任何 ack 或 status
- **则** 前端可以显示网络异常错误
- **且** 应清理本地 pending dispatch 状态
- **并且** 后续收到 co status 或 oz flow read model 更新时，应以 co/oz flow 权威状态恢复页面

### 场景：provider 错误后状态收敛

- **当** Codex 或 Pi 返回 error/failed/aborted
- **则** 前端应显示错误或中断反馈
- **且** 停止按钮应按 co 返回状态消失
- **并且** 不得保留本地 processing 残留导致刷新后继续显示运行中

---

## 需求：oz flow 批量列表必须显示 changes 中的全部提案

ozw workflow read model 和前端分组必须以 oz flow batch `changes` 为批量条目的顺序主来源。已启动提案保留真实 run 详情，未启动提案显示为 pending 占位，不得伪造 runId 或详情路由。

### 场景：批量追加后存在未启动提案

- **给定** oz flow batch `state.json` 中 `changes` 为 `['change-a', 'change-b', 'change-c']`
- **且** `run_ids` 只包含 `change-a` 和 `change-b`
- **当** ozw 构建 batch read model
- **则** batch 的总数必须为 3
- **且** batch 条目必须按 `changes` 顺序包含 `change-a`、`change-b`、`change-c`
- **且** `change-c` 必须显示为待启动状态
- **且** `change-c` 不得伪造 runId 或可点击详情路由

### 场景：前端渲染批量列表

- **给定** 项目 read model 中有一个 total 为 3 的 batch
- **且** 其中只有前 2 个提案存在真实 workflow
- **当** 用户展开批量工作流列表
- **则** 列表必须显示 3 个提案卡片
- **且** 前 2 个卡片保留真实阶段进度
- **且** 第 3 个卡片显示待启动
- **且** 批量头部进度仍显示 `2/3`

## 需求：工作流展示不再区分单次任务 tab

工作流列表应统一按批量任务语义展示。没有 batch state 的单个 workflow 也作为一项批量任务展示，避免出现与 oz flow 批量模型不一致的“单次任务”分类。

### 场景：只有 1 个提案的工作流

- **给定** 项目中只有一个未归入 batch state 的 oz flow run
- **当** ozw 构建 workflow 分组
- **则** 该分组也必须按批量任务展示
- **且** 进度必须显示为 `0/1` 或 `1/1`
- **且** 界面不得出现“单次任务”文案

### 场景：历史批量 run 仍可打开详情

- **给定** 批量条目有真实 runId
- **当** 用户点击该提案卡片
- **则** 仍打开原有 workflow 详情页
- **且** 详情页中的批量标记、阶段、子会话和产物读取保持不变

---

## 需求：规划会话必须按 oz flow planner 角色读取

ozw 必须把 `oz flow` 当前契约中的 planner role 作为规划会话主来源，不得只读取 planning key。

### 场景：读取 codex planner 规划会话

- **给定** `oz flow state.json` 中存在 `sessions["codex:planner"] = "planner-thread-1"`
- **当** 用户打开 workflow 详情页
- **则** 规划行显示可进入的"会话"
- **且** 点击后进入该 run 的 planning child session route
- **并且** read model 中规划 sessionRef 的 `sessionId` 是 `planner-thread-1`

### 场景：读取非 Codex planner 规划会话

- **给定** planning 阶段配置的 tool 是 `pi`
- **且** `oz flow state.json` 中存在 `sessions["pi:planner"] = "pi-planner-1"`
- **当** ozw 构造 workflow read model
- **则** 规划行 sessionRef 的 provider 是 `pi`
- **且** session id 是 `pi-planner-1`
- **并且** 不得错误回退为 Codex provider

### 场景：兼容历史 planning key

- **给定** 旧运行态中只存在 `sessions["codex:planning"] = "legacy-planning-thread"`
- **当** 用户打开 workflow 详情页
- **则** ozw 仍能显示规划会话入口
- **但** 新增测试和 fixture 的主路径必须使用 `codex:planner`

### 场景：规划会话缺失

- **给定** `oz flow state.json` 中没有 planner/planning 会话 id
- **当** 用户打开 workflow 详情页
- **则** 规划行显示 `未知`
- **且** 不得用 run id、stage key 或 log 文件名伪造会话 id

## 需求：runnerProcesses 只能表达真实进程事实

ozw 不得从 `state.sessions` 或 stage 状态合成 runner process rows。没有真实 process 数据时，进程区必须隐藏。

### 场景：sessions-only 状态不显示进程区

- **给定** `oz flow state.json` 中存在 `sessions["codex:planner"]` 和 `sessions["codex:executor"]`
- **且** `state.processes` 不存在或为空
- **当** 用户打开 workflow 详情页
- **则** 角色摘要仍显示对应会话入口
- **但** 页面不显示 `workflow-runner-processes` 进程区
- **并且** read model 的 `runnerProcesses` 为空数组

### 场景：真实 processes 保留 pid

- **给定** `oz flow state.json` 中存在 `processes` 数组含 pid 和 session_id
- **当** ozw 构造 workflow read model
- **则** `runnerProcesses[0].pid` 是真实 pid
- **且** `runnerProcesses[0].sessionId` 是真实 session_id
- **并且** 前端展示时不得把 session_id 当作 pid

### 场景：process 没有 pid 不得伪造

- **给定** `state.processes[0].session_id = "reviewer-thread-1"`
- **且** 该 process 没有 `pid`
- **当** 用户查看进程区
- **则** 页面可以显示 `thread=reviewer-thread-1`
- **但** 不得显示 `pid=reviewer-thread-1`
- **并且** 不得把 session id 称为进程编号

## 需求：会话编号和进程编号在 UI 上语义分离

workflow UI 必须让用户能区分 provider 会话编号和系统进程编号。

### 场景：角色行展示会话编号入口

- **当** workflow 角色摘要展示 `规`、`写`、`审`、`修` 或 `存` 的会话入口
- **则** 这些入口表示 provider session id
- **且** 点击进入对应 workflow child session
- **并且** 不得暗示它是 pid

### 场景：进程行展示 process metadata

- **当** workflow 详情页展示真实进程行
- **则** pid 只来自 `process.pid`
- **且** thread/session 只来自 `process.sessionId`
- **并且** 二者应分开渲染或分开命名

## 需求：测试 fixture 必须贴近真实 oz flow 契约

ozw 的 workflow 测试数据必须使用当前 `oz flow` 的 role key，避免测试通过但真实运行态失败。

### 场景：fixture 使用 codex:planner

- **当** Playwright fixture 或 server read model 测试需要构造规划会话
- **则** 主路径必须写入 `sessions["codex:planner"]`
- **且** 不得只写 `sessions["codex:planning"]`

### 场景：旧 fixture 预期被更新

- **当** 测试断言 workflow runner process 区
- **则** 只有 fixture 显式提供 `processes` 时才断言进程区存在
- **并且** sessions-only fixture 应断言进程区不存在

---

## 需求：ozw 必须正确读取 oz flow v1.2.0 七阶段状态

ozw 必须把 `planning`、`acceptance`、`execution`、`review/fix`、`qa`、`archive` 作为 oz flow v1.2.0 主路径读取，同时保留旧阶段兼容。

### 场景：读取完整七阶段 run

- **给定** oz flow sealed `state.json` 包含 `planning`、`acceptance`、`execution`、`review_1`、`fix_1`、`review_2`、`qa`、`archive`
- **当** ozw 调用 `listWorkflowReadModels()`
- **则** `stageStatuses` 必须按七阶段业务顺序返回
- **且** `acceptance` 的 label 必须表达验收计划
- **并且** `qa` 的 label 必须表达 QA 验收
- **并且** diagnostics 不得报告 `acceptance` 或 `qa` 是未知阶段

### 场景：缺少 workflow_display 时生成 fallback 展示行

- **给定** oz flow `state.json` 没有 `workflow_display.lines`
- **当** ozw 构建 `workflowDisplay.lines`
- **则** fallback 必须包含 `planning`、`acceptance`、`start`、`review`、`1 fix review`、`qa`、`archive`
- **并且** review/fix 循环继续保持现有折叠规则

## 需求：acceptance 和 qa 子会话必须可路由

### 场景：sessions 中存在 acceptance 和 qa 阶段会话

- **给定** `state.sessions` 包含 `codex:acceptance` 和 `codex:qa`
- **当** ozw 构建 `childSessions`
- **则** acceptance 会话必须挂到 `stageKey=acceptance`
- **且** routePath 必须为 `/runs/<runId>/sessions/acceptance`
- **并且** qa 会话必须挂到 `stageKey=qa`
- **并且** routePath 必须为 `/runs/<runId>/sessions/qa`

### 场景：workflow 详情页打开新阶段会话

- **给定** 用户在 workflow 详情页看到 acceptance 或 qa 阶段
- **当** 用户点击该阶段的会话入口
- **则** 页面必须进入对应已有工作流子会话
- **并且** 不得新建普通聊天会话

## 需求：v1.2.0 阶段产物必须挂到正确阶段

### 场景：acceptance summary 存在

- **给定** `state.paths.acceptance_summary` 指向一个存在的 Markdown 文件
- **当** ozw 构建 workflow artifacts
- **则** 该产物必须挂到 `stage=acceptance`
- **并且** workflow detail 中 acceptance 阶段必须能看到该文件

### 场景：QA artifact 存在

- **给定** `state.paths.qa` 或等价 QA path 指向一个存在的 JSON/Markdown 文件
- **当** ozw 构建 workflow artifacts
- **则** 该产物必须挂到 `stage=qa`
- **并且** workflow detail 中 qa 阶段必须能看到该文件

### 场景：产物路径不存在

- **给定** v1.2.0 path key 指向不存在的文件
- **当** ozw 读取 workflow
- **则** workflow 列表仍必须正常返回
- **并且** diagnostics 必须包含可复核的缺失路径 warning

## 需求：前端阶段进度必须展示七阶段主路径

### 场景：workflow card 展示七阶段进度

- **给定** workflow 的 `stageStatuses` 包含 acceptance 和 qa
- **当** 用户查看 sidebar 或 project overview workflow card
- **则** 阶段进度必须包含 acceptance 和 qa 的稳定视觉节点
- **并且** review/fix 多轮仍折叠显示计数

### 场景：旧 run 兼容读取

- **给定** 旧 run 仍使用 `verification` 或 `ready_for_acceptance`
- **当** ozw 读取该 run
- **则** 旧 run 不应导致读取失败
- **但** 新建和新测试主路径不得继续依赖这些旧阶段

---

## 需求：provider-aware oz flow sessions 必须生成 workflow child sessions

ozw 必须把 `oz flow state.sessions` 中的 provider role map 当作 workflow child session 来源，而不是只依赖 runner process rows。

### 场景：Pi executor sessions-only 状态可进入子会话

- **给定** `oz flow state.json` 中存在 `sessions["pi:executor"] = "pi-thread-1"`
- **且** `state.processes` 不存在或为空
- **当** ozw 构造 workflow read model
- **则** `childSessions` 包含 id 为 `pi-thread-1` 的子会话
- **且** 该子会话的 provider 是 `pi`
- **并且** 该子会话的 stageKey 是 `execution`

### 场景：sessions-only 状态不伪造进程

- **给定** `oz flow state.json` 只有 `sessions["pi:executor"]`
- **且** 没有真实 `processes`
- **当** ozw 构造 workflow read model
- **则** `runnerProcesses` 是空数组
- **但** workflow role summary 和 stage inspection 仍显示可进入的 Pi 会话

### 场景：explicit process 与 role session 去重

- **给定** `state.processes[0].session_id = "pi-thread-1"`
- **且** `sessions["pi:executor"] = "pi-thread-1"`
- **当** ozw 构造 child sessions
- **则** `pi-thread-1` 只出现一次
- **且** process pid 保留在 `runnerProcesses`
- **并且** child session 的 provider 仍是 `pi`

### 场景：非 Pi provider role map 同样可路由

- **给定** `sessions["pi:executor"] = "pi-thread-1"` 或 `sessions["codex:reviewer"] = "codex-thread-1"`
- **当** ozw 构造 workflow read model
- **则** 对应 child session 使用各自 provider
- **并且** 不得统一回退为 Codex

## 需求：Pi workflow child session 必须按 provider 加载消息

Pi workflow 子会话打开后，聊天页必须保留 workflow 和 provider 上下文，并从 co read model 读取消息。

### 场景：点击 Pi role row 进入 workflow child route

- **当** 用户在 workflow 详情页点击 `pi:executor` 对应的"会话"
- **则** 浏览器进入 `/runs/<runId>/sessions/<address>` 或 `/runs/<runId>/sessions/by-id/<sessionId>`
- **且** selected session 的 `workflowId` 是当前 run
- **并且** selected session 的 `__provider` 是 `pi`

### 场景：Pi child session 请求消息时携带 provider

- **给定** 当前 selected session provider 是 `pi`
- **当** 聊天页加载该 session 消息
- **则** 请求 `/api/projects/:projectName/sessions/:sessionId/messages` 时带有 `provider=pi`
- **且** 服务端不得尝试读取 Codex JSONL 作为 fallback

### 场景：co conversation 存在时返回 Pi 消息

- **给定** co conversation state 中 `provider = "pi"`
- **且** `provider_session_id = "pi-thread-1"`
- **并且** turns/events 中存在用户消息和 assistant 文本事件
- **当** 前端加载 `pi-thread-1` 的消息
- **则** 页面展示 co durable history 中的用户消息和 assistant 消息
- **并且** 消息 provider 标记为 `pi`

### 场景：co conversation 缺失时不跨 provider fallback

- **给定** oz flow state 记录了 `sessions["pi:executor"] = "pi-thread-missing"`
- **但** co 没有对应 conversation
- **当** 前端加载该 child session
- **则** 消息区可以为空或显示明确错误反馈
- **且** 不得显示同名 Codex/Pi 会话内容

## 需求：active oz changes API 必须走轻量路径

新建工作流弹窗读取 active oz changes 时，不得重建全项目 provider/session/sidebar read model。

### 场景：打开弹窗不触发全量项目会话扫描

- **当** 前端打开工作流操作弹窗
- **则** `/api/projects/:projectName/openspec/changes` 只解析当前 project path
- **且** 不调用全量 provider session population
- **并且** 不需要 `attachWorkflowMetadata(await getProjects())`

### 场景：返回未被 workflow claim 的 active changes

- **给定** `oz list --json` 返回 active changes `["a", "b"]`
- **且** 当前项目已有 workflow claim 了 `"a"`
- **当** 请求 active changes API
- **则** 返回 `["b"]`
- **并且** 排序规则与现有 `listProjectAdoptableOpenSpecChanges` 保持一致

### 场景：oz list 快速时接口不秒级等待

- **给定** 测试夹具中 `oz list --json` 立即返回
- **且** 当前项目 workflow read model 很小
- **当** 请求 `/openspec/changes`
- **则** 响应不应被 unrelated provider history 扫描拖慢
- **并且** 测试应能证明慢路径不再依赖全项目 `getProjects()`

## 需求：现有 33/34 方向不得回退

本变更必须兼容既有两个活动提案的架构方向。

### 场景：消息最终事实仍来自 co/oz flow read model

- **当** Pi workflow child session 运行中收到 realtime 事件
- **则** 页面可以刷新 read model
- **但** 最终 transcript 仍以 co durable conversation messages 为准

### 场景：session id 不被当作 pid

- **当** workflow 只有 `state.sessions` 而没有 `state.processes`
- **则** 页面不得显示 `workflow-runner-processes`
- **且** 不得把 `pi-thread-1` 显示成 pid

---

## 需求：项目发现必须使用 Provider 的轻量权威索引

`/api/projects` 必须通过轻量数据源发现 Codex、Pi 项目和会话概览，不得为仓库列表全量解析 Provider 历史。

### 场景：Codex 通过 JSONL 首行发现项目

- **给定** `~/.codex/sessions/**/*.jsonl` 中某文件第一条非空记录是 `type=session_meta`
- **且** `payload.cwd = "/repo/codex-project"`
- **当** ozw 构建项目列表
- **则** 返回的项目包含 `/repo/codex-project`
- **并且** 对应 session provider 是 `codex`
- **且** 不需要读取该 JSONL 后续全部消息行

### 场景：Codex 旧格式 fallback 深读

- **给定** 某 Codex JSONL 第一条非空记录不是 `session_meta`
- **但** 文件中后续记录仍能被现有完整解析逻辑识别出 cwd
- **当** ozw 构建 Codex 索引
- **则** 该文件仍能被识别
- **并且** fallback 只影响该文件，不阻塞其他正常头部文件

### 场景：Pi 通过 JSONL 首行发现项目

- **给定** `~/.pi/agent/sessions/**/*.jsonl` 中某文件第一条非空记录是 `type=session`
- **且** `cwd = "/repo/pi-project"`
- **当** ozw 构建项目列表
- **则** 返回的项目包含 `/repo/pi-project`
- **并且** 对应 session provider 是 `pi`
- **且** 不需要读取该 Pi transcript 的后续记录

### 场景：Pi 通过 SQLite session 表发现项目

- **给定** Pi 数据库 `pi.db` 中 `session.directory = "/repo/pi-project"`
- **当** ozw 构建项目列表
- **则** 返回的项目包含 `/repo/pi-project`
- **并且** 对应 session provider 是 `pi`
- **且** 不需要执行 `pi session list --format json`
- **并且** 不扫描 snapshot、tool-output 或 session_diff 目录

## 需求：多 Provider 会话概览必须保持身份稳定

项目概览可以使用轻量 session 元数据，但不得改变现有路由和 UI state 契约。

### 场景：同一项目存在三类 Provider 会话

- **给定** 同一项目路径下存在 Codex、Pi 和 Pi session
- **当** 请求 `/api/projects`
- **则** 同一个项目下分别返回 `codexSessions`、`piSessions`、`piSessions`
- **并且** 每个 session 的 provider 标记保持正确
- **且** 不能把 Pi 或 Pi 会话归入 Codex

### 场景：项目自定义标题和 session UI state 生效

- **给定** ozw project config 中保存了项目 displayName
- **且** 某 Provider session 有 favorite、pending 或 hidden 状态
- **当** 项目列表使用轻量 Provider 索引返回
- **则** displayName 和 session UI state 仍按配置叠加
- **并且** hidden session 默认不出现在可见列表中

### 场景：workflow child session 不进入普通手动会话列表

- **给定** 某 Provider session 被 workflow ownership metadata 标记为 child session
- **当** 项目列表使用轻量 Provider 索引返回
- **则** 该 session 不应出现在普通手动会话分组
- **并且** workflow 页面仍能按 workflow read model 访问它

## 需求：项目列表不得被历史体积线性拖慢

项目列表性能应与"文件数量和索引记录数量"相关，而不应与所有 transcript 内容总大小线性相关。

### 场景：Codex 后续大内容不影响项目发现

- **给定** Codex JSONL 首行包含完整 `session_meta`
- **且** 后续写入大量消息行或大型工具输出
- **当** 构建 Codex 项目索引
- **则** 项目归属仍来自首行
- **并且** 测试能证明后续内容不会被项目发现逻辑依赖

### 场景：Provider 索引同轮请求只构建一次

- **给定** 多个并发 `/api/projects` 或同一轮 `getProjects()` 内多次需要 Provider 索引
- **当** Provider 索引正在构建
- **则** 后续调用复用同一个 promise
- **并且** 不重复扫描 Codex/Pi 文件或重复查询 Pi DB

### 场景：Pi DB 不可用时快速 fallback

- **给定** `pi.db` 不存在、schema 不兼容或只读打开失败
- **当** ozw 构建 Pi 索引
- **则** 可以 fallback 到现有 CLI 读取
- **并且** CLI 失败时返回空 Pi 索引
- **且** 不能让整个项目列表请求失败

## 需求：会话详情仍按需读取真实历史

概览轻量化不能破坏进入会话后的聊天详情。

### 场景：进入 Codex 会话后仍能读取真实消息

- **给定** 项目概览中的 Codex session 来自 JSONL 头部索引
- **当** 用户打开该 session
- **则** 消息详情接口仍按 Codex JSONL 读取真实 transcript
- **并且** 不因概览 messageCount 为轻量值而丢失消息

### 场景：进入 Pi 会话后仍按 Pi/co read model 加载

- **给定** 项目概览中的 Pi session 来自 Pi JSONL 头部或 ozw 配置
- **当** 用户打开该 session
- **则** 消息详情按 Pi/co read model 加载
- **并且** 不 fallback 到 Codex JSONL

### 场景：进入 Pi 会话后仍按 Pi 数据源加载

- **给定** 项目概览中的 Pi session 来自 SQLite `session` 表
- **当** 用户打开该 session
- **则** 消息详情按 OpenCore 的消息数据源加载
- **并且** 项目概览不需要预先读取 `message` 或 `part` 全表

---

## 需求：Pi co 会话必须显示用户消息气泡

Pi 会话从 co durable state 回读时，必须把 request 文本还原成用户消息，而不是只显示 assistant event。

### 场景：turn 目录没有 request.json 但 state.json 有 request_id

- **给定** co conversation `c49` 的 provider 是 `pi`
- **且** `requests/done/<request>.json` 中存在 `text = "ping"`
- **且** `turns/<turn>/state.json` 中存在同一个 `request_id`
- **且** `turns/<turn>/events.jsonl` 中存在 `pi-response`
- **当** 前端请求 `/api/projects/:projectName/sessions/c49/messages?provider=pi`
- **则** 响应必须先包含 `role = "user"` 且 `content = "ping"` 的消息
- **并且** 后续包含对应 assistant 回复

### 场景：两轮 Pi 消息都可回读

- **给定** 同一个 Pi conversation 有两条 request，文本分别为 `"ping"` 和 `"ping2"`
- **且** 两个 turn 都通过 `state.json.request_id` 关联 request
- **当** ozw 读取该会话消息
- **则** transcript 顺序必须是 user `"ping"`、assistant、user `"ping2"`、assistant
- **并且** 第二条 user 消息不得被吞掉

## 需求：发送中的 Pi user 消息不得在刷新时消失

当 Pi request 被 co daemon 认领但尚未完成时，ozw 仍应保留用户刚发送的消息。

### 场景：request 位于 claimed 桶

- **给定** Pi request 已从 pending 移入 `requests/claimed`
- **且** turn state 已记录 `conversation_id` 和 `request_id`
- **当** 聊天页刷新或重新加载 session messages
- **则** API 响应必须包含该 request 的 user 消息
- **且** 前端不得把已显示的 optimistic user bubble 清除

### 场景：request 位于 running 桶

- **给定** Pi request 仍在 `requests/running`
- **当** ozw 读取 co conversation messages
- **则** user 消息必须可见
- **且** assistant event 尚未到达时 transcript 可以只有 user 消息

## 需求：durable user 消息与 optimistic 气泡必须去重

前端发送后立即展示的用户气泡，与 co durable request 回读出的用户消息代表同一次发送时，只能显示一条。

### 场景：durable request 确认 optimistic bubble

- **给定** 前端已显示一条 optimistic user bubble `"ping2"`
- **且** session messages 随后返回同一 request 的 durable user message `"ping2"`
- **当** 前端合并消息
- **则** 聊天区只显示一条 `"ping2"` 用户气泡
- **并且** 该气泡不再标记为 pending 或 failed

### 场景：真实重复发送不能被误删

- **给定** 用户连续两次发送相同文本 `"ping"`
- **且** 两次 request id 不同
- **当** durable transcript 回读完成
- **则** 聊天区必须显示两条独立的 user 消息

---

## 需求：长会话必须使用有界 DOM 渲染

聊天历史即使已经加载大量消息，也不得把所有已加载消息都作为真实 DOM 节点渲染到页面中。

### 场景：打开长会话默认定位最新消息

- **给定** 一个包含 1000 条以上消息的会话
- **且** 消息中包含文本、Markdown、代码块、工具卡和 diff
- **当** 用户打开该会话
- **则** 聊天区必须显示最新消息附近的内容
- **且** 页面不得请求无 `limit` 或 `afterLine` 的全量消息接口
- **且** `.chat-message` DOM 数量必须保持在实现定义的上限内

### 场景：继续向上加载旧历史不扩大 DOM 到全量

- **给定** 用户已经打开长会话并停留在最新消息附近
- **当** 用户持续向上滚动触发旧消息分页加载
- **则** 更早的消息必须可以逐步出现
- **且** 加载过的消息可以保留在内存中供定位或搜索使用
- **但** DOM 中同时存在的 `.chat-message` 数量仍必须保持有界

## 需求：上滑加载历史必须保持滚动锚点

用户浏览旧消息时，加载更早历史不应打断当前阅读位置。

### 场景：顶部触发加载后当前可见消息不跳动

- **给定** 用户正在长会话中向上浏览历史
- **且** 当前视口顶部可见消息为 `assistant turn 120`
- **当** 页面加载更早一页历史消息
- **则** `assistant turn 120` 仍应停留在用户可感知的相同位置附近
- **且** 页面不得跳回最新消息
- **且** 页面不得跳到刚加载页的顶部

### 场景：新消息到达时尊重用户上滑状态

- **给定** 用户已经上滑离开底部并正在阅读历史
- **当** 外部追加或实时新消息到达
- **则** 新消息应进入已加载消息数据
- **但** 页面不得强制滚动到底部
- **当** 用户回到底部或执行回到底部操作
- **则** 页面应恢复最新消息跟随

## 需求：重内容必须按需渲染

折叠状态下的工具卡、diff、代码块和子任务详情应只渲染轻量摘要，避免大内容提前占用主线程。

### 场景：折叠工具卡不渲染完整大输出

- **给定** 一条工具消息包含很大的 stdout 或 JSON 结果
- **当** 聊天区渲染该消息且工具卡处于折叠状态
- **则** 页面只应显示工具名、摘要、状态或少量预览
- **且** 完整输出文本不应出现在 DOM 中
- **当** 用户展开工具卡
- **则** 完整输出才应渲染并可阅读

### 场景：大代码块展开前不执行完整高亮渲染

- **给定** 一条 assistant Markdown 消息包含很长的 fenced code block
- **当** 该代码块处于默认摘要状态
- **则** 页面应显示语言、行数或截断预览
- **且** 不应提前渲染完整高亮节点
- **当** 用户展开代码块
- **则** 完整代码内容和高亮可以按需渲染

## 需求：搜索跳转必须兼容虚拟列表和未加载历史

聊天历史搜索命中不在当前渲染窗口内的消息时，仍必须能定位。

### 场景：搜索命中已加载但未渲染的消息

- **给定** 搜索结果指向一条已经加载到内存但不在当前虚拟窗口内的消息
- **当** 用户点击搜索结果
- **则** 聊天区必须滚动到该消息
- **且** 该消息应进入 DOM 并高亮或定位

### 场景：搜索命中尚未加载的旧消息

- **给定** 搜索结果指向一条早于当前已加载窗口的旧消息
- **当** 用户点击搜索结果
- **则** 前端必须逐页加载旧历史直到目标 messageKey 出现或确认不存在
- **并且** 目标出现后必须滚动定位到该消息
- **且** 加载过程不得把全部历史渲染成 DOM

## 需求：加载全部不得导致浏览器卡死

用户执行加载全部历史时，页面不得把所有消息完整渲染到 DOM。

### 场景：加载全部只扩大数据集不全量渲染

- **给定** 一个包含大量消息的会话
- **当** 用户触发加载全部历史
- **则** 前端可以把更多消息加载到内存或索引
- **但** DOM 中同时渲染的消息数量仍必须保持有界
- **且** 用户仍可以继续滚动、搜索和查看最新消息

---

## 需求：首页必须在 Provider 索引异常时保持可用

首页进入应用依赖项目概览。Provider 历史索引慢、失败或数据量大时，不得阻塞用户进入基本项目列表。

### 场景：Provider 索引超时仍返回可用项目

- **给定** 用户已经配置了至少一个手动项目
- **且** Codex、Pi 或 Pi 的 Provider 索引构建超过首页预算
- **当** 前端请求 `/api/projects`
- **则** 接口必须返回手动项目或已有缓存项目
- **且** 响应不得一直等待慢索引完成
- **并且** 服务端应允许后续刷新补齐 Provider 会话概览

### 场景：Provider 索引失败不导致首页不可进入

- **给定** Pi SQLite 无法读取或 Provider 历史目录出现异常
- **当** 前端请求 `/api/projects`
- **则** 接口仍应返回可用项目列表
- **且** 单个 Provider 的失败不得导致整个请求失败

## 需求：Provider-only 项目自动发现必须有首页上限

Provider-only 项目可以自动出现在首页，但不得因为历史数据过多而让主页项目列表失控。

### 场景：只展示最近 50 个 Provider-only 项目

- **给定** Provider 历史中存在超过 50 个未手动配置的项目
- **当** 前端请求 `/api/projects`
- **则** 手动配置项目必须完整保留
- **且** Provider-only 项目最多返回最近活跃的 50 个
- **并且** 排序应依据最近 session 活跃时间

## 需求：未知消息数不得显示成 0

懒加载概览不知道真实消息数时，UI 不得把未知值显示为 `0`。

### 场景：项目主页会话卡片隐藏未知消息数

- **给定** 一个会话概览没有真实 `messageCount`
- **或** 后端明确标记消息数未知
- **当** 用户打开项目主页查看会话卡片
- **则** 卡片不得显示 `0 条消息`
- **且** 卡片不得显示任何消息数占位文案

### 场景：侧边栏会话卡片隐藏未知消息数

- **给定** 一个侧边栏会话没有真实 `messageCount`
- **或** 后端明确标记消息数未知
- **当** 用户查看侧边栏会话列表
- **则** 会话项不得显示 `0 条`
- **且** 真实正数消息数仍可以显示

## 需求：@文件选择必须支持模糊搜索

用户知道文件名或路径片段时，应能直接搜索选择文件，不需要在长列表中滚动查找。

### 场景：多 token 模糊搜索命中文件

- **给定** 当前项目包含 `frontend/components/chat/view/subcomponents/ChatMessagesPane.tsx`
- **当** 用户打开 `@文件`选择器并输入 `cmp msg pane`
- **则** 搜索结果应包含 `ChatMessagesPane.tsx`
- **且** 用户选择后输入框应插入该文件路径

### 场景：路径片段搜索命中文件

- **给定** 当前项目包含多层目录下的文件
- **当** 用户输入文件名、目录名或缩写组合
- **则** 选择器应按相关性展示匹配文件
- **且** 结果数量应保持有界，避免大仓库下渲染过多结果

## 需求：@文件选择必须支持项目文件树导航

用户不知道文件名但知道目录位置时，应能从项目根目录自由展开选择文件。

### 场景：默认展示当前项目根目录

- **给定** 用户已选择一个项目
- **当** 用户点击聊天输入框旁的 `@文件`按钮
- **则** 选择器默认展示该项目根目录下的文件和目录
- **且** 目录可以展开或折叠

### 场景：通过文件树选择文件

- **给定** 文件树中存在目录 `frontend/components`
- **当** 用户展开目录并点击其中一个文件
- **则** 选择器应关闭
- **且** 输入框应插入被选中的相对文件路径
- **并且** 光标应回到输入框，便于继续输入消息

---

## 需求：聊天消息类型契约必须收敛

聊天消息相关工具必须复用业务类型定义，不能维护另一份会漂移的 `ChatMessage`。

### 场景：类型检查通过

- **给定** 开发者在仓库根目录运行类型检查
- **当** 执行 `pnpm run typecheck`
- **则** 命令应成功结束
- **且** 不应再出现 `ChatAttachment` 缺少 index signature 或 `deliveryStatus` 退化为 string 的错误

### 场景：消息去重工具复用业务类型

- **给定** `messageDedup.ts`、`sessionMessageMerge.ts` 和 `messageKeys.ts`
- **当** 审查这些工具的类型来源
- **则** 它们必须从聊天业务类型模块导入 `ChatMessage`
- **且** 不得在工具内部重新声明一份 `ChatMessage`

## 需求：开发服务和浏览器测试必须可启动

开发服务器和 Playwright browser spec 不应因为 Vite 监听生成物而崩溃。

### 场景：Vite 不监听仓库缓存和生成物

- **给定** 仓库内存在 `.pnpm-store`、`.tmp`、`dist`、`dist-node` 或 `.playwright-cli`
- **当** Vite dev server 启动
- **则** watcher 必须忽略这些目录
- **且** 不应因为监听 `.pnpm-store/v10/files` 报 `ENOSPC`

### 场景：browser spec 不因前端服务缺失级联失败

- **给定** 开发者运行 `pnpm run test:spec:browser`
- **当** Playwright global setup 启动后端和 Vite
- **则** `127.0.0.1:<vitePort>` 必须可访问
- **且** 测试不应出现批量 `ERR_CONNECTION_REFUSED`

## 需求：会话页稳定后不得重复请求同一批接口

进入一个已有会话页后，初始加载完成前端可以请求必要数据，但空闲状态不应反复请求同一会话接口。

### 场景：稳定会话页不重复请求

- **给定** 用户打开 `/projects/<project>/cN`
- **当** 会话消息、token usage、model state 和 slash commands 已加载完成
- **则** 页面空闲 5 秒内不得重复请求同一批 `messages`、`token-usage`、`model-state` 和 `commands/list`
- **且** 后端不应因为这些重复请求持续重建项目索引

### 场景：effect 依赖使用稳定业务 key

- **给定** 当前项目列表收到无关 `projects_updated`
- **当** `selectedProject` 或 `selectedSession` 的对象引用变化但业务 key 未变化
- **则** 当前会话消息、token usage、model state 和 command list 不应重新加载

## 需求：中文界面不能显示未解析 key

用户选择中文界面时，主要导航和聊天入口不能显示 i18n key 或主要英文 fallback。

### 场景：侧边栏搜索入口显示中文文案

- **给定** 用户语言为 `zh-CN`
- **当** 用户打开 ozw 首页或项目页
- **则** 侧边栏搜索入口不得显示 `search.placeholder`
- **且** 应显示可理解的中文搜索文案

### 场景：主要按钮不显示英文 fallback

- **给定** 用户语言为 `zh-CN`
- **当** 用户查看项目和会话列表
- **则** `Show more sessions`、`New Session`、`Messages` 等主要入口应显示中文或图标语义

## 需求：首屏控制台不应有 favicon 404

### 场景：浏览器请求 favicon 成功或不请求缺失资源

- **给定** 用户打开 ozw 首页
- **当** 浏览器加载静态资源
- **则** 控制台不应出现 `/favicon.ico` 404

---

## 需求：实时项目更新不得推送完整项目快照

Codex/Pi 会话文件或 workflow 状态变化时，后端不得把完整项目列表作为常规 WebSocket payload 推给前端。

### 场景：Codex JSONL 变化只产生会话级更新

- **给定** 用户已打开 ozw 网页
- **且** 后端观察到 `.codex/sessions` 下某个 JSONL 文件发生变化
- **当** 后端通过 WebSocket 通知前端
- **则** payload 必须标明 provider、projectPath、sessionId 或 changedFile
- **且** payload 不得包含完整 `projects` 数组
- **且** 前端只刷新受影响的会话或项目摘要

### 场景：非当前会话变化不打断当前聊天

- **给定** 用户正在阅读项目 A 的会话 X
- **当** 项目 A 或其他项目中的会话 Y 发生后台变化
- **则** 当前聊天 transcript 不得被清空或重新加载
- **且** 页面不得因为处理完整项目快照产生明显 long task
- **且** 侧边栏最多标记相关项目或会话摘要需要刷新

## 需求：项目概览必须是轻量 summary

项目列表接口必须服务首屏和侧边栏，不得携带无限历史会话或完整 workflow 详情。

### 场景：首屏项目列表不随历史会话线性膨胀

- **给定** 一个项目包含数百个 Codex/Pi 会话
- **当** 浏览器请求项目列表
- **则** 每个项目只返回最近有限数量的会话摘要和统计信息
- **且** 完整会话列表必须通过分页接口获取
- **且** `/api/projects` payload 不得随全部历史会话数量线性增长

### 场景：用户展开更多会话时按页加载

- **给定** 侧边栏只显示最近一批会话
- **当** 用户点击显示更多会话
- **则** 前端应请求项目会话分页接口
- **且** 新增会话只合并到对应项目的会话列表
- **且** 不应刷新所有项目的完整 read model

## 需求：文件提及必须按需加载

聊天输入框的文件提及能力不得在进入会话页时预加载完整项目文件树。

### 场景：打开会话页不请求全量文件树

- **给定** 用户打开一个已有项目会话页
- **当** 聊天 composer 初始化
- **则** 前端不得请求 `/api/projects/:projectName/files` 的默认全量文件树
- **且** 用户仍可以直接输入和发送普通聊天消息

### 场景：用户打开文件提及时只加载轻量数据

- **给定** 用户位于聊天输入框
- **当** 用户点击 `@` 文件提及入口
- **则** 前端可以请求浅层目录或文件搜索接口
- **且** 请求必须限制 depth、limit 或搜索 query
- **且** 不得默认使用 `depth=10&showHidden=true` 扫描全仓树

### 场景：文件搜索使用真实项目路径

- **给定** 用户在文件提及搜索框输入路径片段
- **当** 前端请求文件搜索
- **则** 后端必须在当前项目根目录内搜索
- **且** 返回结果必须包含可插入的相对路径
- **且** 不得越过项目根目录或返回隐藏运行态目录中的无关文件

## 需求：当前会话数据刷新必须与项目列表刷新解耦

当前聊天页需要会话消息、模型状态、token usage 和 slash commands，但这些请求不应因为项目列表对象刷新而重复触发。

### 场景：会话页稳定后不重复拉小接口

- **给定** 用户打开一个会话页并等待初始数据加载完成
- **当** 后台收到与当前会话无关的项目或会话更新
- **则** `commands/list`、`model-state`、`token-usage` 和当前 `messages` 不应重复请求
- **且** 当前页面交互状态保持稳定

### 场景：当前会话变化只刷新当前会话

- **给定** 用户正在查看会话 X
- **当** 会话 X 的 provider transcript 追加新内容
- **则** 前端只增量加载或合并会话 X 的新增消息
- **且** 不应刷新所有项目、所有会话和完整文件树

---

# 前端轮询优化：事件驱动刷新

### 需求：普通会话页不得常驻状态轮询

普通聊天会话打开并稳定后，前端不得每隔几秒发送业务状态检查。

#### 场景：普通会话 idle 期间不重复发送 check-session-status

- **给定** 用户已登录并打开一个已有项目会话
- **且** 初始会话消息和状态已经加载完成
- **当** 用户 8 秒内没有发送消息、切换页面或手动刷新
- **则** 浏览器不得继续周期性发送 `check-session-status`
- **且** 聊天输入框保持可用
- **且** 页面不得发生新的浏览器 navigation

#### 场景：WebSocket 重连后只做一次状态校准

- **给定** 用户正在查看会话 X
- **当** WebSocket 断开后重连
- **则** 前端可以对会话 X 发起一次状态校准
- **且** 不得因为重连启动新的常驻业务轮询

### 需求：workflow 详情刷新必须由事件驱动

workflow 状态变化应由后端 watcher 或用户动作触发刷新，不得由前端每秒主动拉取。

#### 场景：planning child session 等待不轮询 /api/projects

- **给定** 用户打开一个处于 planning 阶段、子会话尚未出现在本地 read model 的 workflow
- **当** 后端还没有发出相关 `workflow_changed` 或 `session_changed`
- **则** 前端不得每 1 秒请求 `/api/projects`
- **且** UI 可以显示等待状态
- **且** 收到相关事件后再刷新当前 workflow 或项目摘要

#### 场景：Go runner 运行中不每秒拉 workflow 详情

- **给定** 用户打开 Go runner 运行中的 workflow 详情
- **当** run state/log 没有新事件
- **则** 前端不得每 1 秒请求 workflow 详情接口
- **且** 收到 `workflow_changed` 后只刷新当前 workflow

### 需求：项目列表刷新不得被会话追加无条件触发

provider transcript 追加是会话级变化，不应让所有在线页面重新加载项目列表。

#### 场景：非当前会话追加不触发当前页面全量项目刷新

- **给定** 用户正在查看项目 A 的会话 X
- **当** 项目 A 或项目 B 的会话 Y 追加新 transcript
- **则** 后端应发送会话级 scoped event
- **且** 当前页面不得无条件请求 `/api/projects`
- **且** 当前聊天内容、滚动位置和输入框状态不得被打断

#### 场景：项目结构变化仍可刷新项目列表

- **给定** 用户新增、删除、重命名项目或修改项目级配置
- **当** 后端广播项目列表失效事件
- **则** 前端可以刷新项目列表
- **且** 该刷新必须是低频结构变化路径，不得复用为 transcript 追加路径

### 需求：保留有限兜底但禁止无限业务 interval

事件驱动实现可以有恢复机制，但恢复机制必须有明确终止条件。

#### 场景：事件丢失时有限重试

- **给定** 用户刚创建 workflow 或刚提交会话消息
- **当** 预期事件短时间内未到达
- **则** 前端最多执行有限次数的状态校准
- **且** 每次校准必须绑定当前 session/workflow
- **且** 达到上限、命中目标或页面离开后必须停止

---

## 需求：Codex 和 Pi idle 会话必须支持连续续发

已有手动会话完成第一轮后，用户继续发送第二条或后续消息，应复用同一个 `cN` conversation，并能看到新的响应。

### 场景：Codex idle 后第二条消息响应可见

- **给定** 用户已打开 Codex 手动会话 `cN`
- **且** 第一轮消息已经完成，co conversation 处于 idle/completed 状态
- **当** 用户在同一会话发送第二条消息
- **则** ozw 写入的 co request 必须使用 `provider=codex`
- **且** `conversation_id` 必须仍是同一个 `cN`
- **且** `active_policy` 必须是 `queue`
- **且** co 创建第二个 turn 后，页面必须显示第二条 assistant 响应
- **且** 不得重复回放第一轮 assistant 响应

### 场景：Pi idle 后第二条消息响应可见

- **给定** 用户已打开 Pi 手动会话 `cN`
- **且** 第一轮消息已经完成，co conversation 处于 idle/completed 状态
- **当** 用户在同一会话发送第二条消息
- **则** ozw 写入的 co request 必须使用 `provider=pi`
- **且** `conversation_id` 必须仍是同一个 `cN`
- **且** `active_policy` 必须是 `queue`
- **且** co 创建第二个 turn 后，页面必须显示第二条 assistant 响应

## 需求：运行中的 Codex 和 Pi 会话必须支持 steer

会话运行中，用户继续输入消息应被视为对当前 active turn 的 steer，而不是静默失败或无限排队。

### 场景：Codex running 时输入消息写入 steer request

- **给定** Codex 会话 `cN` 正在运行
- **且** 前端已收到 `session-status`，其中 `turn_id=turn_active`
- **当** 用户继续输入并发送一条 steer 消息
- **则** ozw 写入的 co request 必须使用 `provider=codex`
- **且** `conversation_id=cN`
- **且** `active_policy=steer`
- **且** `target_turn_id=turn_active`
- **且** co 对 active turn 追加响应后，页面必须给出可见结果

### 场景：Pi running 时输入消息写入 steer request

- **给定** Pi 会话 `cN` 正在运行
- **且** 前端已收到 `session-status`，其中 `turn_id=turn_active`
- **当** 用户继续输入并发送一条 steer 消息
- **则** ozw 写入的 co request 必须使用 `provider=pi`
- **且** `conversation_id=cN`
- **且** `active_policy=steer`
- **且** `target_turn_id=turn_active`
- **且** co 对 active turn 追加响应后，页面必须给出可见结果

### 场景：steer 被 co 拒绝时用户看到反馈

- **给定** 用户在 running 会话中发送 steer 消息
- **当** co 返回 `steer-rejected` 或 `message-rejected`
- **则** 前端必须清理该消息的 pending 状态
- **且** 页面必须显示可见错误或系统提示
- **且** 输入框不得永久卡在提交中

## 需求：多轮 transcript 必须可刷新恢复

多轮消息完成后，页面刷新或重新进入会话时，应从 durable read model 恢复完整消息，而不是依赖临时 realtime 状态。

### 场景：刷新后两轮消息仍完整可见

- **给定** 用户在同一 Codex 或 Pi 会话中完成两轮消息
- **当** 用户刷新页面或重新打开会话
- **则** 第一轮和第二轮 user 消息都必须可见
- **且** 第一轮和第二轮 assistant 响应都必须可见
- **且** 不得出现重复 assistant 响应

## 需求：跨 provider 不得串线

Codex 和 Pi 都使用 co conversation read model，但 provider 身份必须严格隔离。

### 场景：Pi provider session id 不得读到 Codex conversation

- **给定** co home 中同时存在 Codex 和 Pi conversation
- **且** 两者可能有相似的 provider session id 或 route index
- **当** 前端请求 Pi 会话消息
- **则** 服务端只允许返回 provider 为 Pi 的 conversation 消息
- **且** 不得把 Codex 的 response 混入 Pi transcript

---

## 需求：Pi 流式输出应聚合为可读消息

ozw 必须把 Pi 的底层 delta 事件转换成用户可读的 assistant 消息。

### 场景：同一 response 的 delta 不得逐条显示

- **给定** co `events.jsonl` 中同一 Pi turn 写入多个 `pi-response` `text_delta`
- **当** 前端加载该会话的 session messages
- **则** 页面应显示一条连续 assistant 消息
- **并且** 不得把 `"Let"`、`" me"`、`" first"` 这类 delta 片段显示成多条消息

### 场景：同一 turn 内后续 response 保持顺序

- **给定** 一个 Pi turn 内先后出现两个 response id
- **当** read model 转换该 turn
- **则** transcript 顺序应是 user、第一条 assistant、第二条 assistant
- **并且** 每条 assistant 都是聚合后的完整文本

## 需求：Pi 运行态应从 co 可证明状态恢复

ozw 必须避免把 Pi 的中间 step complete 当作整轮结束，也必须避免 stale `active_turn_id` 永久卡住会话。

### 场景：`pi-complete` 后还有后续输出

- **给定** `events.jsonl` 中 `pi-complete` 后仍有同一 turn 的 `pi-response`
- **当** WebSocket 或 session status 恢复运行态
- **则** ozw 不得因为较早的 `pi-complete` 过早清空停止能力
- **并且** 后续输出仍应进入同一个会话 transcript

### 场景：state 仍 running 但事件已经 terminal

- **给定** co conversation state 仍有 `active_turn_id`
- **且** 对应 turn 事件已经能证明该 turn 不再接受输出
- **当** 用户追加第二条消息
- **则** ozw 应按 idle follow-up 发送 queue，或给出可见状态修复/等待提示
- **并且** 不得静默吞掉用户消息

## 需求：Pi 手动会话路由保持稳定

用户在 ozw 里看到和打开的会话 id 必须是稳定 `cN` 路由。

### 场景：provider session id 绑定后不生成重复入口

- **给定** 用户创建 `cN` Pi 手动会话
- **且** co 返回 Pi provider session id
- **当** 项目列表加载 Pi sessions
- **则** 列表中该会话只有一个入口
- **并且** 入口 id 仍是 `cN`
- **并且** provider session id 仅作为关联字段保存

### 场景：已有真实会话和过期 counter 时新建会话分配未占用 route

- **给定** 项目配置中已经存在 `chat.1` 和 `chat.2` 两条绑定真实 provider session 的手动会话
- **且** `manualSessionRouteCounter` 因历史数据或迁移残留停留在过期值
- **当** 用户继续新建两条手动会话 draft
- **则** ozw 必须从已有 chat route、manual draft 和 counter 的最大编号之后继续分配 `cN`
- **并且** 不得复用已经存在的 `c1` 或 `c2`
- **并且** `manualSessionRouteCounter` 必须推进到最新已分配 route index

### 场景：draft finalize 前不把 cN 当作真实 provider session

- **给定** 用户新建的手动会话 draft route 是 `cN`
- **当** provider 启动前读取该 route 的 runtime 上下文
- **则** `providerSessionId` 必须为空，表示应启动真正的新 provider 会话
- **当** provider 返回真实 session id 并 finalize 该 route
- **则** `chat.N.sessionId` 必须绑定真实 provider session id
- **并且** 后续读取同一 `cN` route 时必须恢复到该真实 provider session

---

## 需求：长会话首屏必须优先加载尾部最新消息

### 场景：打开 co 长会话默认显示最新消息

- **给定** 一个 co conversation 包含大量历史 turn
- **当** 浏览器请求当前会话消息并携带 `limit`
- **则** 后端必须返回最新尾部窗口
- **且** 返回消息在窗口内保持时间正序
- **且** 不得返回最早的历史消息作为首屏内容

### 场景：上滑加载更早历史按尾部 offset 翻页

- **给定** 用户已经看到最新尾部窗口
- **当** 用户向上加载更早消息
- **则** `offset` 必须表示跳过多少条最新消息
- **且** 后端返回尾部窗口之前的更早消息
- **且** 不得重复返回当前尾部窗口

## 需求：当前会话实时刷新必须能补到新增和更新消息

### 场景：provider 追加新消息后页面自动更新

- **给定** 用户正在查看会话 X
- **当** watcher 收到会话 X 的 provider transcript 或 co turn 事件变化
- **则** 后端发送 scoped `session_changed`
- **且** 前端只刷新会话 X 的消息接口
- **且** 页面显示新增消息，不需要强刷网页

### 场景：同一 assistant 消息内容增长也必须刷新

- **给定** Pi/co 把多段 delta 聚合成同一条 assistant 消息
- **当** 该 assistant 消息内容从短文本增长为更完整文本
- **且** 聚合后的消息数量没有增加
- **则** 增量刷新仍必须返回变更后的尾部消息
- **且** 前端替换或合并当前消息内容

## 需求：消息刷新不得退回全量项目刷新或高频轮询

### 场景：非当前会话变化不打断当前聊天

- **给定** 用户正在查看项目 A 的会话 X
- **当** 项目 A 或项目 B 的会话 Y 追加消息
- **则** 当前聊天页不得请求 `/api/projects`
- **且** 当前 transcript、滚动位置和输入框状态不得被清空

### 场景：自动刷新使用事件驱动而不是固定 interval

- **给定** 普通会话页已经完成初始加载
- **当** 用户没有发送消息也没有切换页面
- **则** 前端不得周期性发送业务状态检查或消息刷新请求
- **且** WebSocket 心跳仍可保留为连接健康检查

---

## 需求：手动会话列表应以 provider JSONL 为来源

ozw 必须把当前项目下存在的 Codex/Pi provider JSONL 作为会话列表来源，并在此基础上过滤可证明属于工作流内部的会话。

### 场景：Pi 命令行会话应进入手动列表

- **给定** 项目下存在一个 Pi JSONL 会话
- **且** 该会话没有 ozw `cN` route 或 `origin=manual` 元数据
- **且** 它没有被任何当前工作流元数据引用
- **当** 前端加载项目手动会话列表
- **则** 该 Pi 会话应出现在 `piSessions`

### 场景：Pi 工作流内部会话仍应被过滤

- **给定** 项目下存在一个 Pi JSONL 会话
- **且** 当前项目 workflow metadata 明确引用该 session id
- **当** 前端加载项目手动会话列表
- **则** 该 Pi 会话不得出现在 `piSessions`

### 场景：Codex 命令行会话应进入手动列表

- **给定** 项目下存在一个 Codex JSONL 会话
- **且** 该会话没有 ozw `cN` route 或 `origin=manual` 元数据
- **且** 它没有被任何当前工作流元数据引用
- **当** 前端加载项目手动会话列表
- **则** 该 Codex 会话应出现在 `codexSessions`

### 场景：Codex 工作流内部会话仍应被过滤

- **给定** 项目下存在一个 Codex JSONL 会话
- **且** 当前项目 workflow metadata 明确引用该 session id
- **当** 前端加载项目手动会话列表
- **则** 该 Codex 会话不得出现在 `codexSessions`

## 需求：oz flow clean 后的残留引用不得隐藏命令行会话

`oz flow clean` 删除工作流子会话 JSONL 后，ozw 不应再因为旧 workflow metadata 或缺少 ozw route 而隐藏其它 provider JSONL。

### 场景：已删除的工作流子会话只是不再出现

- **给定** workflow metadata 仍引用一个旧子会话 session id
- **且** 该子会话 JSONL 已不存在
- **且** 同项目下还有一个命令行直接产生的 provider JSONL
- **当** 前端加载项目手动会话列表
- **则** 已删除的子会话不出现
- **并且** 命令行 provider 会话仍出现

---

## 需求：手动聊天不得依赖 co

ozw 的 Codex/Pi 手动聊天必须由服务端 native agent runtime 直接调用 Codex app-server 或 Pi SDK，不得通过 co request、co conversation 或 co read model。

### 场景：Codex 手动消息直接进入 Codex app-server

- **给定** 用户在项目聊天页选择 Codex
- **当** 用户发送一条新消息
- **则** 服务端应创建或恢复 Codex app-server session
- **并且** 使用 app-server protocol 转发结构化事件
- **并且** 不写入 `co-request-v1`

### 场景：Pi 手动消息直接进入 Pi SDK

- **给定** 用户在项目聊天页选择 Pi
- **当** 用户发送一条新消息
- **则** 服务端应创建或恢复 Pi `AgentSession`
- **并且** 使用 `AgentSession` 事件更新前端
- **并且** 不写入 `co-request-v1`

## 需求：运行中输入必须遵循 provider 原生能力

ozw 必须区分 Codex 和 Pi 的运行中输入能力，不得把所有 provider 都包装成 co steer。

### 场景：Codex 运行中续发不得伪装成 steer

- **给定** Codex 当前会话正在生成回复
- **当** 用户输入第二条消息
- **则** ozw 不得发送 Codex steer
- **并且** ozw 应将该消息作为队列中的下一轮，或在用户选择停止后重新发送

### 场景：Pi 运行中 steer 应在下一次 LLM 调用前生效

- **给定** Pi 当前会话正在执行一轮包含工具调用的回复
- **当** 用户以 steer 方式发送纠正消息
- **则** 该消息应排入 Pi `AgentSession` steering queue
- **并且** 在当前工具执行结束后、下一次 LLM 调用前进入上下文

### 场景：Pi followUp 应在当前 run 自然结束后执行

- **给定** Pi 当前会话正在生成回复
- **当** 用户以 followUp 方式发送下一条消息
- **则** 该消息应排入 Pi follow-up queue
- **并且** 在当前 run 没有更多 tool call 和 steering message 后执行

## 需求：停止与刷新恢复应由 native runtime 保证

ozw 必须通过 provider native runtime 管理停止、完成和消息读取。

### 场景：停止后重新发送不复用旧运行态

- **给定** 任一 provider 当前会话正在运行
- **当** 用户点击停止
- **则** 服务端应 abort 当前 native run
- **并且** 清理该 session 的 active run
- **当** 用户随后发送新消息
- **则** 新消息应作为新的 provider turn 执行

### 场景：刷新页面后已完成消息不丢失

- **给定** 用户已经完成多轮 Codex/Pi 手动聊天
- **当** 用户刷新浏览器并重新打开同一 session
- **则** 页面应从 provider native transcript/session 读取已完成 user/assistant/tool 消息
- **并且** 不依赖 co conversation 数据

## 需求：历史 co 数据不进入新路径

ozw 不需要迁移、读取或展示历史 co conversation。

### 场景：旧 co conversation 不作为新会话来源

- **给定** 本机存在旧的 co conversation 文件
- **当** 用户打开 ozw 项目会话列表
- **则** 旧 co conversation 不应作为 Codex/Pi 手动 session 出现
- **并且** 新发送消息不得续写旧 co conversation

---

## 需求：源码中不再包含 `ccflow` 相关标识符

### 场景：开发者在 `frontend/`、`backend/`、`shared/` 中搜索 `ccflow`

- **当** 执行全文搜索（大小写不敏感）
- **则** 结果中不应出现任何函数名、变量名、常量名、环境变量名或正则表达式名包含 `ccflow`/`Ccflow`/`CCFLOW` 的源码行
- **且** 纯历史注释中提及旧项目名称允许保留，但不应出现在活跃标识符中

### 场景：运行环境变量读取逻辑

- **当** server 启动时读取 `TRUST_LOCALHOST_AUTH`
- **则** 应当读取 `CBW_TRUST_LOCALHOST_AUTH` 环境变量，而不是 `CCFLOW_TRUST_LOCALHOST_AUTH`
- **且** co 客户端已在 49 号提案中彻底移除，不应存在 `CCFLOW_CO_HOME` 或 `CBW_CO_HOME` 的读取逻辑

### 场景：前端读取浏览器本地设置

- **当** `settingsStorage.ts` 读取 localStorage 时
- **则** 应当使用常量 `CBW_SETTINGS_KEY`，其值保持为 `'ozw-settings'`
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

### 场景：执行全部自动化测试

- **当** 运行 `pnpm run test:server` 时
- **则** 所有 server 测试应当通过
- **当** 运行 `pnpm run test:spec:node` 时
- **则** 所有 spec node 测试应当通过
- **当** 运行 `pnpm run test:e2e` 时
- **则** 端到端测试应达到基线水平（允许保留历史基础设施债务导致的基线失败）
- **当** 运行 `pnpm run test:spec:browser` 时
- **则** browser spec 测试应达到基线水平（允许保留历史浏览器自动化基础设施债务导致的基线失败）

---

## 需求：provider 原生事件直接驱动运行中消息渲染

### 场景：Codex JSONL 尚未落盘时页面也能显示 assistant 内容

- **给定** 用户在 ozw 中发起 Codex 手动聊天
- **且** Codex app-server 已通过 WebSocket 返回 `agent_message` item
- **且** provider JSONL 尚未可读或尚未包含完整 assistant 内容
- **当** 前端收到 `codex-response`
- **那么** 页面应直接显示该 assistant 内容
- **并且** 同一 `itemId` 的后续 update 应更新同一条消息而不是追加重复气泡

### 场景：Codex 文件变更协议 JSON 不进入聊天正文

- **给定** 用户打开 Codex 会话页面
- **当** 前端收到 `codex-response`，其中 `data.type = "item"`、`itemType = "agent_message"`，但 `message.content` 是 `type: "add"`、`type: "update"` 或同类新建/更新/写入文件操作 JSON 字符串
- **那么** 聊天正文不得显示该 raw JSON
- **并且** 不得显示 `JSON Response`、`"type": "add"`、`"type": "update"` 这类协议结构
- **并且** 不得把文件写入内容直接当作普通 assistant 正文
- **并且** 真实 assistant 文本仍保持可见

### 场景：Codex 真实 JSON 输出仍可显示

- **给定** Codex 输出的是用户可见正文，或用户明确要求 Codex 输出 JSON
- **当** 前端收到对应 live event 或从持久化 read model 恢复
- **那么** 正文仍应显示
- **并且** 真实业务 JSON 仍可走现有 JSON renderer，不得被协议过滤误删

### 场景：Pi streaming delta 合并为同一条 assistant 消息

- **给定** 用户在 ozw 中发起 Pi 手动聊天
- **当** Pi SDK 连续返回同一 `messageId` 的 text delta
- **那么** 页面应把这些 delta 合并为一条 assistant 消息
- **并且** 不依赖 `/messages` 反复读取 JSONL 才能看到运行中内容

## 需求：provider JSONL 只作为持久历史来源

### 场景：完成后用 provider JSONL reconcile，不重复显示 live 消息

- **给定** 一个 Codex 或 Pi turn 已通过 live transcript 展示
- **当** provider JSONL/session store 完成落盘
- **并且** 前端执行最终 history reconcile
- **那么** persisted transcript 应替换或确认 live message
- **并且** 同一 user/assistant/tool 消息不得重复显示或乱序

### 场景：长历史仍按需加载

- **给定** 一个包含大量历史消息的 Codex/Pi 会话
- **当** 用户打开该会话
- **那么** ozw 仍只加载最新窗口
- **并且** 用户向上滚动或点击加载时才加载更早消息
- **并且** 前端 DOM 挂载消息数量仍有上限

## 需求：`conf.json` 只保存元数据

### 场景：发送运行中消息不会写入 pending transcript

- **给定** 用户发送 Codex/Pi 消息
- **当** provider session id 还未最终落盘到 provider history
- **那么** ozw 不得把 `pendingUserMessages`、`pendingProviderSessionId`、`startRequestId`、`cancelRequested` 写入 XDG `conf.json`
- **并且** 刷新恢复应使用 native runtime live snapshot 或 provider JSONL，而不是 config 中的 pending transcript

## 需求：正常请求取消不得污染浏览器错误证据

刷新、路由切换或组件卸载导致的 slash commands 请求取消是正常生命周期结果，不应作为用户可见错误或 QA 阻塞项。

### 场景：slash commands 请求被页面生命周期取消

- **给定** 用户打开项目页面或会话页面，前端正在加载 slash commands
- **当** 页面刷新、路由切换、组件卸载或浏览器取消该请求
- **那么** 前端不得写入 `Error fetching slash commands` console error
- **并且** 不得展示可见错误提示
- **并且** QA 证据必须能把该取消归类为 expected cancellation，而不是 unhandled network failure

### 场景：slash commands 真实服务失败仍可诊断

- **给定** `/api/commands/list` 返回 HTTP 5xx、认证错误或非取消型网络失败
- **当** 前端捕获该失败
- **那么** 仍必须保留错误诊断或可恢复状态
- **并且** 不得把真实失败误分类为 expected cancellation

### 场景：项目内 `.ozw/conf.json` 不再参与配置读写

- **给定** 项目目录中存在旧 `<project>/.ozw/conf.json`
- **当** ozw 读取或保存项目配置
- **那么** ozw 只使用 XDG state 下的 config
- **并且** 不创建、不读取、不更新项目内 `.ozw/conf.json`

## 需求：co 兼容和 co 数据彻底清理

### 场景：生产代码不再包含 co 文件协议入口

- **给定** ozw 已使用 Codex app-server 与 Pi native SDK
- **当** 构建或测试生产源码
- **那么** `backend/co-client.ts`、`backend/co-read-model.ts` 和 co request/state/event 兼容入口不应存在
- **并且** 手动聊天路径不读取 `CCFLOW_CO_HOME` 或 `co-request-v1` / `co-conversation-v1`

### 场景：升级后删除 ozw legacy co state

- **给定** 用户本机存在旧 `${XDG_STATE_HOME}/ozw/co` 目录
- **当** ozw 启动或执行迁移 cleanup
- **那么** ozw 应幂等删除该 legacy co state
- **并且** 不删除 `~/.codex`、`~/.pi` 等 provider 原生历史数据

---

## 需求：实时流式消息的类型标志必须与持久化消息一致

### 场景：Pi thinking delta 实时渲染为正文同款 Markdown

Given 一个 Pi 手动会话正在流式传输 thinking_delta
When `reduceNativeRuntimeEvent` 处理 `itemType: 'reasoning'` 事件
Then 生成的消息必须满足：
- `type === 'assistant'`
- `isThinking === true`
- `content` 为合并后的 thinking 文本

当该消息被 `MessageComponent` 渲染时：
- 必须使用 `<Markdown>` 组件渲染内容
- 必须使用与助手正文一致的字号和文字颜色
- 不得使用灰色左竖线、额外缩进或斜体弱化思考正文

### 场景：Pi tool_call 实时渲染为工具卡片

Given 一个 Pi 手动会话正在执行工具
When `reduceNativeRuntimeEvent` 处理 `itemType: 'tool_call'` 或 `itemType: 'tool_result'` 事件
Then 生成的消息必须满足：
- `type === 'assistant'`
- `isToolUse === true`
- `toolName` 和 `toolInput`/`toolResult` 正确填充

当该消息被 `MessageComponent` 渲染时：
- 不得显示 🔧 icon 和 "工具" label
- 必须使用 `ToolRenderer` 渲染工具卡片

### 场景：Codex reasoning item 同样使用 assistant + isThinking

Given 一个 Codex 会话返回 `itemType: 'reasoning'`
When `reduceNativeRuntimeEvent` 处理该事件
Then 生成的消息必须满足：
- `type === 'assistant'`
- `isThinking === true`
- 渲染时与 Pi thinking 使用同一正文样式契约

### 场景：更新后的历史测试断言不 regress

Given 50 号提案的 `native-live-transcript.test.ts` 已更新断言
When 运行 `pnpm test tests/2026-05-28-50-...native-live-transcript.test.ts`
Then 所有测试必须通过，且不得出现 `type === 'reasoning'` 或 `type === 'tool'` 的断言

---

### 需求：Pi 前端必须支持模型选择

#### 场景：Pi provider 激活时展示模型控件

- 假设用户在聊天界面选择 Pi provider
- 当 composer 渲染完成
- 那么用户应看到 Pi 模型控制入口
- 并且该入口展示当前 Pi 模型摘要

#### 场景：用户切换 Pi 模型

- 假设用户打开 Pi 模型控制入口
- 当用户选择另一个 Pi 可用模型
- 那么前端应更新当前 Pi 模型状态
- 并且将会话级 model-state 持久化为新模型
- 并且下一次 Pi 发送应携带该模型

### 需求：Pi 前端必须支持思考深度选择

#### 场景：Pi reasoning 模型展示可用思考深度

- 假设 Pi 模型目录中某模型支持 reasoning
- 当用户选择该模型
- 那么思考深度下拉应展示该模型支持的 levels
- 并且不展示 `thinkingLevelMap` 中标记为 `null` 的 level

#### 场景：Pi 非 reasoning 模型只允许关闭思考

- 假设 Pi 模型目录中某模型 `reasoning=false`
- 当用户选择该模型
- 那么思考深度只能选择 `off`

#### 场景：用户切换 Pi 思考深度

- 假设用户正在 Pi 会话中
- 当用户选择 `high` 思考深度
- 那么前端应更新 `piThinkingLevel`
- 并且会话 model-state 应保存 `thinkingLevel=high`
- 并且下一次 Pi 发送应携带 `thinkingLevel=high`

### 需求：Pi 发送链路必须传递模型和思考深度

#### 场景：发送 Pi 普通消息

- 假设 active provider 是 Pi
- 且当前模型为 `anthropic/claude-sonnet-4-5`
- 且当前思考深度为 `high`
- 当用户发送消息
- 那么 websocket `pi-command` 的 options 必须包含 `model` 和 `thinkingLevel`
- 并且不得使用 Codex-only 字段 `reasoningEffort` 表达 Pi 思考深度

#### 场景：服务端接收 Pi 消息

- 假设服务端收到带 `model` 和 `thinkingLevel` 的 `pi-command`
- 当调用 native runtime
- 那么 `sendNativeMessage({ provider: 'pi' })` 必须收到相同的 `model` 和 `thinkingLevel`

### 需求：Pi runtime 必须应用模型和思考深度

#### 场景：新建 Pi 会话

- 假设当前没有 Pi AgentSession
- 当用户发送带 `model` 和 `thinkingLevel` 的 Pi 消息
- 那么 runtime 应使用对应模型和思考深度创建 `createAgentSession()`

#### 场景：复用 idle Pi 会话

- 假设当前 Pi AgentSession 已存在且没有 streaming
- 当用户切换模型或思考深度后发送消息
- 那么 runtime 应在 prompt 前调用 `setModel()` 或 `setThinkingLevel()` 应用变更

#### 场景：Pi 会话运行中继续输入

- 假设当前 Pi AgentSession 正在 streaming
- 当用户发送运行中输入
- 那么 runtime 应通过 Pi 原生 `streamingBehavior='steer'` 或 `streamingBehavior='followUp'` 入队
- 并且不强制切换当前 turn 的模型或思考深度

### 需求：Pi steer/follow-up 队列状态必须对前端可见

#### 场景：Pi queue_update 转发到前端

- 假设 Pi SDK 发出 `queue_update`
- 当 runtime 收到事件
- 那么服务端应发送前端事件 `session-queue-state`
- 并且包含 `steering` 和 `followUp` 队列数组

#### 场景：用户看到运行中输入语义

- 假设 Pi 会话正在运行
- 当用户准备继续输入
- 那么 UI 应能表达本次输入将 steer 当前 turn 或作为 follow-up later

### 需求：会话 model-state 必须支持 Pi thinkingLevel

#### 场景：保存 Pi thinkingLevel

- 假设用户在 Pi 会话中选择 `xhigh`
- 当前端调用 model-state 保存接口
- 那么项目配置应记录 `thinkingLevel=xhigh`

#### 场景：重新打开 Pi 会话

- 假设项目配置中已有 `thinkingLevel=medium`
- 当用户重新打开该 Pi 会话
- 那么前端应恢复 `piThinkingLevel=medium`

#### 场景：Codex 不受影响

- 假设 Codex 会话仍使用 `reasoningEffort`
- 当保存或读取 Pi `thinkingLevel`
- 那么 Codex 的 `reasoningEffort` 行为不得改变

### 需求：聊天 Markdown 只把可打开目标渲染为链接

#### 场景：Assistant 回复包含真实文件、目录、缺失路径和普通文本链接

- 假设当前项目中存在文件 `src/openable-link.ts`
- 并且当前项目中存在目录 `src/folder-only/`
- 并且当前项目中不存在 `src/missing-link.ts`
- 当 Assistant 回复 Markdown 中同时包含这四类引用
- 那么 `src/openable-link.ts` 必须显示为可点击链接，并且点击后打开嵌入式编辑器
- 并且 `src/folder-only/` 必须作为普通文本展示，不得有链接角色或蓝色链接样式
- 并且 `src/missing-link.ts` 必须作为普通文本展示，不得有链接角色或蓝色链接样式
- 并且普通文字 href（如 `just words`）必须作为普通文本展示，不得被当成项目路径

#### 场景：外部 URL 保持浏览器链接

- 假设 Assistant 回复包含 `https://example.com/docs`
- 当前端渲染聊天 Markdown
- 那么该链接仍必须是浏览器外链
- 并且必须保留 `target="_blank"` 和 `rel="noopener noreferrer"`
