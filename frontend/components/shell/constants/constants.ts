/**
 * PURPOSE: Centralize shell terminal UI constants, reconnect timings, and
 * heartbeat thresholds used by the browser-to-PTY relay.
 */
import type { ITerminalOptions, ITheme } from '@xterm/xterm';

export const CODEX_DEVICE_AUTH_URL = 'https://auth.openai.com/codex/device';
export const SHELL_RESTART_DELAY_MS = 200;
export const SHELL_RECONNECT_DELAY_MS = 1_500;
export const SHELL_HEARTBEAT_INTERVAL_MS = 15_000;
export const SHELL_HEARTBEAT_TIMEOUT_MS = 45_000;
export const SHELL_MAX_QUEUED_MESSAGES = 200;
export const TERMINAL_INIT_DELAY_MS = 100;
export const TERMINAL_RESIZE_DELAY_MS = 50;

export const TERMINAL_THEMES: Record<'dark' | 'light', ITheme> = {
  dark: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#ffffff',
    cursorAccent: '#1e1e1e',
    selectionBackground: '#264f78',
    selectionForeground: '#ffffff',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
    extendedAnsi: [
      '#000000',
      '#800000',
      '#008000',
      '#808000',
      '#000080',
      '#800080',
      '#008080',
      '#c0c0c0',
      '#808080',
      '#ff0000',
      '#00ff00',
      '#ffff00',
      '#0000ff',
      '#ff00ff',
      '#00ffff',
      '#ffffff',
    ],
  },
  light: {
    background: '#ffffff',
    foreground: '#1f2937',
    cursor: '#111827',
    cursorAccent: '#ffffff',
    selectionBackground: '#bfdbfe',
    selectionForeground: '#111827',
    black: '#000000',
    red: '#b91c1c',
    green: '#047857',
    yellow: '#a16207',
    blue: '#1d4ed8',
    magenta: '#9333ea',
    cyan: '#0e7490',
    white: '#e5e7eb',
    brightBlack: '#6b7280',
    brightRed: '#dc2626',
    brightGreen: '#059669',
    brightYellow: '#ca8a04',
    brightBlue: '#2563eb',
    brightMagenta: '#a855f7',
    brightCyan: '#0891b2',
    brightWhite: '#ffffff',
    extendedAnsi: [
      '#000000',
      '#7f1d1d',
      '#14532d',
      '#713f12',
      '#1e3a8a',
      '#581c87',
      '#164e63',
      '#d1d5db',
      '#6b7280',
      '#ef4444',
      '#22c55e',
      '#eab308',
      '#3b82f6',
      '#c084fc',
      '#22d3ee',
      '#ffffff',
    ],
  },
};

/**
 * Select the xterm color palette that matches the application theme.
 *
 * @param isDarkMode - Whether the application is currently in dark mode.
 * @returns The terminal palette for the active app theme.
 */
export function getTerminalTheme(isDarkMode: boolean): ITheme {
  return isDarkMode ? TERMINAL_THEMES.dark : TERMINAL_THEMES.light;
}

export const TERMINAL_OPTIONS: ITerminalOptions = {
  cursorBlink: true,
  fontSize: 14,
  fontFamily: '"GitLab Mono", Menlo, Monaco, "Courier New", monospace',
  allowProposedApi: true,
  allowTransparency: false,
  convertEol: true,
  scrollback: 10000,
  tabStopWidth: 4,
  windowsMode: false,
  macOptionIsMeta: true,
  macOptionClickForcesSelection: true,
  theme: TERMINAL_THEMES.dark,
};
