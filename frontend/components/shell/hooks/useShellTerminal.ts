/**
 * PURPOSE: Own the xterm.js instance and forward user terminal events through
 * the shell websocket sender so input survives reconnects.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import type { Project } from '../../../types/app';
import {
  CODEX_DEVICE_AUTH_URL,
  TERMINAL_INIT_DELAY_MS,
  TERMINAL_OPTIONS,
  TERMINAL_RESIZE_DELAY_MS,
  getTerminalTheme,
} from '../constants/constants';
import { isCodexLoginCommand } from '../utils/auth';
import { getVirtualCtrlKeyboardInput } from '../utils/mobileKeyInput';
import { ensureXtermFocusStyles } from '../utils/terminalStyles';
import type { ShellOutgoingMessage } from '../types/types';

type UseShellTerminalOptions = {
  terminalContainerRef: RefObject<HTMLDivElement>;
  terminalRef: MutableRefObject<Terminal | null>;
  fitAddonRef: MutableRefObject<FitAddon | null>;
  selectedProject: Project | null | undefined;
  isDarkMode: boolean;
  minimal: boolean;
  isRestarting: boolean;
  initialCommandRef: MutableRefObject<string | null | undefined>;
  isPlainShellRef: MutableRefObject<boolean>;
  virtualCtrlActiveRef: MutableRefObject<boolean>;
  authUrlRef: MutableRefObject<string>;
  copyAuthUrlToClipboard: (url?: string) => Promise<boolean>;
  sendShellMessage: (message: ShellOutgoingMessage) => boolean;
  closeSocket: () => void;
};

type UseShellTerminalResult = {
  isInitialized: boolean;
  clearTerminalScreen: () => void;
  disposeTerminal: () => void;
};

/**
 * Skip the xterm WebGL renderer in automation contexts where GPU-backed canvas
 * support is incomplete and can stall terminal initialization.
 *
 * @returns {boolean}
 */
function shouldEnableWebglRenderer() {
  if (typeof navigator !== 'undefined' && navigator.webdriver) {
    return false;
  }

  return true;
}

export function useShellTerminal({
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
}: UseShellTerminalOptions): UseShellTerminalResult {
  const [isInitialized, setIsInitialized] = useState(false);
  const resizeTimeoutRef = useRef<number | null>(null);
  const selectedProjectKey = selectedProject?.fullPath || selectedProject?.path || '';
  const hasSelectedProject = Boolean(selectedProject);
  const terminalTheme = useMemo(() => getTerminalTheme(isDarkMode), [isDarkMode]);

  useEffect(() => {
    ensureXtermFocusStyles();
  }, []);

  /**
   * Reset the visible terminal buffer without destroying the xterm instance.
   */
  const clearTerminalScreen = useCallback(() => {
    if (!terminalRef.current) {
      return;
    }

    terminalRef.current.clear();
    terminalRef.current.write('\x1b[2J\x1b[H');
  }, [terminalRef]);

  /**
   * Dispose xterm.js resources before a terminal remount or shell restart.
   */
  const disposeTerminal = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }

    fitAddonRef.current = null;
    setIsInitialized(false);
  }, [fitAddonRef, terminalRef]);

  useEffect(() => {
    if (!terminalContainerRef.current || !hasSelectedProject || isRestarting || terminalRef.current) {
      return;
    }

    const nextTerminal = new Terminal({
      ...TERMINAL_OPTIONS,
      theme: terminalTheme,
    });
    terminalRef.current = nextTerminal;

    const nextFitAddon = new FitAddon();
    fitAddonRef.current = nextFitAddon;
    nextTerminal.loadAddon(nextFitAddon);

    if (!minimal) {
      nextTerminal.loadAddon(new WebLinksAddon());
    }

    if (shouldEnableWebglRenderer()) {
      try {
        nextTerminal.loadAddon(new WebglAddon());
      } catch {
        console.warn('[Shell] WebGL renderer unavailable, using Canvas fallback');
      }
    }

    nextTerminal.open(terminalContainerRef.current);

    nextTerminal.attachCustomKeyEventHandler((event) => {
      const activeAuthUrl = isCodexLoginCommand(initialCommandRef.current)
        ? CODEX_DEVICE_AUTH_URL
        : authUrlRef.current;

      if (
        event.type === 'keydown' &&
        virtualCtrlActiveRef.current &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const virtualCtrlInput = getVirtualCtrlKeyboardInput(event.key);
        if (virtualCtrlInput) {
          event.preventDefault();
          event.stopPropagation();
          sendShellMessage({
            type: 'input',
            data: virtualCtrlInput,
          });
          return false;
        }
      }

      if (
        event.type === 'keydown' &&
        minimal &&
        isPlainShellRef.current &&
        activeAuthUrl &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key?.toLowerCase() === 'c'
      ) {
        event.preventDefault();
        event.stopPropagation();
        void copyAuthUrlToClipboard(activeAuthUrl);
        return false;
      }

      if (
        event.type === 'keydown' &&
        (event.ctrlKey || event.metaKey) &&
        event.key?.toLowerCase() === 'c' &&
        nextTerminal.hasSelection()
      ) {
        event.preventDefault();
        event.stopPropagation();
        document.execCommand('copy');
        return false;
      }

      if (
        event.type === 'keydown' &&
        (event.ctrlKey || event.metaKey) &&
        event.key?.toLowerCase() === 'v'
      ) {
        event.preventDefault();
        event.stopPropagation();

        if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
          navigator.clipboard
            .readText()
            .then((text) => {
              if (!text) {
                return;
              }

              sendShellMessage({
                type: 'input',
                data: text,
              });
            })
            .catch(() => {});
        }

        return false;
      }

      return true;
    });

    window.setTimeout(() => {
      const currentFitAddon = fitAddonRef.current;
      const currentTerminal = terminalRef.current;
      if (!currentFitAddon || !currentTerminal) {
        return;
      }

      currentFitAddon.fit();
      sendShellMessage({
        type: 'resize',
        cols: currentTerminal.cols,
        rows: currentTerminal.rows,
      });
    }, TERMINAL_INIT_DELAY_MS);

    setIsInitialized(true);

    const dataSubscription = nextTerminal.onData((data) => {
      sendShellMessage({
        type: 'input',
        data,
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
      }

      resizeTimeoutRef.current = window.setTimeout(() => {
        const currentFitAddon = fitAddonRef.current;
        const currentTerminal = terminalRef.current;
        if (!currentFitAddon || !currentTerminal) {
          return;
        }

        currentFitAddon.fit();
        sendShellMessage({
          type: 'resize',
          cols: currentTerminal.cols,
          rows: currentTerminal.rows,
        });
      }, TERMINAL_RESIZE_DELAY_MS);
    });

    resizeObserver.observe(terminalContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
      dataSubscription.dispose();
      closeSocket();
      disposeTerminal();
    };
  }, [
    authUrlRef,
    closeSocket,
    copyAuthUrlToClipboard,
    disposeTerminal,
    fitAddonRef,
    initialCommandRef,
    isPlainShellRef,
    isRestarting,
    minimal,
    hasSelectedProject,
    selectedProjectKey,
    sendShellMessage,
    terminalContainerRef,
    terminalRef,
    virtualCtrlActiveRef,
  ]);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    terminalRef.current.options.theme = terminalTheme;
  }, [terminalRef, terminalTheme]);

  return {
    isInitialized,
    clearTerminalScreen,
    disposeTerminal,
  };
}
