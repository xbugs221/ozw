// PURPOSE: Keep code editor display preferences synchronized with browser storage.
import { useCallback, useEffect, useState } from 'react';
import {
  CODE_EDITOR_DEFAULTS,
  CODE_EDITOR_SETTINGS_CHANGED_EVENT,
  CODE_EDITOR_STORAGE_KEYS,
} from '../constants/settings';

const readTheme = () => {
  const savedTheme = localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.theme);
  if (!savedTheme) {
    return CODE_EDITOR_DEFAULTS.isDarkMode;
  }

  return savedTheme === 'dark';
};

const readBoolean = (storageKey: string, defaultValue: boolean, falseValue = 'false') => {
  const value = localStorage.getItem(storageKey);
  if (value === null) {
    return defaultValue;
  }

  return value !== falseValue;
};

const readWordWrap = () => {
  return localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.wordWrap) === 'true';
};

const readFontSize = () => {
  const stored = localStorage.getItem(CODE_EDITOR_STORAGE_KEYS.fontSize);
  return Number(stored ?? CODE_EDITOR_DEFAULTS.fontSize);
};

const publishSettingsChange = () => {
  /**
   * Notify other mounted editor instances that browser-backed editor display
   * preferences changed outside their local React state.
   */
  window.dispatchEvent(new Event(CODE_EDITOR_SETTINGS_CHANGED_EVENT));
};

export const useCodeEditorSettings = () => {
  const [isDarkMode, setIsDarkMode] = useState(readTheme);
  const [wordWrap, setWordWrap] = useState(readWordWrap);
  const [minimapEnabled, setMinimapEnabled] = useState(() => (
    readBoolean(CODE_EDITOR_STORAGE_KEYS.showMinimap, CODE_EDITOR_DEFAULTS.minimapEnabled)
  ));
  const [showLineNumbers, setShowLineNumbers] = useState(() => (
    readBoolean(CODE_EDITOR_STORAGE_KEYS.lineNumbers, CODE_EDITOR_DEFAULTS.showLineNumbers)
  ));
  const [fontSize, setFontSize] = useState(readFontSize);

  const updateDarkMode = useCallback((value: boolean) => {
    /**
     * Persist the editor theme separately from the global application theme.
     */
    localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.theme, value ? 'dark' : 'light');
    setIsDarkMode(value);
    publishSettingsChange();
  }, []);

  const updateWordWrap = useCallback((value: boolean) => {
    /**
     * Persist wrapping so reopened editors keep long-line behavior stable.
     */
    localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.wordWrap, String(value));
    setWordWrap(value);
    publishSettingsChange();
  }, []);

  const updateMinimapEnabled = useCallback((value: boolean) => {
    /**
     * Persist minimap visibility for diff-heavy files where screen space matters.
     */
    localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.showMinimap, String(value));
    setMinimapEnabled(value);
    publishSettingsChange();
  }, []);

  const updateShowLineNumbers = useCallback((value: boolean) => {
    /**
     * Persist line number visibility because it changes the editor gutter layout.
     */
    localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.lineNumbers, String(value));
    setShowLineNumbers(value);
    publishSettingsChange();
  }, []);

  const updateFontSize = useCallback((value: number) => {
    /**
     * Persist monospace font size as a number accepted by the CodeMirror surface.
     */
    localStorage.setItem(CODE_EDITOR_STORAGE_KEYS.fontSize, String(value));
    setFontSize(value);
    publishSettingsChange();
  }, []);

  useEffect(() => {
    const refreshFromStorage = () => {
      setIsDarkMode(readTheme());
      setWordWrap(readWordWrap());
      setMinimapEnabled(readBoolean(CODE_EDITOR_STORAGE_KEYS.showMinimap, CODE_EDITOR_DEFAULTS.minimapEnabled));
      setShowLineNumbers(readBoolean(CODE_EDITOR_STORAGE_KEYS.lineNumbers, CODE_EDITOR_DEFAULTS.showLineNumbers));
      setFontSize(readFontSize());
    };

    window.addEventListener('storage', refreshFromStorage);
    window.addEventListener(CODE_EDITOR_SETTINGS_CHANGED_EVENT, refreshFromStorage);

    return () => {
      window.removeEventListener('storage', refreshFromStorage);
      window.removeEventListener(CODE_EDITOR_SETTINGS_CHANGED_EVENT, refreshFromStorage);
    };
  }, []);

  return {
    isDarkMode,
    setIsDarkMode: updateDarkMode,
    wordWrap,
    setWordWrap: updateWordWrap,
    minimapEnabled,
    setMinimapEnabled: updateMinimapEnabled,
    showLineNumbers,
    setShowLineNumbers: updateShowLineNumbers,
    fontSize,
    setFontSize: updateFontSize,
  };
};
