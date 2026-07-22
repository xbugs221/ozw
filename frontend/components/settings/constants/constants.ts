import type {
  AgentProvider,
  SettingsMainTab,
} from '../types/types';

export const SETTINGS_MAIN_TABS: SettingsMainTab[] = [
  'appearance',
  'diagnostics',
];

export const AGENT_PROVIDERS: AgentProvider[] = ['codex', 'pi'];
export const DEFAULT_SAVE_STATUS = null;
