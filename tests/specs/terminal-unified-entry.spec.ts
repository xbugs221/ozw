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
const CHAT_INTERFACE_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'chat', 'view', 'ChatInterface.tsx');
const SHELL_WEBSOCKET_PATH = path.join(REPO_ROOT, 'backend', 'server', 'shell-websocket.ts');
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

test('会话卡片和新建会话默认进入普通终端', () => {
  const { overviewSource, combinedSource } = readSessionEntrySources();

  assert.doesNotMatch(
    overviewSource,
    /handleSessionCardClick[\s\S]{0,1000}onSelectSession\(session\)/,
    '会话卡片点击不得直接选择会话并进入 JSONL 渲染页',
  );
  assert.match(
    combinedSource,
    /openSessionTerminal|openTerminalForSession|sessionLaunchCommand|terminalLaunchCommand|injectShellCommand/,
    '前端必须有会话入口到终端启动命令的显式桥接',
  );
  assert.match(combinedSource, /codex\s+(?:resume|--resume)|pi\s+--session/, '恢复命令必须覆盖 Codex 和 Pi');
  assert.match(combinedSource, /project-new-session-provider-codex/, '新建会话必须保留 Codex provider 入口');
  assert.match(combinedSource, /project-new-session-provider-pi/, '新建会话必须保留 Pi provider 入口');
  assert.match(
    combinedSource,
    /newSessionLaunchCommand|createSessionLaunchCommand|openTerminalForNewSession|terminalLaunchCommand/,
    '选择 provider 后必须生成启动命令并打开终端',
  );
  assert.doesNotMatch(
    combinedSource,
    /会话终端|managedSessionTerminal|sessionTerminalOnly|isSessionTerminal/,
    '界面和前端状态不应引入“会话终端”用户概念',
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
