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
  sessionId: string;
  workspaceId: string;
  workspacePath: string;
  active?: boolean;
};

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

/** 创建可复用于聊天和右栏 shell 的原生 xterm 组件。 */
export function createTerminalPanel(sdk: SDK): (props: TerminalPanelProps) => any {
  const React = sdk.React;
  const { useEffect, useRef, useState } = sdk.hooks;

  return function TerminalPanel({
    mode,
    profile,
    sessionId,
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
      if (!active || !hostRef.current || !sessionId || !workspaceId) return undefined;
      let disposed = false;
      let resizeObserver: ResizeObserver | null = null;
      let inputDisposable: { dispose: () => void } | null = null;
      const terminal = new Terminal({
        allowProposedApi: false,
        convertEol: false,
        cursorBlink: true,
        fontFamily: 'var(--theme-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
        fontSize: 13,
        scrollback: 5000,
        theme: {
          background: '#0b1015',
          foreground: '#d5dbe3',
          cursor: '#72b7a4',
          selectionBackground: '#365e55',
        },
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
        if (mode === 'chat') socket.send(`\u001b[RESIZE:${terminal.cols};${terminal.rows}]`);
        else socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      };

      resizeObserver = new ResizeObserver(() => fitTerminal());
      resizeObserver.observe(hostRef.current);
      window.requestAnimationFrame(fitTerminal);

      /** 获取一次性认证地址后连接 WebSocket，并绑定当前会话与工作区。 */
      const connect = async () => {
        const path = mode === 'chat' ? '/api/pty' : '/api/shell';
        const params: Record<string, string> = {
          channel: `workbench-${mode}-${sessionId}`,
          profile,
          session: sessionId,
          workspace: workspaceId,
          cwd: workspacePath,
        };
        if (mode === 'chat') params.resume = sessionId;
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
    }, [active, mode, profile, retry, sessionId, workspaceId, workspacePath]);

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
