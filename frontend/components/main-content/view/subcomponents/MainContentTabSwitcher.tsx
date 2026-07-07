/**
 * PURPOSE: Layout control buttons for the main workspace dock panels.
 * Renders icon-only controls that keep accessible names for dock tab actions.
 */
const RenderDocument = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth={sw || "2"} fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>;
const Terminal = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="4,17 10,11 4,5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>;
const Folder = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
const Home = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth={sw || "2"} fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>;
import Tooltip from '../../../ui/Tooltip';
import type { AppTab } from '../../../../types/app';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { DockLayoutControl } from '../../types/types';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  compact?: boolean;
  dockLayout?: DockLayoutControl;
  isRenderingSnapshot?: boolean;
};

type TabDefinition = {
  id: AppTab;
  labelKey: string;
  icon: ({ className, strokeWidth }: { className?: string; strokeWidth?: number }) => JSX.Element;
};

const BASE_TABS: TabDefinition[] = [
  { id: 'overview', labelKey: 'tabs.overview', icon: Home },
  { id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { id: 'chat', labelKey: 'tabs.chat', icon: RenderDocument },
  { id: 'files', labelKey: 'tabs.files', icon: Folder },
];

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  compact = false,
  dockLayout,
  isRenderingSnapshot = false,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();

  const tabs = BASE_TABS;

  const isTabActive = (tabId: AppTab): boolean => {
    /**
     * Desktop dock buttons are controls, not primary tab selections. Mobile
     * callers do not pass dockLayout, so they keep the single-view behavior.
     */
    if (tabId === 'chat') return activeTab === 'chat';
    if (tabId === 'overview') return activeTab === 'overview';
    if (tabId === 'preview') return activeTab === 'preview';

    if (dockLayout && (tabId === 'files' || tabId === 'shell')) {
      if (tabId === 'files') {
        return dockLayout.rightDockActive === tabId && !dockLayout.rightDockCollapsed;
      }

      return activeTab === 'shell'
        || (dockLayout.lowerPanelActive === 'terminal' && !dockLayout.lowerPanelCollapsed)
        || dockLayout.rightDockSplitBottom === 'terminal';
    }

    return tabId === activeTab;
  };

  const handleTabClick = (tabId: AppTab) => {
    if (tabId === 'overview') {
      setActiveTab('overview');
    } else if (tabId === 'chat') {
      setActiveTab('chat');
      // Focus chat input or scroll to chat area could be added here
    } else if (tabId === 'files') {
      setActiveTab('files');
    } else if (tabId === 'shell') {
      setActiveTab('shell');
    } else {
      setActiveTab(tabId);
    }
  };

  return (
    <div
      className={`rounded-lg bg-muted/60 ${
        compact
          ? 'inline-flex items-center gap-[2px] p-[3px]'
          : 'inline-flex w-auto items-center gap-[2px] p-[3px]'
      }`}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = isTabActive(tab.id);
        const isBusyRenderTab = tab.id === 'chat' && isRenderingSnapshot;
        const label = isBusyRenderTab ? t('tabs.rendering') : t(tab.labelKey);

        return (
          <Tooltip key={tab.id} content={label} position="bottom">
            <button
              onClick={() => handleTabClick(tab.id)}
              className={`relative flex h-9 w-9 flex-none touch-manipulation items-center justify-center rounded-md p-0 transition-all duration-150 ${
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label={label}
              aria-pressed={isActive}
              aria-busy={isBusyRenderTab}
              title={label}
              data-testid={`tab-${tab.id}`}
              disabled={isBusyRenderTab}
            >
              {isBusyRenderTab ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" aria-hidden="true" />
              ) : (
                <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
