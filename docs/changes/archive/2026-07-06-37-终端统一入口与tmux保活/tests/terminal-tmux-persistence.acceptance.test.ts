/**
 * 文件目的：为“终端统一入口与 tmux 保活”提案定义后端保活契约。
 * 业务场景：用户刷新浏览器或网络断连后，终端里的 Codex、Pi 或普通 shell 仍由 tmux 持续运行。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const SHELL_WEBSOCKET_PATH = path.join(REPO_ROOT, 'backend', 'server', 'shell-websocket.ts');
const MAIN_CONTENT_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'main-content', 'view', 'MainContent.tsx');
const SHELL_RUNTIME_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'shell', 'hooks', 'useShellRuntime.ts');
const TMUX_RUNTIME_CANDIDATES = [
  path.join(REPO_ROOT, 'backend', 'server', 'terminal-tmux-runtime.ts'),
  path.join(REPO_ROOT, 'backend', 'server', 'persistent-terminal-session.ts'),
  path.join(REPO_ROOT, 'backend', 'server', 'tmux-terminal-runtime.ts'),
];

/**
 * 读取必须存在的生产源码，避免契约测试误判空路径。
 */
function readRequiredSource(filePath: string, businessName: string): string {
  assert.equal(fs.existsSync(filePath), true, `缺少${businessName}: ${path.relative(REPO_ROOT, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * 读取可能被执行阶段拆分出来的 tmux runtime 文件。
 */
function readOptionalRuntimeSources(): string {
  const existingSources = TMUX_RUNTIME_CANDIDATES
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => fs.readFileSync(filePath, 'utf8'));

  return existingSources.join('\n');
}

test('所有终端都必须通过 tmux 持久 session 承载', () => {
  const shellSource = readRequiredSource(SHELL_WEBSOCKET_PATH, 'shell WebSocket relay');
  const runtimeSource = readOptionalRuntimeSources();
  const combinedSource = `${shellSource}\n${runtimeSource}`;

  assert.match(combinedSource, /\btmux\b/, '后端必须显式使用 tmux 或同名 runtime 承载终端');
  assert.match(combinedSource, /has-session|list-sessions/, '后端必须能检测已有 tmux session，重连时不能盲目新建');
  assert.match(combinedSource, /new-session|new\s+-d|-d\s+-s/, '后端必须能创建后台 tmux session');
  assert.match(combinedSource, /attach-session|attach\s+-t|capture-pane/, '后端必须能重新 attach 或读取现有 tmux session');
  assert.match(combinedSource, /send-keys|load-buffer|paste-buffer/, '系统注入启动命令必须通过 tmux 输入通道完成');
  assert.doesNotMatch(
    shellSource,
    /keepSessionAliveOnDisconnect\s*=\s*!isPlainShell/,
    '普通 shell 与 provider TUI 不得再使用不同保活策略',
  );
});

test('浏览器 WebSocket 断开不得杀掉终端进程', () => {
  const shellSource = readRequiredSource(SHELL_WEBSOCKET_PATH, 'shell WebSocket relay');
  const mainContentSource = readRequiredSource(MAIN_CONTENT_PATH, '主工作区终端视图');
  const shellRuntimeSource = readRequiredSource(SHELL_RUNTIME_PATH, '前端 shell runtime');

  assert.doesNotMatch(
    shellSource,
    /ws\.on\(['"]close['"][\s\S]{0,1800}(?:pty\.kill|shellProcess\.kill)/,
    'WebSocket close 只能 detach，不能直接 kill 终端进程',
  );
  assert.doesNotMatch(
    shellSource,
    /Closing plain shell PTY immediately|!keepSessionAliveOnDisconnect/,
    'plain shell 断开后立即关闭的分支必须移除',
  );
  assert.match(
    shellSource,
    /kill_terminal|terminateTerminal|deleteTerminal|tmux[\s\S]{0,120}kill-session/,
    '只有用户显式结束或删除终端时，后端才应 kill 对应 tmux session',
  );
  assert.match(
    shellSource,
    /execFile\(['"]tmux['"]/,
    'tmux 生命周期命令必须通过真实子进程执行',
  );
  assert.match(
    shellSource,
    /killSessionArgs[\s\S]{0,240}executeTmuxLifecycleCommand\(killSessionArgs,\s*['"]kill-session['"]\)/,
    '显式终止路径必须实际执行 tmux kill-session，而不是只打印命令',
  );
  assert.match(
    shellSource,
    /detach-client/,
    'WebSocket close 必须实际 detach 当前 tmux client',
  );
  assert.match(
    shellRuntimeSource,
    /type:\s*['"]kill_terminal['"]/,
    '前端 shell runtime 必须能发送显式终止消息',
  );
  assert.match(
    mainContentSource,
    /terminalTerminateHandlersRef\.current\.get\(activeTerminalId\)\?\.\(\)/,
    '主工作区删除终端按钮必须调用当前终端的显式终止函数',
  );
  assert.match(
    mainContentSource,
    /onTerminalTerminateReady/,
    '主工作区终端视图必须注册 shell 显式终止函数',
  );
});
