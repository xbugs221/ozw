/**
 * 文件目的：封装终端 tmux session 的创建、复连、输入和显式终止命令。
 * 业务意义：浏览器连接只负责 attach/detach，真实终端进程由 tmux 常驻承载。
 */
export type TmuxTerminalRuntime = {
  sessionName: string;
  legacySessionNames: string[];
  hasSession: () => string[];
  createSession: (shellCommand: string) => string[];
  attachSession: () => string[];
  capturePane: () => string[];
  sendKeys: (input: string) => string[];
  terminateTerminal: () => string[];
};

/**
 * 生成旧版 base64 tmux session 名，用于兼容已经存在的后台终端。
 */
export function createLegacyTmuxSessionName(rawKey: string): string {
  return `ozw_${Buffer.from(rawKey).toString('base64url').slice(0, 48)}`;
}

/**
 * 生成短可读的 tmux session 名，优先呈现项目后缀和 cN 路由。
 */
export function createTmuxSessionName(rawKey: string): string {
  const parsed = parseTmuxRawKey(rawKey);
  if (!parsed) {
    return createLegacyTmuxSessionName(rawKey);
  }

  const routeOrSession = parsed.routeSessionId || parsed.providerSessionId || 'new';
  return sanitizeTmuxSessionName(`ozw_${getProjectPathSuffix(parsed.projectPath)}_${routeOrSession}`);
}

/**
 * 返回 shell relay 使用的 tmux 命令参数，集中表达 has-session/new-session/attach/send-keys/kill-session 契约。
 */
export function createTmuxTerminalRuntime(rawKey: string): TmuxTerminalRuntime {
  const sessionName = createTmuxSessionName(rawKey);
  const legacySessionName = createLegacyTmuxSessionName(rawKey);
  const legacySessionNames = legacySessionName === sessionName ? [] : [legacySessionName];

  return {
    sessionName,
    legacySessionNames,
    hasSession: () => ['tmux', 'has-session', '-t', sessionName],
    createSession: (shellCommand: string) => ['tmux', 'new-session', '-d', '-s', sessionName, shellCommand],
    attachSession: () => ['tmux', 'attach-session', '-t', sessionName],
    capturePane: () => ['tmux', 'capture-pane', '-p', '-t', sessionName],
    sendKeys: (input: string) => ['tmux', 'send-keys', '-t', sessionName, input],
    terminateTerminal: () => ['tmux', 'kill-session', '-t', sessionName],
  };
}

/**
 * 从 shell relay raw key 中提取项目路径和会话身份。
 */
function parseTmuxRawKey(rawKey: string): {
  projectPath: string;
  routeSessionId: string;
  providerSessionId: string;
} | null {
  const match = String(rawKey || '').match(/^(.*)_(codex|pi|claude|plain-shell)_(.*?)(?:_cmd_[A-Za-z0-9+/=_-]+)?$/);
  if (!match) {
    return null;
  }

  const identity = match[3] || '';
  const routeMatch = identity.match(/^route:(c\d+)$/) || identity.match(/^(c\d+)(?:_|$)/);
  const providerMatch = identity.match(/^provider:(.+)$/);
  return {
    projectPath: match[1] || 'project',
    routeSessionId: routeMatch?.[1] || '',
    providerSessionId: providerMatch?.[1] || '',
  };
}

/**
 * 取项目路径最后两段，得到类似 projects/ozw 的短路径。
 */
function getProjectPathSuffix(projectPath: string): string {
  const segments = String(projectPath || 'project')
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .split('/')
    .filter(Boolean);
  return segments.slice(-2).join('_') || 'project';
}

/**
 * 将路径风格名称转成 tmux 安全名称。
 */
function sanitizeTmuxSessionName(value: string): string {
  return value
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'ozw_terminal';
}
