/**
 * PURPOSE: Render a compact mobile helper-key row for xterm terminals where
 * software keyboards cannot reliably emit Escape, Tab, Ctrl, or arrows.
 */
import { useCallback } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { getShellMobileKeyInput } from '../../utils/mobileKeyInput';
import type { ShellMobileKey } from '../../utils/mobileKeyInput';

type ShellMobileKeyBarProps = {
  ctrlActive: boolean;
  onCtrlActiveChange: (isActive: boolean) => void;
  onInput: (data: string) => void;
};

type HelperKeyConfig = {
  key: ShellMobileKey;
  label: string;
  ariaLabel: string;
};

const HELPER_KEYS: HelperKeyConfig[] = [
  { key: 'escape', label: 'Esc', ariaLabel: 'Escape' },
  { key: 'tab', label: 'Tab', ariaLabel: 'Tab' },
  { key: 'arrowLeft', label: '←', ariaLabel: 'Arrow left' },
  { key: 'arrowDown', label: '↓', ariaLabel: 'Arrow down' },
  { key: 'arrowUp', label: '↑', ariaLabel: 'Arrow up' },
  { key: 'arrowRight', label: '→', ariaLabel: 'Arrow right' },
];

const BASE_BUTTON_CLASS = 'h-9 min-w-12 rounded-md border px-3 text-sm font-medium active:bg-gray-200 dark:active:bg-gray-700';

export default function ShellMobileKeyBar({
  ctrlActive,
  onCtrlActiveChange,
  onInput,
}: ShellMobileKeyBarProps) {
  /**
   * Send one helper key while preserving the active Ctrl modifier state.
   *
   * @param {ShellMobileKey} key
   */
  const sendHelperKey = useCallback((key: ShellMobileKey) => {
    onInput(getShellMobileKeyInput(key, ctrlActive));
  }, [ctrlActive, onInput]);

  /**
   * Keep touch interaction from stealing focus from xterm's hidden textarea.
   *
   * @param {PointerEvent<HTMLButtonElement>} event
   */
  const keepTerminalFocus = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
  }, []);

  /**
   * Start the held Ctrl modifier and capture the pointer until it is released.
   *
   * @param {PointerEvent<HTMLButtonElement>} event
   */
  const handleCtrlPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    keepTerminalFocus(event);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; normal pointer release still clears Ctrl.
    }
    onCtrlActiveChange(true);
  }, [keepTerminalFocus, onCtrlActiveChange]);

  /**
   * Release the held Ctrl modifier when the long press ends.
   *
   * @param {PointerEvent<HTMLButtonElement>} event
   */
  const handleCtrlPointerRelease = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    keepTerminalFocus(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onCtrlActiveChange(false);
  }, [keepTerminalFocus, onCtrlActiveChange]);

  /**
   * Let keyboard users activate helper keys without producing a native button click.
   *
   * @param {KeyboardEvent<HTMLButtonElement>} event
   * @param {ShellMobileKey} key
   */
  const handleKeyButtonKeyboard = useCallback((event: KeyboardEvent<HTMLButtonElement>, key: ShellMobileKey) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    sendHelperKey(key);
  }, [sendHelperKey]);

  return (
    <div
      className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-t border-gray-200 bg-gray-50 px-2 py-1.5 md:hidden dark:border-gray-700 dark:bg-gray-800"
      data-testid="shell-mobile-keybar"
    >
      <button
        type="button"
        className={`${BASE_BUTTON_CLASS} ${
          ctrlActive
            ? 'border-blue-500 bg-blue-600 text-white'
            : 'border-gray-300 bg-white text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'
        }`}
        aria-label="Ctrl"
        aria-pressed={ctrlActive}
        data-testid="shell-mobile-key-ctrl"
        onPointerDown={handleCtrlPointerDown}
        onPointerUp={handleCtrlPointerRelease}
        onPointerCancel={handleCtrlPointerRelease}
        onLostPointerCapture={() => onCtrlActiveChange(false)}
        onContextMenu={(event) => event.preventDefault()}
      >
        Ctrl
      </button>

      {HELPER_KEYS.map((helperKey) => (
        <button
          key={helperKey.key}
          type="button"
          className={`${BASE_BUTTON_CLASS} border-gray-300 bg-white text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100`}
          aria-label={helperKey.ariaLabel}
          data-testid={`shell-mobile-key-${helperKey.key}`}
          onPointerDown={(event) => {
            keepTerminalFocus(event);
            sendHelperKey(helperKey.key);
          }}
          onKeyDown={(event) => handleKeyButtonKeyboard(event, helperKey.key)}
        >
          {helperKey.label}
        </button>
      ))}
    </div>
  );
}
