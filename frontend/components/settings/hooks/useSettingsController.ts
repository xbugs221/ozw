// PURPOSE: Coordinate settings modal state and persistence without probing retired provider CLIs.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../../../contexts/ThemeContext';
import type {
  CodexPermissionMode,
  SettingsMainTab,
  SettingsProject,
} from '../types/types';

type ThemeContextValue = {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
};

type UseSettingsControllerArgs = {
  isOpen: boolean;
  initialTab: string;
  projects: SettingsProject[];
  onClose: () => void;
};

type CodexSettingsStorage = {
  permissionMode?: CodexPermissionMode;
};

const KNOWN_MAIN_TABS: SettingsMainTab[] = ['appearance', 'agents', 'diagnostics'];

/**
 * Resolve external settings tab names into a supported panel, using appearance
 * as the default entry point for the settings modal.
 */
const normalizeMainTab = (tab: string): SettingsMainTab => {
  return KNOWN_MAIN_TABS.includes(tab as SettingsMainTab) ? (tab as SettingsMainTab) : 'appearance';
};

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toCodexPermissionMode = (_value: unknown): CodexPermissionMode => {
  return 'bypassPermissions';
};

export function useSettingsController({ isOpen, initialTab, onClose }: UseSettingsControllerArgs) {
  const { isDarkMode, toggleDarkMode } = useTheme() as ThemeContextValue;
  const closeTimerRef = useRef<number | null>(null);

  const [activeTab, setActiveTab] = useState<SettingsMainTab>(() => normalizeMainTab(initialTab));
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);

  const [codexPermissionMode, setCodexPermissionMode] = useState<CodexPermissionMode>('bypassPermissions');

  const loadSettings = useCallback(async () => {
    try {
      const savedCodexSettings = parseJson<CodexSettingsStorage>(
        localStorage.getItem('codex-settings'),
        {},
      );
      setCodexPermissionMode(toCodexPermissionMode(savedCodexSettings.permissionMode));
    } catch (error) {
      console.error('Error loading settings:', error);
      setCodexPermissionMode('bypassPermissions');
    }
  }, []);

  const saveSettings = useCallback(() => {
    setIsSaving(true);
    setSaveStatus(null);

    try {
      localStorage.setItem('codex-settings', JSON.stringify({
        permissionMode: codexPermissionMode,
        lastUpdated: new Date().toISOString(),
      }));

      setSaveStatus('success');
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      closeTimerRef.current = window.setTimeout(() => onClose(), 1000);
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  }, [
    codexPermissionMode,
    onClose,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab(normalizeMainTab(initialTab));
    void loadSettings();
  }, [initialTab, isOpen, loadSettings]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  return {
    activeTab,
    setActiveTab,
    isDarkMode,
    toggleDarkMode,
    isSaving,
    saveStatus,
    codexPermissionMode,
    setCodexPermissionMode,
    saveSettings,
  };
}
