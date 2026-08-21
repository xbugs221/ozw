/**
 * 文件目的：使用 xterm 承载 Hermes TUI 与工作区原始 shell，并通过 SDK 建立认证 WebSocket。
 * 业务边界：终端只连接用户当前会话绑定的工作区，不自行拼接认证参数。
 */
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

type SDK = Record<string, any>;
type TerminalMode = 'chat' | 'shell';
type TerminalPanelProps = {
  mode: TerminalMode;
  profile: string;
  instanceId: string;
  resumeSessionId?: string;
  workspaceId: string;
  workspacePath: string;
  active?: boolean;
};

/** Keep one reconnectable PTY identity per Workbench terminal instance. */
function terminalAttachToken(mode: TerminalMode, profile: string, instanceId: string): string {
  const key = `hermes.workbench.${mode}.${profile}.${instanceId}.attach`;
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    window.sessionStorage.setItem(key, token);
    return token;
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

/** 创建使用宿主 React 实例的元素，避免插件打包第二份 React。 */
function element(React: any, type: any, props?: Record<string, any> | null, ...children: any[]): any {
  return React.createElement(type, props, ...children);
}

/** 从 shell 的 JSON 信封或 PTY 二进制帧中提取终端字节。 */
function terminalPayload(value: unknown): string | Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  const raw = String(value ?? '');
  if (!raw.startsWith('{')) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.type === 'pong') return null;
    return typeof parsed.data === 'string'
      ? parsed.data
      : typeof parsed.output === 'string'
        ? parsed.output
        : raw;
  } catch {
    return raw;
  }
}

/** 把连接状态转换为工作台统一的双语标签。 */
function terminalStatusLabel(status: string, mode: TerminalMode): string {
  if (status === 'open') return mode === 'chat' ? 'Hermes TUI' : 'Shell';
  if (status === 'connecting') return '连接中 / Connecting';
  if (status === 'closed') return '已断开 / Disconnected';
  if (status === 'error') return '连接失败 / Connection failed';
  return '等待连接 / Idle';
}

/** 根据主题实际背景选择高对比 ANSI 色板，避免亮色主题中的黄色文字失去可读性。 */
function terminalTheme(element: HTMLElement): Record<string, string> {
  const computed = window.getComputedStyle(element);
  const background = computed.backgroundColor || '#000000';
  const foreground = computed.color || '#d8f4f2';
  const channels = background.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
  const luminance = (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255;
  if (luminance > 0.55) {
    return {
      background,
      foreground,
      cursor: '#f28c28',
      selectionBackground: 'rgba(242, 140, 40, 0.25)',
      black: '#123e40', red: '#b42318', green: '#087a68', yellow: '#8a4d00',
      blue: '#075b5f', magenta: '#7a3e75', cyan: '#007b80', white: '#f5f7f7',
      brightBlack: '#527174', brightRed: '#d92d20', brightGreen: '#12866f', brightYellow: '#a85d00',
      brightBlue: '#006a70', brightMagenta: '#934a8c', brightCyan: '#008f95', brightWhite: '#ffffff',
    };
  }
  return {
    background,
    foreground,
    cursor: '#ff9d3d',
    selectionBackground: 'rgba(255, 157, 61, 0.3)',
    black: '#000000', red: '#ff6b68', green: '#49d6a5', yellow: '#ffb25f',
    blue: '#72b7ff', magenta: '#d19cff', cyan: '#3fd0d0', white: '#d8f4f2',
    brightBlack: '#77908f', brightRed: '#ff8c89', brightGreen: '#6aebba', brightYellow: '#ffc77f',
    brightBlue: '#9acbff', brightMagenta: '#dfb9ff', brightCyan: '#75e2e2', brightWhite: '#ffffff',
  };
}

/** 创建可复用于聊天和右栏 shell 的原生 xterm 组件。 */
export function createTerminalPanel(sdk: SDK): (props: TerminalPanelProps) => any {
  const React = sdk.React;
  const { useEffect, useRef, useState } = sdk.hooks;

  return function TerminalPanel({
    mode,
    profile,
    instanceId,
    resumeSessionId = '',
    workspaceId,
    workspacePath,
    active = true,
  }: TerminalPanelProps): any {
    /** 用户路径：打开面板后连接目标终端，关闭或切换会话时完整释放 PTY。 */
    const hostRef = useRef(null as HTMLDivElement | null);
    const terminalRef = useRef(null as Terminal | null);
    const fitRef = useRef(null as FitAddon | null);
    const socketRef = useRef(null as WebSocket | null);
    const [retry, setRetry] = useState(0);
    const [status, setStatus] = useState('idle' as 'idle' | 'connecting' | 'open' | 'closed' | 'error');

    useEffect(() => {
      if (!active || !hostRef.current || !instanceId || !workspaceId) return undefined;
      let disposed = false;
      let resizeObserver: ResizeObserver | null = null;
      let inputDisposable: { dispose: () => void } | null = null;
      const terminal = new Terminal({
        allowProposedApi: false,
        convertEol: false,
        cursorBlink: true,
        fontFamily: 'var(--theme-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
        fontSize: 13,
        minimumContrastRatio: 4.5,
        scrollback: 5000,
        theme: terminalTheme(hostRef.current),
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(hostRef.current);
      terminalRef.current = terminal;
      fitRef.current = fit;
      setStatus('connecting');

      /** 重新计算终端尺寸，并把新行列数同步给目标 PTY。 */
      const fitTerminal = () => {
        if (disposed) return;
        try { fit.fit(); } catch { return; }
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(`\u001b[RESIZE:${terminal.cols};${terminal.rows}]`);
      };

      resizeObserver = new ResizeObserver(() => fitTerminal());
      resizeObserver.observe(hostRef.current);
      window.requestAnimationFrame(fitTerminal);

      /** 获取一次性认证地址后连接 WebSocket，并绑定当前会话与工作区。 */
      const connect = async () => {
        const path = mode === 'chat' ? '/api/pty' : '/api/plugins/workbench/shell';
        const params: Record<string, string> = {
          channel: `workbench-${mode}-${instanceId}`,
          profile,
          workspace: workspaceId,
          cwd: workspacePath,
        };
        if (mode === 'chat') {
          params.attach = terminalAttachToken(mode, profile, instanceId);
          if (resumeSessionId) params.resume = resumeSessionId;
        }
        try {
          const url = await sdk.buildWsUrl(path, params);
          if (disposed) return;
          const socket = new WebSocket(url);
          socket.binaryType = 'arraybuffer';
          socketRef.current = socket;
          socket.onopen = () => {
            if (disposed) return;
            setStatus('open');
            fitTerminal();
          };
          socket.onmessage = event => {
            const payload = terminalPayload(event.data);
            if (payload !== null) terminal.write(payload);
          };
          socket.onerror = () => !disposed && setStatus('error');
          socket.onclose = () => !disposed && setStatus('closed');
          inputDisposable = terminal.onData(data => {
            if (socket.readyState === WebSocket.OPEN) socket.send(data);
          });
        } catch (error) {
          if (!disposed) {
            terminal.writeln(`\r\n\u001b[31m${String(error)}\u001b[0m`);
            setStatus('error');
          }
        }
      };
      void connect();

      return () => {
        disposed = true;
        resizeObserver?.disconnect();
        inputDisposable?.dispose();
        socketRef.current?.close();
        socketRef.current = null;
        terminal.dispose();
        terminalRef.current = null;
        fitRef.current = null;
      };
    }, [active, instanceId, mode, profile, resumeSessionId, retry, workspaceId, workspacePath]);

    return element(React, 'div', { className: `hti-terminal-frame is-${mode}` },
      element(React, 'div', { className: 'hti-terminal-status' },
        element(React, 'span', { className: `hti-status-dot is-${status}`, 'aria-hidden': true }),
        element(React, 'span', null, terminalStatusLabel(status, mode)),
        status === 'closed' || status === 'error'
          ? element(React, 'button', { type: 'button', onClick: () => setRetry((value: number) => value + 1) }, '重连 / Reconnect')
          : null),
      element(React, 'div', { ref: hostRef, className: 'hti-terminal-host' }));
  };
}
