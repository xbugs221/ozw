# 设计：独立 Hermes Transcript Inspector Dashboard 插件

## 责任边界

| 层 | 责任 |
| --- | --- |
| Hermes Dashboard | 认证、profile 作用域、Session REST API、插件加载与导航 |
| 共享归一化内核 | structured content 解码、compression lineage、reasoning 去重、tool call/result 配对、稳定事件键 |
| Inspector 插件 | 会话选择、深链、分页、turn 分组、折叠详情和只读提示 |
| ozw | 继续使用共享归一化语义；不参与插件运行 |

## 文件边界

```text
shared/
└─ hermes-transcript-inspector.ts       # 无 React/Node IO 的纯转换合同

integrations/hermes-dashboard-inspector/
├─ README.md
├─ package.json                         # 仅构建插件产物
└─ dashboard/
   ├─ manifest.json
   ├─ src/
   │  ├─ index.tsx                      # SDK 注册与路由入口
   │  ├─ session-api.ts                 # 只调用 Dashboard REST
   │  ├─ inspector-view.ts              # 会话选择与数据加载
   │  └─ transcript-components.ts       # 消息/reasoning/工具 React 组件
   └─ dist/
      ├─ index.js                       # IIFE；React external
      └─ style.css
```

插件安装目录为：

```text
$HERMES_HOME/plugins/hermes-transcript-inspector/dashboard/
```

## 数据流

```text
URL ?profile=<p>&session=<sid>
       │
       ├─ GET /api/sessions/<sid>/latest-descendant?profile=<p>
       ├─ GET /api/sessions/<sid>?profile=<p>       # 向上识别 compression parent
       └─ GET /api/sessions/<sid>/messages?...      # 每个 lineage 节点分页
                         │
                         ▼
               normalizeHermesTranscript()
                         │
                         ▼
           Turn[] → ordered display events / final body
```

## 关键决策

### 1. 第一版使用现有 REST，不新增插件后端

- `fetchJSON` 自动继承 Dashboard 的 loopback token 或认证 cookie。
- 不让插件直接打开 SQLite，因此没有网络文件系统、WAL 或写锁问题。
- REST 缺失必要字段时，先扩充 Hermes 的公共只读 Session 响应；只有公共 API 无法表达 lineage 时才增加 `plugin_api.py`。

### 2. 复用语义，不搬整个 ozw ChatInterface

抽取的共享代码必须是纯函数，不依赖 React、i18n、项目状态、文件编辑器、TUI、WebSocket 或 ozw API。共享合同包含：

- `\0json:` structured content 解码。
- 仅把 compression continuation 当作同一显示 lineage；普通 branch/delegate 不合并。
- 邻接 compression user echo 去重。
- `reasoning`、`reasoning_content`、`reasoning_details` 去重并保留来源。
- assistant `tool_calls` 与 role=`tool` 通过 `tool_call_id` 配对。
- turn 内使用有序事件联合类型保存 assistant commentary、reasoning 和 tool call；禁止用 `reasoning[]`、`tools[]`、`assistant[]` 三个类型桶重新排序。
- tool result 只补全原 tool call 事件，不能在结果消息位置新建或移动第二张卡。
- 稳定事件键、字段大小限制和分页边界提示。

插件 UI 使用 Dashboard SDK 提供的 React 与基础组件，不能打包第二份 React。展示层独立实现，以避免把 ozw 的全局状态和样式系统带入宿主。

### 3. 独立 Tab，不覆盖原生 Sessions

manifest 注册 `/session-inspector`，位置在 Sessions 后。第一版插件内部提供会话列表和搜索，并支持：

```text
/session-inspector?profile=worker&session=20260814_abcd
```

现有 SDK 没有带行上下文的 `sessions:row-actions`。本轮不覆盖 `/sessions`、不操作 DOM。若独立 Tab 被持续使用，再单独为 Dashboard 提议通用 row-action 插槽。

### 4. Turn 是展示单元，事件顺序是硬合同

```text
Turn
├─ user prompt
├─ process details（完成历史默认折叠）
│  ├─ assistant commentary
│  ├─ reasoning event
│  ├─ tool group
│  │  └─ tool call + attached result
│  ├─ assistant commentary
│  ├─ reasoning event
│  └─ tool group
│     └─ failed tool call + attached error
└─ assistant final Markdown body
```

- 跨数据库消息行严格保持 lineage 节点顺序和节点内消息顺序；同一 `tool_calls` 数组保持数组顺序。
- 完成历史的外层 process details 默认折叠，最终正文保持可见。展开外层后，thinking、tool group、单工具和 output 继续拥有与 ozw 相同的独立折叠层级。
- 多行 thinking 的折叠摘要显示最后一条非空行，展开才显示全文；单行 thinking 直接显示，不制造无意义的内层折叠。
- 工具组摘要显示一次或多次工具调用；组内常见工具使用 ozw 的紧凑语义摘要，例如 terminal 在未展开 output 时也必须显示 `terminal / pwd`，而不是只显示工具名。
- 工具 output 位于对应 call 卡内部并独立折叠；错误在 output 关闭时仍能从该工具摘要识别，展开后错误文本只能出现在所属工具内。
- 未匹配的 tool result 必须显示明确边界提示，不能伪装成普通 assistant 文本。
- `read_file`、`search`、`plan`、`subagent` 等已知工具使用业务摘要适配器，闭合时分别优先显示路径、query/scope、步骤数、委托 description；完整对象只进入内层参数 disclosure。
- tool-only turn 复用 OZW `TurnNonBodyGroup` 的专门分支：`turn-tool-list-group` 外层默认闭合，展开后 `turn-tool-list` 内层仍默认闭合；两层状态互不连带。
- 只展示数据库实际返回的 reasoning；页面文案明确不代表隐藏 chain-of-thought。

Hermes 把 `reasoning_content`、`content` 与 `tool_calls` 存在同一个 assistant 数据库行时，没有保存这些字段在模型流中的精确交错位置。插件不能伪造不存在的精度：同一行采用与 OZW Hermes read model 一致的稳定协议投影 `reasoning → tool_calls[] → content/commentary`；验收只把跨行顺序称为真实顺序。

### 4.1 主视图必须复刻 ozw 当前折叠层级，而不是挂组件名字

用户最新反馈明确指出，原实现虽然通过测试，却把主阅读体验退化成了字段和 JSON 查看器。修正后的组件边界为：

```text
TranscriptTimeline
└─ TranscriptTurn
   ├─ MessageBubble(role=user)
   ├─ TurnNonBodyGroup（completed 默认 closed）
   │  ├─ ThinkingGroup / assistant commentary（有序）
   │  └─ ToolGroup
   │     └─ CompactToolRow
   │        └─ ToolOutputDisclosure
   ├─ AssistantMarkdown（最终正文）
   └─ RawRecordPanel（辅助、默认不存在）
```

- 对齐基线是验收时仓库内 `frontend/components/chat/view/subcomponents/TurnNonBodyGroup.tsx`、`MessageComponent.tsx`、`frontend/components/chat/tools/ToolRenderer.tsx`、`CollapsibleDisplay.tsx` 与 `OneLineDisplay.tsx`；历史截图只用于人工对照。
- 用户消息采用右侧状态气泡，assistant 最终正文采用左侧 Markdown 流；过程容器、工具组和工具行使用 ozw 的紧凑边框、缩进、类别色条和 terminal 命令样式，不能退化成占满主列的大号通用卡片。
- 常见 Markdown 标题、无序/有序列表、链接、行内代码和 fenced code 必须成为正确的真实 DOM 结构，不得作为原始字符串显示。
- raw JSON 默认不渲染；显式开启后只能追加辅助区域，不能改变有序事件、已展开卡片或最终正文，也不能替代上述任一组件。
- `data-component`、`data-testid` 只用于定位；验收以真实 `<details>` open 状态、可见性、DOM 语义、父子归属、视觉坐标与用户交互为准。

### 4.2 响应式阅读合同

- 1440×900 下保持可读主列和 ozw 风格的紧凑垂直密度；折叠摘要直接传达 thinking、工具命令和错误，而不是迫使用户全部展开。
- 390×844 下 session picker 默认收起但仍可打开；所选会话标题、用户气泡和 process summary 必须进入第一屏。
- 移动端页面不得产生整页横向滚动；长 command、tool output 与 fenced code 只能在自身区域换行或局部滚动。
- 固定截图覆盖 desktop default、process open、单工具 output、错误 output、Markdown，以及 mobile default、mobile process open；截图生成前必须通过行为断言。

### 4.3 三方同语义对照和动态证据

真实验收在同一浏览器 context 中提供一个临时 OZW parity harness。harness 直接 import 当前仓库的 `TurnNonBodyGroup`、`MessageComponent`、`ToolRenderer` 链与 `frontend/index.css`，不能复制组件输出或另写一套近似 CSS。它使用同一组 synthetic `ChatMessage`（user、R1、T1/result、commentary、R2、T2/error、final），分别以 Codex 和 Claude provider 渲染，且向直接调用的 `MessageComponent` 传递原 source index 对应的 `prevMessage`。

该 harness 的结论严格限定为 OZW 当前生产 renderer parity。它没有从 Codex JSONL 或 Claude 原始 transcript 开始走 native normalizer，因此不能被描述为 native raw normalizer parity。

```text
同语义 fixture / 1440×900 / 同展开状态
├─ OZW Codex：真实当前组件
├─ OZW Claude：真实当前组件
└─ Hermes Dashboard：真实插件 + SessionDB
```

- 三方固定截图都必须停在 `outer open → R1 thinking open → T1 tool group open → T1 Output open → T2 group closed`，使层级和信息密度可直接并排审核。
- 三方截图只裁 transcript 区，固定为同一 760×640 crop；若 surface 起点不同，在 evidence ledger 中记录 crop anchor，不能拿包含不同导航 chrome 的整页图宣称样式一致。
- Hermes、OZW Codex、OZW Claude 各自保存折叠操作视频，或保存能等价证明四层状态变化的 trace；仅有最终静态图不算动态证据。
- 每个渲染面都要逐层断言真实 `<details>.open`，并在打开 T1/output 后再次确认 T2 group 仍 closed。
- `parity-metrics.json` 记录三方 outer summary、thinking summary、tool group summary、command card、user bubble 的 fontSize、lineHeight、borderRadius、四向 padding、height，以及 user→outer、outer→thinking 纵向 gap。Codex 为 reference；Claude 与 Hermes 使用窄容差：font 2px、line height 4px、radius 5px、padding 6px、height 14px、gap 12px。宿主主题颜色不比较。
- 对照 harness 和 Dashboard 证据与本次 `runId` 绑定；运行开始先清理旧目录，只有 `evidence-status.json=status:complete` 才可提交。

### 5. 只读是硬边界

- 插件只允许 GET。
- 真实浏览器验收记录 Inspector 生命周期的全部 `/api/` 请求并断言 method 为 GET；仅检查按钮文案不能证明只读。
- UI 不暴露 rename/delete/resume/steer/approval 操作。
- 验收在检视前后比较真实 sessions/messages 业务投影。
- 插件错误不能触发补写、schema migration 或自动修复。

### 6. 构建产物独立

- 产物为 Dashboard 可直接加载的单 JS IIFE 和 CSS。
- React 标记为 external，通过 `window.__HERMES_PLUGIN_SDK__` 获取。
- 构建后安装目录不包含 ozw 后端、数据库、TUI 或应用入口。
- 直接复用的 ozw 代码保持 GPL-3.0；插件以 GPL-3.0 独立分发，不合入 Hermes MIT 核心。

## 风险与控制

| 风险 | 控制 |
| --- | --- |
| Hermes REST 类型未声明 reasoning 字段 | 以真实响应做契约测试；必要时只扩充公共只读类型/字段 |
| 长会话阻塞浏览器 | 500 行以内分页、字段字节上限、按 turn 增量渲染 |
| 按类型收集事件破坏执行顺序 | 使用有序事件联合类型；真实 fixture 故意交错 commentary/reasoning/tool，并按可见纵坐标断言 |
| 同一 assistant 行缺少字段级时序 | 明确稳定协议投影并展示限制，不宣称恢复数据库未保存的交错 |
| compression 与普通 branch 混淆 | 使用 parent `end_reason=compression` 与 delegate/branch 元数据双重判断 |
| Dashboard SDK 演进 | manifest 声明最低 SDK，运行时检查 `sdkVersion` 并显示兼容错误 |
| 共享代码重新耦合 ozw | 共享模块禁止 IO、React、宿主状态依赖，并由两侧行为测试约束 |
| 工具结果包含秘密 | 继承 Dashboard 认证；不缓存到 localStorage，不生成外部遥测 |
| 形式组件绕过验收 | 不按组件数量放行；验证默认状态、逐层交互、真实 Markdown DOM、结果归属和视觉顺序 |

## 延后能力

- 原生 Sessions 行内 Inspector 按钮。
- 实时 tail 和运行中会话自动刷新。
- 文件打开、diff、subagent 树和跨会话比较。
- Inspector 内的任何执行控制。
