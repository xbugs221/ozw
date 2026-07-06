/**
 * 文件目的：约束会话卡片和新建会话默认打开普通终端并注入启动命令。
 * 业务场景：用户点击会话是为了继续在终端中操作 TUI，而不是默认查看 JSONL 记录。
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
const SHELL_CONNECTION_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'shell', 'hooks', 'useShellConnection.ts');
const CHAT_INTERFACE_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'chat', 'view', 'ChatInterface.tsx');

/**
 * 读取必须存在的前端源码，确保断言覆盖真实入口。
 */
function readRequiredSource(filePath: string, businessName: string): string {
  assert.equal(fs.existsSync(filePath), true, `缺少${businessName}: ${path.relative(REPO_ROOT, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * 拼接会话入口相关源码，方便跨组件检查用户路径。
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

test('会话卡片点击默认打开终端并注入恢复命令', () => {
  const { overviewSource, combinedSource } = readSessionEntrySources();

  assert.doesNotMatch(
    overviewSource,
    /handleSessionCardClick[\s\S]{0,1000}onSelectSession\(session\)/,
    '会话卡片点击不得再直接选择会话并进入 JSONL 渲染页',
  );
  assert.match(
    combinedSource,
    /openSessionTerminal|openTerminalForSession|sessionLaunchCommand|terminalLaunchCommand|injectShellCommand/,
    '前端必须有会话入口到终端启动命令的显式桥接',
  );
  assert.match(
    combinedSource,
    /codex\s+(?:resume|--resume)|pi\s+--session/,
    '会话恢复命令必须覆盖 Codex 和 Pi 的真实 CLI 入口',
  );
  assert.match(
    combinedSource,
    /会话记录|查看记录|记录视图|详情|chat-render-snapshot-button|renderSnapshot/i,
    'JSONL 渲染必须保留为用户显式点击的记录/详情入口',
  );
});

test('新建会话复用普通终端入口，不引入会话终端概念', () => {
  const { combinedSource } = readSessionEntrySources();

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
    '界面和前端状态不应引入“会话终端”这种用户概念',
  );
});
