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

test('聊天页默认 TUI-first，并保留渲染快照入口', () => {
  const source = readRequiredSource(CHAT_INTERFACE_PATH, '聊天页 TUI-first 接入点');

  assert.match(source, /ChatTuiPanel|chat-tui-panel/, 'ChatInterface 必须接入 TUI 面板');
  assert.match(source, /chat-render-snapshot-button|renderSnapshot/i, '聊天页必须提供用户主动渲染 JSONL 快照入口');
  assert.match(source, /chat-return-tui-button|returnToTui/i, '渲染视图必须能返回 TUI');
  assert.doesNotMatch(
    source,
    /selectedSession[\s\S]{0,240}loadSessionMessages\(/,
    '默认进入会话不应立即把 JSONL 富渲染作为唯一消息视图',
  );
});

test('shell relay 支持 Pi TUI，且不能把 Pi 归一成 Codex', () => {
  const source = readRequiredSource(SHELL_WEBSOCKET_PATH, '后端 shell WebSocket TUI relay');

  assert.match(source, /provider[\s\S]{0,120}'pi'|provider[\s\S]{0,120}"pi"/, 'shell init 必须识别 provider=pi');
  assert.match(source, /pi\s+resume|buildPi|Pi/, 'shell command builder 必须有 Pi TUI 启动或恢复路径');
  assert.doesNotMatch(
    source,
    /function\s+normalizeShellSessionProvider[\s\S]{0,160}return\s+'codex'/,
    'normalizeShellSessionProvider 不得把所有 provider 都归一成 codex',
  );
});

test('Pi route-backed TUI 使用 providerSessionId 恢复而不是 cN 路由 id', () => {
  const shellSource = readRequiredSource(SHELL_WEBSOCKET_PATH, '后端 shell WebSocket TUI relay');

  assert.match(shellSource, /providerSessionId/, 'shell init 必须接收 providerSessionId');
  assert.match(shellSource, /routeSessionId/, 'shell init 必须保留 routeSessionId 用于 PTY 隔离');
  assert.match(shellSource, /resumeSessionId[\s\S]{0,160}providerSessionId/, 'Provider CLI resume 必须使用 providerSessionId');
  assert.doesNotMatch(
    shellSource,
    /\bresume\s+"\$\{sessionId\}"/,
    'Pi cN route 不得直接作为 provider CLI resume 参数',
  );
});

test('非 plain-shell 的 TUI WebSocket 断开后继续保留 PTY 会话', () => {
  const source = readRequiredSource(SHELL_WEBSOCKET_PATH, '后端 shell WebSocket PTY 保活');

  assert.match(source, /keepSessionAliveOnDisconnect\s*=\s*!isPlainShell/, 'Provider TUI 断开 WebSocket 后必须继续保留 PTY');
  assert.match(source, /ptySessionKey[\s\S]{0,180}provider/, 'PTY session key 必须包含 provider，避免 Codex/Pi 混用');
  assert.match(source, /buffer\.push|ring buffer|buffer:/, '后端必须保留可回放输出 buffer');
});
