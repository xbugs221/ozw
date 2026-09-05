/**
 * 文件目的：封装“项目 session + 会话 window”形式的 tmux 终端命令。
 * 业务意义：同一项目复用一个 tmux session，每个浏览器会话独立在 window 中。
 */
import { createHash } from 'node:crypto';

export type TmuxTerminalRuntime = {
  sessionName: string;
  windowName: string;
  target: string;
  legacySessionNames: string[];
  hasSession: () => string[];
  createSession: (shellCommand: string) => string[];
  createWindow: (shellCommand: string) => string[];
  attachSession: () => string[];
  capturePane: () => string[];
  sendKeys: (input: string) => string[];
  terminateTerminal: (activeTarget?: string) => string[];
};

/**
 * 生成旧版 base64 tmux session 名，用于兼容已经存在的后台终端。
 */
export function createLegacyTmuxSessionName(rawKey: string): string {
  return `ozw_${Buffer.from(rawKey).toString('base64url').slice(0, 48)}`;
}

/**
 * 生成项目级 tmux session 名，后缀哈希避免同名目录冲突。
 */
export function createTmuxSessionName(rawKey: string): string {
  const parsed = parseTmuxRawKey(rawKey);
  if (!parsed) {
    return createLegacyTmuxSessionName(rawKey);
  }

  const projectHash = shortHash(parsed.projectPath);
  const readableProject = sanitizeTmuxName(getProjectPathSuffix(parsed.projectPath), 67);
  return `ozw_${readableProject}_${projectHash}`;
}

/**
 * 生成会话级 window 名，让同项目的不同 Provider/路由可并行运行。
 */
export function createTmuxWindowName(rawKey: string): string {
  const parsed = parseTmuxRawKey(rawKey);
  if (!parsed) {
    return sanitizeTmuxName(`terminal_${shortHash(rawKey)}`, 48);
  }

  const identity = parsed.routeSessionId || parsed.providerSessionId || parsed.identity || 'new';
  const commandSuffix = parsed.commandId ? `_${parsed.commandId}` : '';
  const candidate = `${parsed.provider}_${identity}${commandSuffix}`;
  const normalized = sanitizeTmuxName(candidate, 256);
  if (normalized === candidate && normalized.length <= 48) {
    return normalized;
  }
  return `${normalized.slice(0, 39)}_${shortHash(candidate)}`;
}

/**
 * 返回 shell relay 使用的 tmux 命令参数，集中表达 has-session/new-session/attach/send-keys/kill-session 契约。
 */
export function createTmuxTerminalRuntime(rawKey: string): TmuxTerminalRuntime {
  const sessionName = createTmuxSessionName(rawKey);
  const windowName = createTmuxWindowName(rawKey);
  const target = `${sessionName}:${windowName}`;
  const legacySessionName = createLegacyTmuxSessionName(rawKey);
  const previousSessionName = createPreviousTmuxSessionName(rawKey);
  const legacySessionNames = Array.from(new Set([previousSessionName, legacySessionName]))
    .filter((name) => name !== sessionName);

  return {
    sessionName,
    windowName,
    target,
    legacySessionNames,
    hasSession: () => ['tmux', 'has-session', '-t', target],
    createSession: (shellCommand: string) => ['tmux', 'new-session', '-d', '-s', sessionName, '-n', windowName, shellCommand],
    createWindow: (shellCommand: string) => ['tmux', 'new-window', '-d', '-t', sessionName, '-n', windowName, shellCommand],
    attachSession: () => ['tmux', 'attach-session', '-t', target],
    capturePane: () => ['tmux', 'capture-pane', '-p', '-t', target],
    sendKeys: (input: string) => ['tmux', 'send-keys', '-t', target, input],
    terminateTerminal: (activeTarget = target) => activeTarget === target
      ? ['tmux', 'kill-window', '-t', target]
      : ['tmux', 'kill-session', '-t', activeTarget],
  };
}

/**
 * 生成上一版的“每会话一个 session”名称，仅用于无感复连和回收旧会话。
 */
function createPreviousTmuxSessionName(rawKey: string): string {
  const parsed = parseTmuxRawKey(rawKey);
  if (!parsed) {
    return createLegacyTmuxSessionName(rawKey);
  }
  const routeOrSession = parsed.routeSessionId || parsed.providerSessionId || 'new';
  return sanitizeTmuxName(`ozw_${getProjectPathSuffix(parsed.projectPath)}_${routeOrSession}`, 80);
}

/**
 * 从 shell relay raw key 中提取项目路径和会话身份。
 */
function parseTmuxRawKey(rawKey: string): {
  projectPath: string;
  provider: string;
  identity: string;
  routeSessionId: string;
  providerSessionId: string;
  commandId: string;
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
    provider: match[2] || 'terminal',
    identity,
    routeSessionId: routeMatch?.[1] || '',
    providerSessionId: providerMatch?.[1] || '',
    commandId: String(rawKey || '').match(/_cmd_([A-Za-z0-9+/=_-]+)$/)?.[1] || '',
  };
}

/** 将长路径压缩成稳定、短小的冲突规避后缀。 */
function shortHash(value: string): string {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
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
 *
 * tmux 明确禁止 session 名包含 `.` 和 `:`；这里采用保守白名单，
 * 同时兜底路径中的空白、Unicode 和 shell 特殊字符。
 */
function sanitizeTmuxName(value: string, maxLength: number): string {
  return value
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength) || 'ozw_terminal';
}
