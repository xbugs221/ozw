/**
 * PURPOSE: Map mobile shell helper keys to the terminal byte sequences that a
 * PTY expects from xterm-style keyboard input.
 */
export type ShellMobileKey = 'escape' | 'tab' | 'arrowUp' | 'arrowDown' | 'arrowLeft' | 'arrowRight';

const NORMAL_KEY_INPUT: Record<ShellMobileKey, string> = {
  escape: '\x1b',
  tab: '\t',
  arrowUp: '\x1b[A',
  arrowDown: '\x1b[B',
  arrowLeft: '\x1b[D',
  arrowRight: '\x1b[C',
};

const CTRL_KEY_INPUT: Partial<Record<ShellMobileKey, string>> = {
  arrowUp: '\x1b[1;5A',
  arrowDown: '\x1b[1;5B',
  arrowLeft: '\x1b[1;5D',
  arrowRight: '\x1b[1;5C',
};

const CTRL_CHARACTER_INPUT: Record<string, string> = {
  ' ': '\x00',
  '[': '\x1b',
  '\\': '\x1c',
  ']': '\x1d',
  '^': '\x1e',
  '_': '\x1f',
};

/**
 * Return the byte sequence for a helper key, honoring held Ctrl where terminals
 * have a distinct xterm sequence.
 *
 * @param {ShellMobileKey} key
 * @param {boolean} ctrlActive
 * @returns {string}
 */
export function getShellMobileKeyInput(key: ShellMobileKey, ctrlActive: boolean): string {
  return (ctrlActive ? CTRL_KEY_INPUT[key] : null) || NORMAL_KEY_INPUT[key];
}

/**
 * Convert a browser keyboard event key into a Ctrl-modified byte sequence while
 * the on-screen Ctrl key is being held.
 *
 * @param {string} key
 * @returns {string | null}
 */
export function getVirtualCtrlKeyboardInput(key: string): string | null {
  if (key.length === 1) {
    const lowerKey = key.toLowerCase();
    if (lowerKey >= 'a' && lowerKey <= 'z') {
      return String.fromCharCode(lowerKey.charCodeAt(0) - 96);
    }

    return CTRL_CHARACTER_INPUT[key] || null;
  }

  switch (key) {
    case 'ArrowUp':
      return CTRL_KEY_INPUT.arrowUp || null;
    case 'ArrowDown':
      return CTRL_KEY_INPUT.arrowDown || null;
    case 'ArrowLeft':
      return CTRL_KEY_INPUT.arrowLeft || null;
    case 'ArrowRight':
      return CTRL_KEY_INPUT.arrowRight || null;
    case 'Escape':
      return NORMAL_KEY_INPUT.escape;
    case 'Tab':
      return NORMAL_KEY_INPUT.tab;
    default:
      return null;
  }
}
