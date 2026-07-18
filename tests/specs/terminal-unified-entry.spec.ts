/**
 * Sources: 2026-07-06-37-终端统一入口与tmux保活
 *
 * PURPOSE: Verify terminal entry, tmux persistence, explicit record view, and
 * desktop terminal layout stay aligned with the durable terminal contract.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = process.cwd();
const PROJECT_OVERVIEW_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'main-content',
  'project-overview',
  'ProjectOverviewPanelRuntime.impl.tsx',
);
const WORKSPACE_NAV_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'app', 'ProjectWorkspaceNav.tsx');
const MAIN_CONTENT_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'main-content', 'view', 'MainContent.tsx');
const WORKSPACE_LAYOUT_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'main-content',
  'view',
  'subcomponents',
  'WorkspaceDockLayout.tsx',
);
const WORKSPACE_LAYOUT_STATE_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'main-content',
  'hooks',
  'useWorkspaceLayoutState.ts',
);
const SHELL_CONNECTION_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'shell', 'hooks', 'useShellConnection.ts');
const SHELL_RUNTIME_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'shell', 'hooks', 'useShellRuntime.ts');
const SHELL_VIEW_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'shell', 'view', 'Shell.tsx');
const SHELL_TYPES_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'shell', 'types', 'types.ts');
const CHAT_INTERFACE_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'chat', 'view', 'ChatInterface.tsx');
const SHELL_WEBSOCKET_PATH = path.join(REPO_ROOT, 'backend', 'server', 'shell-websocket.ts');
const CODEX_ATTACH_PLAN_PATH = path.join(REPO_ROOT, 'backend', 'server', 'codex-terminal-attach-plan.ts');
const TMUX_RUNTIME_PATH = path.join(REPO_ROOT, 'backend', 'server', 'terminal-tmux-runtime.ts');

/**
 * Read a required source file for stable business-boundary assertions.
 */
function readRequiredSource(filePath: string, businessName: string): string {
  assert.equal(fs.existsSync(filePath), true, `缺少 ${businessName}: ${path.relative(REPO_ROOT, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Read source files involved in session-card and new-session terminal entry.
 */
function readSessionEntrySources(): {
  overviewSource: string;
  combinedSource: string;
} {
  const overviewSource = readRequiredSource(PROJECT_OVERVIEW_PATH, '项目总览会话卡片');
  const combinedSource = [
    overviewSource,
    readRequiredSource(WORKSPACE_NAV_PATH, '工作区会话导航'),
    readRequiredSource(MAIN_CONTENT_PATH, '主工作区'),
    readRequiredSource(SHELL_CONNECTION_PATH, '终端连接 hook'),
    readRequiredSource(CHAT_INTERFACE_PATH, '会话记录视图'),
  ].join('\n');

  return { overviewSource, combinedSource };
}

/**
 * Read desktop layout sources that can restore or render terminal placement.
 */
function readDesktopLayoutSources(): string {
  return [
    readRequiredSource(MAIN_CONTENT_PATH, '主工作区'),
    readRequiredSource(WORKSPACE_LAYOUT_PATH, '工作区 dock 布局'),
    readRequiredSource(WORKSPACE_LAYOUT_STATE_PATH, '工作区布局状态'),
  ].join('\n');
}

test('会话卡片用 cN 短路由打开终端', () => {
  const { overviewSource, combinedSource } = readSessionEntrySources();

  assert.match(
    overviewSource,
    /handleSessionCardClick[\s\S]{0,1000}onOpenSessionTerminal\(session\)/,
    '会话卡片点击必须通过终端入口选择会话',
  );
  assert.match(
    combinedSource,
    /handleOpenSessionTerminal[\s\S]{0,260}setActiveTab\(['"]shell['"]\)[\s\S]{0,260}onSelectSession\(session\)/,
    '终端入口必须先切到终端视图，再复用现有会话短路由导航',
  );
  assert.match(
    combinedSource,
    /<StandaloneShell[\s\S]{0,260}session=\{selectedSession\}[\s\S]{0,260}isPlainShell=\{!selectedSession\}/,
    '终端恢复必须从当前 selectedSession 传递会话身份',
  );
  assert.doesNotMatch(
    combinedSource,
    /terminalLaunchCommand|terminalSessionId|terminalProviderSessionId|terminalRouteIndex|terminalSessionProvider/,
    '会话卡片入口不得把启动命令或会话身份写入 URL 查询参数',
  );
  assert.match(combinedSource, /project-new-session-provider-codex/, '新建会话必须保留 Codex provider 入口');
  assert.match(combinedSource, /project-new-session-provider-pi/, '新建会话必须保留 Pi provider 入口');
  assert.doesNotMatch(
    combinedSource,
    /会话终端|managedSessionTerminal|sessionTerminalOnly|isSessionTerminal/,
    '界面和前端状态不应引入“会话终端”用户概念',
  );
});

test('移动端会话终端传递 cN 身份而不是降级为普通 Shell', () => {
  /** 锁定移动分支，避免桌面分支的正确属性掩盖移动端回归。 */
  const mainContentSource = readRequiredSource(MAIN_CONTENT_PATH, '主工作区');
  const mobileWorkspaceSource = mainContentSource.match(
    /const renderMobileWorkspace[\s\S]*?const renderMobileShell/,
  )?.[0] || '';

  assert.match(mobileWorkspaceSource, /session=\{selectedSession\}/, '移动终端必须传递选中的 cN 会话');
  assert.match(mobileWorkspaceSource, /isPlainShell=\{!selectedSession\}/, '仅无会话时才能打开普通 Shell');
  assert.match(
    mobileWorkspaceSource,
    /key=\{`[^`]*\$\{selectedSession\?\.__provider[^`]*\$\{selectedSession\?\.id/,
    '移动终端实例键必须包含 provider 和 session，切换会话时才能重建连接',
  );
});

test('tmux 承载所有终端且 close 只 detach', () => {
  const shellSource = readRequiredSource(SHELL_WEBSOCKET_PATH, 'shell WebSocket relay');
  const runtimeSource = readRequiredSource(TMUX_RUNTIME_PATH, 'tmux terminal runtime');
  const shellRuntimeSource = readRequiredSource(SHELL_RUNTIME_PATH, '前端 shell runtime');
  const mainContentSource = readRequiredSource(MAIN_CONTENT_PATH, '主工作区终端视图');
  const combinedSource = `${shellSource}\n${runtimeSource}`;

  assert.match(combinedSource, /\btmux\b/, '后端必须显式使用 tmux 承载终端');
  assert.match(combinedSource, /has-session|list-sessions/, '后端必须能检测已有 tmux session');
  assert.match(combinedSource, /new-session|new\s+-d|-d\s+-s/, '后端必须能创建后台 tmux session');
  assert.match(combinedSource, /attach-session|attach\s+-t|capture-pane/, '后端必须能重新 attach 或读取 session');
  assert.match(shellSource, /pane_current_path/, '复连前必须检查 tmux pane 的工作目录');
  assert.match(shellSource, /!\s*-d[\s\S]{0,40}pane_path/, '失效工作目录必须被识别');
  assert.match(shellSource, /tmux kill-session/, '失效工作目录对应的 tmux session 必须被清理');
  assert.match(combinedSource, /send-keys|load-buffer|paste-buffer/, '启动命令必须通过 tmux 输入通道注入');
  assert.doesNotMatch(shellSource, /keepSessionAliveOnDisconnect\s*=\s*!isPlainShell/, '普通 shell 和 TUI 不得分叉保活策略');
  assert.doesNotMatch(
    shellSource,
    /ws\.on\(['"]close['"][\s\S]{0,1800}(?:pty\.kill|shellProcess\.kill)/,
    'WebSocket close 不能直接 kill 终端进程',
  );
  assert.match(shellSource, /detach-client/, 'WebSocket close 必须 detach 当前 tmux client');
  assert.match(shellSource, /execFile\(['"]tmux['"]/, 'tmux 生命周期命令必须真实执行');
  assert.match(
    shellSource,
    /killSessionArgs[\s\S]{0,240}executeTmuxLifecycleCommand\(killSessionArgs,\s*['"]kill-session['"]\)/,
    '显式终止路径必须实际执行 tmux kill-session',
  );
  assert.match(shellRuntimeSource, /type:\s*['"]kill_terminal['"]/, '前端必须能发送终止终端消息');
  assert.match(
    mainContentSource,
    /terminalTerminateHandlersRef\.current\.get\(activeTerminalId\)\?\.\(\)/,
    '删除活动终端必须调用当前终端的显式终止函数',
  );
});

test('tmux session 名称使用项目短路径和 cN 路由', async () => {
  const runtimeModule = await import(pathToFileURL(TMUX_RUNTIME_PATH).href);

  assert.equal(
    runtimeModule.createTmuxSessionName('/home/zzl/projects/ozw_codex_route:c7'),
    'ozw_projects_ozw_c7',
    'tmux session 名称应类似 projects/ozw/cN，并统一转成下划线',
  );
  assert.match(
    runtimeModule.createLegacyTmuxSessionName('/home/zzl/projects/ozw_codex_route:c7'),
    /^ozw_[A-Za-z0-9_-]+$/,
    '旧 base64 名称必须保留，供已有 tmux 会话兼容复连',
  );
});

test('旧式会话强制接管必须先警告并绑定新式共享会话', () => {
  /** 用户确认后由后端创建共享线程并绑定同一卡片，前端不得自行制造 provider 身份。 */
  const shellViewSource = readRequiredSource(SHELL_VIEW_PATH, 'Shell 接管警告');
  const shellConnectionSource = readRequiredSource(SHELL_CONNECTION_PATH, 'Shell 接管协议');
  const shellTypesSource = readRequiredSource(SHELL_TYPES_PATH, 'Shell 接管类型');
  const backendSource = readRequiredSource(SHELL_WEBSOCKET_PATH, 'Shell WebSocket relay');
  const attachPlanSource = readRequiredSource(CODEX_ATTACH_PLAN_PATH, 'Codex 接管规划器');

  assert.match(shellViewSource, /force-codex-handoff/, '警告栏必须提供明确的强制接管按钮');
  assert.match(shellViewSource, /window\.confirm/, '强制接管必须二次确认风险');
  assert.match(shellTypesSource, /forceHandoff\?:\s*boolean/, 'init 协议必须显式表达强制接管');
  assert.match(shellConnectionSource, /forceHandoff:\s*true/, '确认后必须复用当前 init 身份发送强制请求');
  assert.match(backendSource, /handoff-warning/, '普通打开旧式活动会话只能返回警告');
  assert.match(backendSource, /handoff-force-started/, '服务端接受确认后必须回执接管开始');
  assert.match(backendSource, /beginCodexRemoteTuiThreadCapture/, '强制接管必须由共享 daemon 建立线程');
  assert.match(backendSource, /writeProviderSessionBinding/, '共享线程必须绑定回原 Ozw 卡片');
  assert.match(
    attachPlanSource,
    /action:\s*'new-shared-tui'/,
    '活动旧线程的强制分支必须显式建立共享会话',
  );
});

test('记录视图显式打开，桌面终端作为主工作区视图', () => {
  const layoutSource = readDesktopLayoutSources();
  const chatSource = readRequiredSource(CHAT_INTERFACE_PATH, '会话记录渲染视图');

  assert.doesNotMatch(
    layoutSource,
    /bottomDock|BottomDock|dock-panel-bottom|moveTerminalToBottom|onBottomDock/,
    '桌面终端应迁移为主工作区平行视图，不应保留 bottom dock 终端状态',
  );
  assert.match(
    layoutSource,
    /activeTab\s*={0,2}\s*['"]shell['"]|terminalMainView|workspaceTerminalView|<StandaloneShell/,
    '桌面主工作区必须仍然能渲染终端视图',
  );
  assert.match(
    chatSource,
    /renderSnapshotRequestId|renderSnapshot|会话记录|记录视图|查看记录|详情/i,
    '必须保留用户主动查看 JSONL 渲染内容的记录/详情入口',
  );
  assert.doesNotMatch(
    chatSource,
    /selectedSession[\s\S]{0,240}loadSessionMessages\(/,
    '默认选中会话不应立即把 JSONL 加载作为唯一主视图',
  );
});
