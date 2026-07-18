/**
 * PURPOSE: Manage the shell websocket lifecycle, including reconnect,
 * heartbeat, init replay, and outbound message queuing for the PTY relay.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import type { Project, ProjectSession } from '../../../types/app';
import {
  SHELL_HEARTBEAT_INTERVAL_MS,
  SHELL_HEARTBEAT_TIMEOUT_MS,
  SHELL_MAX_QUEUED_MESSAGES,
  SHELL_RECONNECT_DELAY_MS,
  TERMINAL_INIT_DELAY_MS,
} from '../constants/constants';
import { getShellWebSocketUrl, parseShellMessage } from '../utils/socket';
import type { ShellIncomingMessage, ShellOutgoingMessage } from '../types/types';

const ANSI_ESCAPE_REGEX =
  /(?:\u001B\[[0-?]*[ -/]*[@-~]|\u009B[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u009D[^\u0007\u009C]*(?:\u0007|\u009C)|\u001B[PX^_][^\u001B]*\u001B\\|[\u0090\u0098\u009E\u009F][^\u009C]*\u009C|\u001B[@-Z\\-_])/g;
const PROCESS_EXIT_REGEX = /Process exited with code (\d+)/;

/**
 * Resolve shell session providers to supported agent backends only.
 */
function normalizeShellSessionProvider(provider: unknown): 'codex' | 'pi' | 'claude' {
  return provider === 'pi' ? 'pi' : provider === 'claude' ? 'claude' : 'codex';
}

/**
 * Resolve the shell working directory for the active session.
 * Worktree sessions must reattach from their own projectPath instead of the merged parent project path.
 */
function getShellProjectPath(currentProject: Project | null | undefined, currentSession: ProjectSession | null | undefined): string {
  if (typeof currentSession?.projectPath === 'string' && currentSession.projectPath) {
    return currentSession.projectPath;
  }

  return currentProject?.fullPath || currentProject?.path || '';
}

/**
 * Resolve route and provider session identities for shell resume.
 */
function getShellSessionIdentity(currentSession: ProjectSession | null | undefined): {
  routeSessionId: string | null;
  providerSessionId: string | null;
} {
  const routeSessionId = Number.isInteger(Number(currentSession?.routeIndex))
    ? `c${Number(currentSession?.routeIndex)}`
    : /^c\d+$/.test(String(currentSession?.id || ''))
      ? String(currentSession?.id)
      : null;
  const providerSessionId = typeof currentSession?.providerSessionId === 'string' && currentSession.providerSessionId.trim()
    ? currentSession.providerSessionId.trim()
    : routeSessionId
      ? null
      : typeof currentSession?.id === 'string' && currentSession.id.trim()
        ? currentSession.id.trim()
        : null;

  return { routeSessionId, providerSessionId };
}

type UseShellConnectionOptions = {
  wsRef: MutableRefObject<WebSocket | null>;
  terminalRef: MutableRefObject<Terminal | null>;
  fitAddonRef: MutableRefObject<FitAddon | null>;
  selectedProjectRef: MutableRefObject<Project | null | undefined>;
  selectedSessionRef: MutableRefObject<ProjectSession | null | undefined>;
  providerRef: MutableRefObject<'codex' | 'pi' | 'claude' | undefined>;
  initialCommandRef: MutableRefObject<string | null | undefined>;
  isPlainShellRef: MutableRefObject<boolean>;
  onProcessCompleteRef: MutableRefObject<((exitCode: number) => void) | null | undefined>;
  outboundSenderRef: MutableRefObject<(message: ShellOutgoingMessage) => boolean>;
  isInitialized: boolean;
  autoConnect: boolean;
  closeSocket: () => void;
  clearTerminalScreen: () => void;
  setAuthUrl: (nextAuthUrl: string) => void;
};

type UseShellConnectionResult = {
  isConnected: boolean;
  isConnecting: boolean;
  closeSocket: () => void;
  connectToShell: () => void;
  disconnectFromShell: () => void;
  resetShellConnection: () => void;
  handoffBlockedReason: string;
  canForceHandoff: boolean;
  isForceHandoffPending: boolean;
  forceCodexHandoff: () => boolean;
  providerRisk: { provider: 'pi' | 'claude'; reason: string; failures: string[] } | null;
  confirmProviderRisk: () => boolean;
  cancelProviderRisk: () => void;
};

export function useShellConnection({
  wsRef,
  terminalRef,
  fitAddonRef,
  selectedProjectRef,
  selectedSessionRef,
  providerRef,
  initialCommandRef,
  isPlainShellRef,
  onProcessCompleteRef,
  outboundSenderRef,
  isInitialized,
  autoConnect,
  closeSocket,
  clearTerminalScreen,
  setAuthUrl,
}: UseShellConnectionOptions): UseShellConnectionResult {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [handoffBlockedReason, setHandoffBlockedReason] = useState('');
  const [handoffToken, setHandoffToken] = useState('');
  const [canForceHandoff, setCanForceHandoff] = useState(false);
  const [isForceHandoffPending, setIsForceHandoffPending] = useState(false);
  const [providerRisk, setProviderRisk] = useState<{ provider: 'pi' | 'claude'; reason: string; failures: string[] } | null>(null);
  const connectingRef = useRef(false);
  const manualDisconnectRef = useRef(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const heartbeatTimeoutRef = useRef<number | null>(null);
  const outboundQueueRef = useRef<ShellOutgoingMessage[]>([]);

  /**
   * Report plain-shell process completion only when the PTY exits.
   *
   * @param {string} output
   */
  const handleProcessCompletion = useCallback(
    (output: string) => {
      if (!isPlainShellRef.current || !onProcessCompleteRef.current) {
        return;
      }

      const cleanOutput = output.replace(ANSI_ESCAPE_REGEX, '');
      if (cleanOutput.includes('Process exited with code 0')) {
        onProcessCompleteRef.current(0);
        return;
      }

      const match = cleanOutput.match(PROCESS_EXIT_REGEX);
      if (!match) {
        return;
      }

      const exitCode = Number.parseInt(match[1], 10);
      if (!Number.isNaN(exitCode) && exitCode !== 0) {
        onProcessCompleteRef.current(exitCode);
      }
    },
    [isPlainShellRef, onProcessCompleteRef],
  );

  /**
   * Clear the pending reconnect timer so only one reconnect attempt can exist.
   */
  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  /**
   * Reset heartbeat timers whenever the socket becomes healthy or is torn down.
   */
  const clearHeartbeatTimers = useCallback(() => {
    if (heartbeatIntervalRef.current !== null) {
      window.clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    if (heartbeatTimeoutRef.current !== null) {
      window.clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  /**
   * Keep only the freshest outbound resize request and bound queue growth.
   *
   * @param {ShellOutgoingMessage} message
   */
  const enqueueOutboundMessage = useCallback((message: ShellOutgoingMessage) => {
    if (message.type === 'resize') {
      const lastMessage = outboundQueueRef.current[outboundQueueRef.current.length - 1];
      if (lastMessage?.type === 'resize') {
        outboundQueueRef.current[outboundQueueRef.current.length - 1] = message;
        return;
      }
    }

    if (outboundQueueRef.current.length >= SHELL_MAX_QUEUED_MESSAGES) {
      outboundQueueRef.current.shift();
    }

    outboundQueueRef.current.push(message);
  }, []);

  /**
   * Serialize and send one websocket message to the current shell socket.
   *
   * @param {WebSocket} socket
   * @param {ShellOutgoingMessage} message
   * @returns {boolean}
   */
  const sendRawMessage = useCallback((socket: WebSocket, message: ShellOutgoingMessage) => {
    if (socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[Shell] Failed to send websocket message:', message.type, error);
      return false;
    }
  }, []);

  /**
   * Replay queued shell messages after the reconnect init frame reattaches the PTY.
   *
   * @param {WebSocket} socket
   */
  const flushOutboundQueue = useCallback((socket: WebSocket) => {
    if (socket.readyState !== WebSocket.OPEN || outboundQueueRef.current.length === 0) {
      return;
    }

    const queuedMessages = [...outboundQueueRef.current];
    outboundQueueRef.current = [];

    for (const queuedMessage of queuedMessages) {
      const sent = sendRawMessage(socket, queuedMessage);
      if (sent) {
        continue;
      }

      enqueueOutboundMessage(queuedMessage);
      break;
    }
  }, [enqueueOutboundMessage, sendRawMessage]);

  /**
   * Construct the init payload that binds the browser terminal to the target PTY session.
   *
   * @returns {ShellOutgoingMessage | null}
   */
  const buildInitMessage = useCallback(() => {
    const currentTerminal = terminalRef.current;
    const currentProject = selectedProjectRef.current;
    const currentSession = selectedSessionRef.current;
    if (!currentTerminal || !currentProject) {
      return null;
    }

    const { routeSessionId, providerSessionId } = getShellSessionIdentity(currentSession);
    const hasProviderSession = Boolean(providerSessionId);

    return {
      type: 'init',
      projectName: currentSession?.__projectName || currentProject.name || '',
      projectPath: getShellProjectPath(currentProject, currentSession),
      sessionId: isPlainShellRef.current ? null : providerSessionId,
      routeSessionId: isPlainShellRef.current ? null : routeSessionId,
      providerSessionId: isPlainShellRef.current ? null : providerSessionId,
      hasSession: isPlainShellRef.current ? false : hasProviderSession,
      provider: isPlainShellRef.current
        ? 'plain-shell'
        : normalizeShellSessionProvider(providerRef.current || currentSession?.__provider || localStorage.getItem('selected-provider')),
      cols: currentTerminal.cols,
      rows: currentTerminal.rows,
      initialCommand: initialCommandRef.current,
      isPlainShell: isPlainShellRef.current,
      externalSessionState: currentSession?.isProcessing === true
        ? 'running'
        : currentSession?.isProcessing === false
          ? 'idle'
          : currentSession?.status === 'failed'
            ? 'failed'
          : 'unknown',
    } as const;
  }, [initialCommandRef, isPlainShellRef, providerRef, selectedProjectRef, selectedSessionRef, terminalRef]);

  /**
   * Mark the websocket as alive after any inbound activity and reset the watchdog.
   */
  const markSocketAlive = useCallback(() => {
    if (heartbeatTimeoutRef.current !== null) {
      window.clearTimeout(heartbeatTimeoutRef.current);
    }

    heartbeatTimeoutRef.current = window.setTimeout(() => {
      const activeSocket = wsRef.current;
      if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
        return;
      }

      console.warn('[Shell] Heartbeat timeout reached, forcing websocket reconnect');
      activeSocket.close();
    }, SHELL_HEARTBEAT_TIMEOUT_MS);
  }, [wsRef]);

  /**
   * Start a lightweight app-level heartbeat so stale websocket links can be detected.
   *
   * @param {WebSocket} socket
   */
  const startHeartbeat = useCallback((socket: WebSocket) => {
    clearHeartbeatTimers();
    markSocketAlive();

    heartbeatIntervalRef.current = window.setInterval(() => {
      if (socket !== wsRef.current || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const sent = sendRawMessage(socket, {
        type: 'ping',
        timestamp: Date.now(),
      });

      if (sent) {
        markSocketAlive();
      }
    }, SHELL_HEARTBEAT_INTERVAL_MS);
  }, [clearHeartbeatTimers, markSocketAlive, sendRawMessage, wsRef]);

  /**
   * Render inbound shell payloads into the terminal and surface auth URLs.
   *
   * @param {string} rawPayload
   */
  const handleSocketMessage = useCallback(
    (rawPayload: string) => {
      const message = parseShellMessage(rawPayload) as ShellIncomingMessage | null;
      if (!message) {
        console.error('[Shell] Error handling websocket payload:', rawPayload);
        return;
      }

      markSocketAlive();

      if (message.type === 'pong') {
        return;
      }

      if (message.type === 'output') {
        const output = typeof message.data === 'string' ? message.data : '';
        handleProcessCompletion(output);
        terminalRef.current?.write(output);
        return;
      }

      if (message.type === 'handoff-warning' || message.type === 'handoff-blocked') {
        setHandoffBlockedReason(typeof message.reason === 'string' ? message.reason : 'external-active-session-not-shared');
        setHandoffToken(typeof message.handoffToken === 'string' ? message.handoffToken : '');
        setCanForceHandoff(message.type === 'handoff-warning' && message.canForceHandoff === true);
        setIsForceHandoffPending(false);
        return;
      }

      if (message.type === 'handoff-force-started') {
        setHandoffBlockedReason('');
        setHandoffToken('');
        setCanForceHandoff(false);
        setIsForceHandoffPending(false);
        return;
      }

      if (message.type === 'handoff-force-rejected') {
        setIsForceHandoffPending(false);
        return;
      }

      if (message.type === 'provider-risk-confirmation-required') {
        const provider = message.provider === 'pi' ? 'pi' : message.provider === 'claude' ? 'claude' : null;
        if (provider) {
          const failures = Array.isArray(message.failures)
            ? message.failures.filter((item): item is string => typeof item === 'string')
            : [];
          setProviderRisk({ provider, reason: typeof message.reason === 'string' ? message.reason : 'unknown', failures });
        }
        return;
      }

      if (message.type === 'auth_url' || message.type === 'url_open') {
        const nextAuthUrl = typeof message.url === 'string' ? message.url : '';
        if (nextAuthUrl) {
          setAuthUrl(nextAuthUrl);
        }
      }
    },
    [handleProcessCompletion, markSocketAlive, setAuthUrl, terminalRef],
  );

  /**
   * Open the shell websocket if there is no healthy active connection.
   *
   * @param {boolean} isConnectionLocked
   */
  const connectWebSocket = useCallback(
    (isConnectionLocked = false) => {
      if (connectingRef.current && !isConnectionLocked) {
        return;
      }

      if (!isConnectionLocked && (isConnecting || isConnected)) {
        return;
      }

      const existingSocket = wsRef.current;
      if (existingSocket && (existingSocket.readyState === WebSocket.OPEN || existingSocket.readyState === WebSocket.CONNECTING)) {
        return;
      }

      try {
        const socketConfig = getShellWebSocketUrl();
        if (!socketConfig) {
          connectingRef.current = false;
          setIsConnecting(false);
          return;
        }

        clearReconnectTimer();
        connectingRef.current = true;

        const socket = new WebSocket(socketConfig.url, socketConfig.protocol ? [socketConfig.protocol] : undefined);
        wsRef.current = socket;

        socket.onopen = () => {
          setIsConnected(true);
          setIsConnecting(false);
          connectingRef.current = false;
          setAuthUrl('');

          window.setTimeout(() => {
            if (wsRef.current !== socket || socket.readyState !== WebSocket.OPEN) {
              return;
            }

            const currentFitAddon = fitAddonRef.current;
            if (currentFitAddon) {
              currentFitAddon.fit();
            }

            const initMessage = buildInitMessage();
            if (!initMessage) {
              return;
            }

            sendRawMessage(socket, initMessage);
            flushOutboundQueue(socket);
            startHeartbeat(socket);
          }, TERMINAL_INIT_DELAY_MS);
        };

        socket.onmessage = (event) => {
          if (wsRef.current !== socket) {
            return;
          }

          const rawPayload = typeof event.data === 'string' ? event.data : String(event.data ?? '');
          handleSocketMessage(rawPayload);
        };

        socket.onclose = () => {
          const wasCurrentSocket = wsRef.current === socket;
          if (!wasCurrentSocket) {
            return;
          }

          clearHeartbeatTimers();
          setIsConnected(false);
          connectingRef.current = false;
          wsRef.current = null;

          if (manualDisconnectRef.current || !autoConnect || !isInitialized || !selectedProjectRef.current) {
            setIsConnecting(false);
            return;
          }

          setIsConnecting(true);
          clearReconnectTimer();
          reconnectTimeoutRef.current = window.setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connectWebSocket(true);
          }, SHELL_RECONNECT_DELAY_MS);
        };

        socket.onerror = (error) => {
          if (wsRef.current !== socket) {
            return;
          }

          connectingRef.current = false;
          console.error('[Shell] WebSocket error:', error);
        };
      } catch (error) {
        connectingRef.current = false;
        setIsConnected(false);
        setIsConnecting(false);
        console.error('[Shell] Failed to create websocket:', error);
      }
    },
    [
      autoConnect,
      buildInitMessage,
      clearHeartbeatTimers,
      clearReconnectTimer,
      fitAddonRef,
      flushOutboundQueue,
      handleSocketMessage,
      isConnected,
      isConnecting,
      isInitialized,
      selectedProjectRef,
      sendRawMessage,
      setAuthUrl,
      startHeartbeat,
      wsRef,
    ],
  );

  /**
   * Queue outbound shell traffic while disconnected and trigger reconnect when needed.
   *
   * @param {ShellOutgoingMessage} message
   * @returns {boolean}
   */
  const sendShellMessage = useCallback((message: ShellOutgoingMessage) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      return sendRawMessage(socket, message);
    }

    console.warn('[Shell] Queueing websocket message because shell socket is unavailable:', message.type, socket?.readyState);
    enqueueOutboundMessage(message);

    if (!manualDisconnectRef.current && isInitialized) {
      setIsConnecting(true);
      connectWebSocket(true);
    }

    return false;
  }, [connectWebSocket, enqueueOutboundMessage, isInitialized, sendRawMessage, wsRef]);

  /**
   * Re-send the current authenticated init context with the server-issued
   * one-time token after the user explicitly confirms a risky Codex handoff.
   */
  const forceCodexHandoff = useCallback(() => {
    const socket = wsRef.current;
    const initMessage = buildInitMessage();
    if (
      !socket
      || socket.readyState !== WebSocket.OPEN
      || !initMessage
      || !canForceHandoff
      || !handoffToken
      || isForceHandoffPending
    ) {
      return false;
    }

    const sent = sendRawMessage(socket, {
      ...initMessage,
      forceHandoff: true,
      handoffToken,
    });
    if (sent) {
      setIsForceHandoffPending(true);
    }
    return sent;
  }, [buildInitMessage, canForceHandoff, handoffToken, isForceHandoffPending, sendRawMessage, wsRef]);

  /** 用户确认外部 CLI 异常风险后，才允许同一终端进入 tmux TUI。 */
  const confirmProviderRisk = useCallback(() => {
    const socket = wsRef.current;
    const initMessage = buildInitMessage();
    if (!socket || socket.readyState !== WebSocket.OPEN || !initMessage || !providerRisk) {
      return false;
    }
    const sent = sendRawMessage(socket, { ...initMessage, riskConfirmed: true });
    if (sent) setProviderRisk(null);
    return sent;
  }, [buildInitMessage, providerRisk, sendRawMessage, wsRef]);

  /**
   * Manually start the shell relay and opt into auto-reconnect afterwards.
   */
  const connectToShell = useCallback(() => {
    if (!isInitialized || isConnected || isConnecting || connectingRef.current) {
      return;
    }

    manualDisconnectRef.current = false;
    setIsConnecting(true);
    connectingRef.current = true;
    connectWebSocket(true);
  }, [connectWebSocket, isConnected, isConnecting, isInitialized]);

  /**
   * Close the shell relay and reset transient connection state.
   *
   * @param {boolean} isManualDisconnect Whether auto-connect must stay disabled.
   */
  const resetConnectionState = useCallback((isManualDisconnect: boolean) => {
    manualDisconnectRef.current = isManualDisconnect;
    outboundQueueRef.current = [];
    clearReconnectTimer();
    clearHeartbeatTimers();
    closeSocket();
    clearTerminalScreen();
    setIsConnected(false);
    setIsConnecting(false);
    connectingRef.current = false;
    setAuthUrl('');
    setHandoffBlockedReason('');
    setHandoffToken('');
    setCanForceHandoff(false);
    setIsForceHandoffPending(false);
    setProviderRisk(null);
  }, [clearHeartbeatTimers, clearReconnectTimer, clearTerminalScreen, closeSocket, setAuthUrl]);

  /** 取消风险启动并断开当前连接，确保不会创建 PTY 或 tmux。 */
  const cancelProviderRisk = useCallback(() => {
    resetConnectionState(true);
  }, [resetConnectionState]);

  /**
   * Fully disconnect after an explicit user action and suppress auto-reconnect.
   */
  const disconnectFromShell = useCallback(() => {
    resetConnectionState(true);
  }, [resetConnectionState]);

  /**
   * Reset the current socket for an internal lifecycle change while preserving auto-connect.
   */
  const resetShellConnection = useCallback(() => {
    resetConnectionState(false);
  }, [resetConnectionState]);

  useEffect(() => {
    outboundSenderRef.current = sendShellMessage;

    return () => {
      outboundSenderRef.current = () => false;
    };
  }, [outboundSenderRef, sendShellMessage]);

  useEffect(() => {
    if (manualDisconnectRef.current || !autoConnect || !isInitialized || isConnecting || isConnected) {
      return;
    }

    connectToShell();
  }, [autoConnect, connectToShell, isConnected, isConnecting, isInitialized]);

  useEffect(() => () => {
    clearReconnectTimer();
    clearHeartbeatTimers();
  }, [clearHeartbeatTimers, clearReconnectTimer]);

  return {
    isConnected,
    isConnecting,
    closeSocket,
    connectToShell,
    disconnectFromShell,
    resetShellConnection,
    handoffBlockedReason,
    canForceHandoff,
    isForceHandoffPending,
    forceCodexHandoff,
    providerRisk,
    confirmProviderRisk,
    cancelProviderRisk,
  };
}
