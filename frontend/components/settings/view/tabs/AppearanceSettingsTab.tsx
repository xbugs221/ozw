import { useTranslation } from 'react-i18next';
import DarkModeToggle from '../controls/DarkModeToggle';
import LanguageSelector from '../controls/LanguageSelector';

export default function AppearanceSettingsTab() {
  /**
   * Render the long-lived display preferences that remain part of settings.
   */
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="space-y-4">
        <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-foreground">{t('appearanceSettings.darkMode.label')}</div>
              <div className="text-sm text-muted-foreground">
                {t('appearanceSettings.darkMode.description')}
              </div>
            </div>
            <DarkModeToggle ariaLabel={t('appearanceSettings.darkMode.label')} />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <LanguageSelector />
      </div>
    </div>
  );
}
