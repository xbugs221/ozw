# 规格：TypeScript 工具链与测试入口

约束 TypeScript 迁移、构建缓存、Node 运行入口、测试入口和分类。

## 测试入口

- `pnpm exec tsx --test tests/spec/test_suite_taxonomy.ts`
- `pnpm exec tsx --test tests/specs/typescript-tooling-cache.spec.ts`
- `pnpm exec tsx --test tests/manual/node-history/typescript-config-contract.ts`

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
- **且** 构建必须复制后端手写 JS 运行时文件，保证 `dist-node` 生产入口可直接启动

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
