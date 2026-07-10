/**
 * PURPOSE: Coordinate the browser shell terminal and websocket relay while
 * keeping shared refs stable across reconnects and session switches.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { useShellConnection } from './useShellConnection';
import { useShellTerminal } from './useShellTerminal';
import type { ShellOutgoingMessage, UseShellRuntimeOptions, UseShellRuntimeResult } from '../types/types';
import { copyTextToClipboard } from '../../../utils/clipboard';

export function useShellRuntime({
  selectedProject,
  selectedSession,
  provider,
  initialCommand,
  isPlainShell,
  isDarkMode,
  minimal,
  autoConnect,
  isRestarting,
  onProcessComplete,
}: UseShellRuntimeOptions): UseShellRuntimeResult {
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sendShellMessageRef = useRef<(message: ShellOutgoingMessage) => boolean>(() => false);
  const virtualCtrlActiveRef = useRef(false);

  const [authUrl, setAuthUrl] = useState('');
  const [authUrlVersion, setAuthUrlVersion] = useState(0);
  const [isVirtualCtrlActive, setIsVirtualCtrlActive] = useState(false);

  const selectedProjectRef = useRef(selectedProject);
  const selectedSessionRef = useRef(selectedSession);
  const providerRef = useRef(provider);
  const initialCommandRef = useRef(initialCommand);
  const isPlainShellRef = useRef(isPlainShell);
  const onProcessCompleteRef = useRef(onProcessComplete);
  const authUrlRef = useRef('');
  const lastSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);

  // Keep mutable values in refs so websocket handlers always read current data.
  useEffect(() => {
    selectedProjectRef.current = selectedProject;
    selectedSessionRef.current = selectedSession;
    providerRef.current = provider;
    initialCommandRef.current = initialCommand;
    isPlainShellRef.current = isPlainShell;
    onProcessCompleteRef.current = onProcessComplete;
  }, [selectedProject, selectedSession, provider, initialCommand, isPlainShell, onProcessComplete]);

  const setCurrentAuthUrl = useCallback((nextAuthUrl: string) => {
    authUrlRef.current = nextAuthUrl;
    setAuthUrl(nextAuthUrl);
    setAuthUrlVersion((previous) => previous + 1);
  }, []);

  const closeSocket = useCallback(() => {
    const activeSocket = wsRef.current;
    if (!activeSocket) {
      return;
    }

    if (
      activeSocket.readyState === WebSocket.OPEN ||
      activeSocket.readyState === WebSocket.CONNECTING
    ) {
      activeSocket.close();
    }

    wsRef.current = null;
  }, []);

  const openAuthUrlInBrowser = useCallback((url = authUrlRef.current) => {
    if (!url) {
      return false;
    }

    const popup = window.open(url, '_blank');
    if (popup) {
      try {
        popup.opener = null;
      } catch {
        // Ignore cross-origin restrictions when trying to null opener.
      }
      return true;
    }

    return false;
  }, []);

  const copyAuthUrlToClipboard = useCallback(async (url = authUrlRef.current) => {
    if (!url) {
      return false;
    }

    return copyTextToClipboard(url);
  }, []);

  /**
   * Forward terminal events through the current connection-managed sender.
   *
   * @param {ShellOutgoingMessage} message
   * @returns {boolean}
   */
  const sendShellMessage = useCallback((message: ShellOutgoingMessage) => {
    return sendShellMessageRef.current(message);
  }, []);

  /**
   * Keep the on-screen Ctrl key state available to both touch buttons and
   * xterm's keyboard event handler.
   *
   * @param {boolean} isActive
   */
  const setVirtualCtrlActive = useCallback((isActive: boolean) => {
    virtualCtrlActiveRef.current = isActive;
    setIsVirtualCtrlActive(isActive);
  }, []);

  /**
   * Send helper-key input through the same websocket path as native xterm data.
   *
   * @param {string} data
   * @returns {boolean}
   */
  const sendTerminalInput = useCallback((data: string) => {
    if (!data) {
      return false;
    }

    terminalRef.current?.focus();
    return sendShellMessage({
      type: 'input',
      data,
    });
  }, [sendShellMessage]);

  /**
   * Ask the shell relay to end the persistent tmux session for this terminal.
   *
   * @returns {boolean}
   */
  const terminateShell = useCallback(() => {
    return sendShellMessage({ type: 'kill_terminal' });
  }, [sendShellMessage]);

  const { isInitialized, clearTerminalScreen, disposeTerminal } = useShellTerminal({
    terminalContainerRef,
    terminalRef,
    fitAddonRef,
    selectedProject,
    isDarkMode,
    minimal,
    isRestarting,
    initialCommandRef,
    isPlainShellRef,
    virtualCtrlActiveRef,
    authUrlRef,
    copyAuthUrlToClipboard,
    sendShellMessage,
    closeSocket,
  });

  const {
    isConnected,
    isConnecting,
    connectToShell,
    disconnectFromShell,
    resetShellConnection,
  } = useShellConnection({
    wsRef,
    terminalRef,
    fitAddonRef,
    selectedProjectRef,
    selectedSessionRef,
    providerRef,
    initialCommandRef,
    isPlainShellRef,
    onProcessCompleteRef,
    outboundSenderRef: sendShellMessageRef,
    isInitialized,
    autoConnect,
    closeSocket,
    clearTerminalScreen,
    setAuthUrl: setCurrentAuthUrl,
  });

  useEffect(() => {
    if (!isRestarting) {
      return;
    }

    resetShellConnection();
    disposeTerminal();
  }, [disposeTerminal, isRestarting, resetShellConnection]);

  useEffect(() => {
    if (selectedProject) {
      return;
    }

    resetShellConnection();
    disposeTerminal();
  }, [disposeTerminal, resetShellConnection, selectedProject]);

  useEffect(() => {
    const currentSessionId = selectedSession?.id ?? null;
    if (lastSessionIdRef.current !== currentSessionId && isInitialized) {
      resetShellConnection();
    }

    lastSessionIdRef.current = currentSessionId;
  }, [isInitialized, resetShellConnection, selectedSession?.id]);

  return {
    terminalContainerRef,
    isConnected,
    isInitialized,
    isConnecting,
    isVirtualCtrlActive,
    authUrl,
    authUrlVersion,
    setVirtualCtrlActive,
    sendTerminalInput,
    terminateShell,
    connectToShell,
    disconnectFromShell,
    openAuthUrlInBrowser,
    copyAuthUrlToClipboard,
  };
}
