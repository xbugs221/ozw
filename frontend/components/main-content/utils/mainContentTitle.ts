/**
 * PURPOSE: Resolve stable main-content header titles for project-scoped tabs.
 */
import type { AppTab, Project } from '../../../types/app';

type TranslateTitle = (key: string) => string;

/**
 * Keep named overview/file sections while showing the concrete project name
 * for Shell/TUI and preview surfaces that previously displayed “Project”.
 */
export function getMainContentTabTitle(
  activeTab: AppTab,
  selectedProject: Project | null,
  t: TranslateTitle,
): string {
  if (activeTab === 'overview') {
    return t('tabs.overview');
  }
  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }
  return selectedProject?.displayName || selectedProject?.name || 'Project';
}
