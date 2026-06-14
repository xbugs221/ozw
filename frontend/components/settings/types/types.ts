import type { Dispatch, SetStateAction } from 'react';

export type SettingsMainTab = 'agents' | 'appearance' | 'diagnostics';
export type AgentProvider = 'codex' | 'pi';
export type SaveStatus = 'success' | 'error' | null;
export type CodexPermissionMode = 'bypassPermissions';

export type SettingsProject = {
  name: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
};

export type SettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects?: SettingsProject[];
  initialTab?: string;
};

export type SetState<T> = Dispatch<SetStateAction<T>>;
