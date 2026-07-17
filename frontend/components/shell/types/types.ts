/**
 * PURPOSE: Declare the shared shell runtime types used by the browser terminal,
 * websocket transport, and reconnect/heartbeat logic.
 */
import type { MutableRefObject, RefObject } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import type { Project, ProjectSession } from '../../../types/app';

export type AuthCopyStatus = 'idle' | 'copied' | 'failed';

export type ShellInitMessage = {
  type: 'init';
  projectName: string;
  projectPath: string;
  sessionId: string | null;
  routeSessionId?: string | null;
  providerSessionId?: string | null;
  hasSession: boolean;
  provider: string;
  cols: number;
  rows: number;
  initialCommand: string | null | undefined;
  isPlainShell: boolean;
  externalSessionState?: 'running' | 'idle' | 'unknown';
  forceHandoff?: boolean;
  handoffToken?: string;
};

export type ShellResizeMessage = {
  type: 'resize';
  cols: number;
  rows: number;
};

export type ShellInputMessage = {
  type: 'input';
  data: string;
};

export type ShellPingMessage = {
  type: 'ping';
  timestamp: number;
};

export type ShellTerminateMessage = {
  type: 'kill_terminal' | 'terminateTerminal' | 'deleteTerminal';
};

export type ShellOutgoingMessage =
  | ShellInitMessage
  | ShellResizeMessage
  | ShellInputMessage
  | ShellPingMessage
  | ShellTerminateMessage;

export type ShellIncomingMessage =
  | { type: 'output'; data: string }
  | { type: 'auth_url'; url?: string }
  | { type: 'url_open'; url?: string }
  | { type: 'pong'; timestamp?: number }
  | { type: string; [key: string]: unknown };

export type UseShellRuntimeOptions = {
  selectedProject: Project | null | undefined;
  selectedSession: ProjectSession | null | undefined;
  provider?: 'codex' | 'pi';
  initialCommand: string | null | undefined;
  isPlainShell: boolean;
  isDarkMode: boolean;
  minimal: boolean;
  autoConnect: boolean;
  isRestarting: boolean;
  onProcessComplete?: ((exitCode: number) => void) | null;
};

export type ShellSharedRefs = {
  wsRef: MutableRefObject<WebSocket | null>;
  terminalRef: MutableRefObject<Terminal | null>;
  fitAddonRef: MutableRefObject<FitAddon | null>;
  authUrlRef: MutableRefObject<string>;
  selectedProjectRef: MutableRefObject<Project | null | undefined>;
  selectedSessionRef: MutableRefObject<ProjectSession | null | undefined>;
  providerRef: MutableRefObject<'codex' | 'pi' | undefined>;
  initialCommandRef: MutableRefObject<string | null | undefined>;
  isPlainShellRef: MutableRefObject<boolean>;
  onProcessCompleteRef: MutableRefObject<((exitCode: number) => void) | null | undefined>;
};

export type UseShellRuntimeResult = {
  terminalContainerRef: RefObject<HTMLDivElement>;
  isConnected: boolean;
  isInitialized: boolean;
  isConnecting: boolean;
  isVirtualCtrlActive: boolean;
  authUrl: string;
  authUrlVersion: number;
  handoffBlockedReason: string;
  canForceHandoff: boolean;
  isForceHandoffPending: boolean;
  setVirtualCtrlActive: (isActive: boolean) => void;
  sendTerminalInput: (data: string) => boolean;
  terminateShell: () => boolean;
  connectToShell: () => void;
  disconnectFromShell: () => void;
  forceCodexHandoff: () => boolean;
  openAuthUrlInBrowser: (url?: string) => boolean;
  copyAuthUrlToClipboard: (url?: string) => Promise<boolean>;
};
