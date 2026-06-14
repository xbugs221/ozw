const Activity = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>;
import { useTranslation } from 'react-i18next';
import type { SettingsMainTab } from '../types/types';

type SettingsMainTabsProps = {
  activeTab: SettingsMainTab;
  onChange: (tab: SettingsMainTab) => void;
};

type MainTabConfig = {
  id: SettingsMainTab;
  labelKey: string;
  defaultLabel: string;
  icon?: typeof Activity;
};

const TAB_CONFIG: MainTabConfig[] = [
  { id: 'appearance', labelKey: 'mainTabs.appearance', defaultLabel: 'Appearance' },
  { id: 'agents', labelKey: 'mainTabs.agents', defaultLabel: 'Agents' },
  { id: 'diagnostics', labelKey: 'mainTabs.diagnostics', defaultLabel: 'Diagnostics', icon: Activity },
];

export default function SettingsMainTabs({ activeTab, onChange }: SettingsMainTabsProps) {
  /**
   * Render top-level settings tabs including runtime diagnostics for external
   * workflow binaries.
   */
  const { t } = useTranslation('settings');

  return (
    <div className="border-b border-border">
       <div className="flex px-4 md:px-6" role="tablist" aria-label={t('mainTabs.label', { defaultValue: 'Settings' })}>
        {TAB_CONFIG.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {Icon && <Icon className="w-4 h-4 inline mr-2" />}
              {t(tab.labelKey, { defaultValue: tab.defaultLabel })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
