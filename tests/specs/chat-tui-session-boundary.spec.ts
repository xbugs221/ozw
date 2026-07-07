/**
 * Sources: 2026-07-06-36-双Provider聊天TUI优先与终端保活渲染快照
 *
 * PURPOSE: Verify Codex/Pi chat TUI sessions keep provider-aware identity and
 * backend terminal relay boundaries stable.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

type BuildChatTuiSessionKey = (input: {
  projectPath: string;
  provider: 'codex' | 'pi';
  routeSessionId?: string | null;
  providerSessionId?: string | null;
}) => string;

const REPO_ROOT = process.cwd();
const TUI_SESSION_KEY_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'chat',
  'tui',
  'chatTuiSessionKey.ts',
);
const CHAT_INTERFACE_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'chat', 'view', 'ChatInterface.tsx');
const SHELL_WEBSOCKET_PATH = path.join(REPO_ROOT, 'backend', 'server', 'shell-websocket.ts');

/**
 * Read a required production source file for boundary assertions.
 */
function readRequiredSource(filePath: string, businessName: string): string {
  assert.equal(fs.existsSync(filePath), true, `缺少 ${businessName}: ${path.relative(REPO_ROOT, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Load the production TUI session-key module.
 */
async function loadTuiSessionKeyModule(): Promise<{ buildChatTuiSessionKey: BuildChatTuiSessionKey }> {
  assert.equal(
    fs.existsSync(TUI_SESSION_KEY_PATH),
    true,
    '缺少 frontend/components/chat/tui/chatTuiSessionKey.ts，尚未实现 TUI 会话保活键',
  );
  const moduleExports = await import(pathToFileURL(TUI_SESSION_KEY_PATH).href);
  assert.equal(
    typeof moduleExports.buildChatTuiSessionKey,
    'function',
    'chatTuiSessionKey.ts 必须导出 buildChatTuiSessionKey(input)',
  );
  return moduleExports as { buildChatTuiSessionKey: BuildChatTuiSessionKey };
}

test('TUI session key 同时区分 provider、项目路径和 route/provider 会话身份', async () => {
  const { buildChatTuiSessionKey } = await loadTuiSessionKeyModule();

  const codexKey = buildChatTuiSessionKey({
    projectPath: '/repo/ozw',
    provider: 'codex',
    routeSessionId: 'c1',
    providerSessionId: 'codex-provider-1',
  });
  const piKey = buildChatTuiSessionKey({
    projectPath: '/repo/ozw',
    provider: 'pi',
    routeSessionId: 'c1',
    providerSessionId: 'pi-provider-1',
  });

  assert.notEqual(codexKey, piKey, 'Codex 和 Pi 的 TUI 会话键必须不同，不能混用同一个 PTY');
  assert.match(codexKey, /codex/, 'Codex key 必须包含 provider 信息');
  assert.match(piKey, /pi/, 'Pi key 必须包含 provider 信息');
  assert.match(codexKey, /c1|codex-provider-1/, 'key 必须包含 route 或 provider session 身份');
  assert.match(piKey, /c1|pi-provider-1/, 'key 必须包含 route 或 provider session 身份');
});

test('聊天页默认 TUI-first，并由消息 Tab 触发渲染快照', () => {
  const source = readRequiredSource(CHAT_INTERFACE_PATH, '聊天页 TUI-first 接入点');

  assert.match(source, /ChatTuiPanel|chat-tui-panel/, 'ChatInterface 必须接入 TUI 面板');
  assert.match(source, /renderSnapshotRequestId|handleRenderSnapshot/i, '聊天页必须响应消息 Tab 触发的 JSONL 快照渲染请求');
  assert.doesNotMatch(source, /chat-render-snapshot-button/, 'TUI 工具栏不应再提供单独的渲染按钮');
  assert.match(source, /chat-tui-upload-attachment-button/, '聊天页必须提供上传图片或文件并插入 TUI 路径的入口');
  assert.match(source, /onTerminalInputReady/, '上传后的文件路径必须通过终端输入通道插入 TUI');
  assert.doesNotMatch(source, /chat-return-tui-button|chat-rerender-snapshot-button/, '渲染视图不应再显示返回 TUI 或重新渲染按钮');
  assert.doesNotMatch(source, /<ChatComposer\b/, 'TUI-first 会话页不应再渲染旧聊天输入框');
  assert.doesNotMatch(
    source,
    /selectedSession[\s\S]{0,240}loadSessionMessages\(/,
    '默认进入会话不应立即把 JSONL 富渲染作为唯一消息视图',
  );
});

test('shell relay 支持 Pi TUI，且不能把 Pi 归一成 Codex', () => {
  const source = readRequiredSource(SHELL_WEBSOCKET_PATH, '后端 shell WebSocket TUI relay');

  assert.match(source, /provider[\s\S]{0,120}'pi'|provider[\s\S]{0,120}"pi"/, 'shell init 必须识别 provider=pi');
  assert.match(source, /provider === 'pi'[\s\S]{0,140}--session\s+\$\{quotePosixShell/, 'shell command builder 必须用 pi --session 恢复 Pi TUI');
  assert.doesNotMatch(source, /pi\s+resume\s+["']?\$\{resumeSessionId\}/, 'Pi TUI 不得使用 Codex 风格的 pi resume 子命令');
  assert.doesNotMatch(
    source,
    /function\s+normalizeShellSessionProvider[\s\S]{0,160}return\s+'codex'/,
    'normalizeShellSessionProvider 不得把所有 provider 都归一成 codex',
  );
});

test('Pi route-backed TUI 使用 providerSessionId 恢复而不是 cN 路由 id', () => {
  const shellSource = readRequiredSource(SHELL_WEBSOCKET_PATH, '后端 shell WebSocket TUI relay');

  assert.match(shellSource, /providerSessionId/, 'shell init 必须接收 providerSessionId');
  assert.match(shellSource, /routeSessionId/, 'shell init 必须保留 routeSessionId 用于 tmux 会话身份');
  assert.match(shellSource, /resumeSessionId[\s\S]{0,160}providerSessionId/, 'Provider CLI resume 必须使用 providerSessionId');
  assert.match(
    shellSource,
    /ptyIdentity\s*=\s*routeSessionId[\s\S]{0,120}`route:\$\{routeSessionId\}`/,
    'route-backed TUI 的 tmux 身份必须优先使用稳定 cN 路由',
  );
  assert.match(
    shellSource,
    /legacyPtyIdentities[\s\S]{0,220}`\$\{routeSessionId\}_no-provider-session`/,
    'providerSessionId 回填后必须能接回旧的 cN/no-provider tmux 会话',
  );
  assert.doesNotMatch(
    shellSource,
    /\bresume\s+"\$\{sessionId\}"/,
    'Pi cN route 不得直接作为 provider CLI resume 参数',
  );
});

test('非 plain-shell 的 TUI WebSocket 断开后继续保留 PTY 会话', () => {
  const source = readRequiredSource(SHELL_WEBSOCKET_PATH, '后端 shell WebSocket PTY 保活');

  assert.doesNotMatch(
    source,
    /ws\.on\(['"]close['"][\s\S]{0,1800}(?:pty\.kill|shellProcess\.kill)/,
    'Provider TUI 断开 WebSocket 后不能直接 kill PTY',
  );
  assert.match(source, /detach-client/, 'Provider TUI 断开 WebSocket 后只应 detach tmux client');
  assert.match(source, /primaryPtySessionKey[\s\S]{0,180}provider/, 'PTY session key 必须包含 provider，避免 Codex/Pi 混用');
  assert.match(source, /buffer\.push|ring buffer|buffer:/, '后端必须保留可回放输出 buffer');
});

test('Provider TUI 退出后 tmux pane 回到普通 shell', () => {
  const source = readRequiredSource(SHELL_WEBSOCKET_PATH, '后端 shell WebSocket provider 启动命令');

  assert.match(
    source,
    /exec\s+"\\\$\{SHELL:-\/bin\/bash\}"\s+-lic/,
    'Provider 命令必须通过用户默认 shell 的登录交互环境启动',
  );
  assert.match(
    source,
    /exec\s+"\\\$\{SHELL:-\/bin\/bash\}"\s+-l/,
    'Provider 命令退出后必须 exec 登录 shell，避免 Web 终端停在 [exited]',
  );
  assert.doesNotMatch(
    source,
    /resumeCommand\s*\|\|\s*cliName|resume\s+[^;\n]+;\s*if\s*\(\$LASTEXITCODE\s*-ne\s*0\)\s*\{/,
    '用户 Ctrl-C 或退出 Provider 后不应自动重启 Provider',
  );
});

test('Provider TUI 启动命令优先使用用户默认 shell 环境', () => {
  const source = readRequiredSource(SHELL_WEBSOCKET_PATH, '后端 shell WebSocket provider PATH');

  assert.match(source, /\$\{SHELL:-\/bin\/bash\}"\s+-lic/, 'Provider 启动必须先进入用户默认 shell 的登录交互环境');
  assert.match(source, /buildPortableUserBinPathExport/, 'Provider 启动命令只能保留可迁移的用户级 PATH 兜底');
  assert.doesNotMatch(source, /\/home\/zzl|\/Users\/[^'"]+/, 'Provider PATH 兜底不能写入特定用户路径');
});
