/**
 * 文件目的：封装终端 tmux session 的创建、复连、输入和显式终止命令。
 * 业务意义：浏览器连接只负责 attach/detach，真实终端进程由 tmux 常驻承载。
 */
export type TmuxTerminalRuntime = {
  sessionName: string;
  hasSession: () => string[];
  createSession: (shellCommand: string) => string[];
  attachSession: () => string[];
  capturePane: () => string[];
  sendKeys: (input: string) => string[];
  terminateTerminal: () => string[];
};

/**
 * 生成 tmux 安全 session 名，避免路径和 provider 字符破坏 CLI 参数。
 */
export function createTmuxSessionName(rawKey: string): string {
  return `ozw_${Buffer.from(rawKey).toString('base64url').slice(0, 48)}`;
}

/**
 * 返回 shell relay 使用的 tmux 命令参数，集中表达 has-session/new-session/attach/send-keys/kill-session 契约。
 */
export function createTmuxTerminalRuntime(rawKey: string): TmuxTerminalRuntime {
  const sessionName = createTmuxSessionName(rawKey);

  return {
    sessionName,
    hasSession: () => ['tmux', 'has-session', '-t', sessionName],
    createSession: (shellCommand: string) => ['tmux', 'new-session', '-d', '-s', sessionName, shellCommand],
    attachSession: () => ['tmux', 'attach-session', '-t', sessionName],
    capturePane: () => ['tmux', 'capture-pane', '-p', '-t', sessionName],
    sendKeys: (input: string) => ['tmux', 'send-keys', '-t', sessionName, input],
    terminateTerminal: () => ['tmux', 'kill-session', '-t', sessionName],
  };
}
