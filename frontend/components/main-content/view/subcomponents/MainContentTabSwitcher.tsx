/**
 * PURPOSE: Layout control buttons for the main workspace dock panels.
 * Renders icon-only controls that keep accessible names for dock tab actions.
 */
const MessageSquare = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
const Terminal = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="4,17 10,11 4,5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>;
const Folder = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
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
};

type TabDefinition = {
  id: AppTab;
  labelKey: string;
  icon: ({ className, strokeWidth }: { className?: string; strokeWidth?: number }) => JSX.Element;
};

const BASE_TABS: TabDefinition[] = [
  { id: 'chat', labelKey: 'tabs.chat', icon: MessageSquare },
  { id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { id: 'files', labelKey: 'tabs.files', icon: Folder },
];

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  compact = false,
  dockLayout,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();

  const tabs = BASE_TABS;

  const isTabActive = (tabId: AppTab): boolean => {
    /**
     * Desktop dock buttons are controls, not primary tab selections. Mobile
     * callers do not pass dockLayout, so they keep the single-view behavior.
     */
    if (tabId === 'chat') return activeTab === 'chat';
    if (tabId === 'preview') return activeTab === 'preview';

    if (dockLayout && (tabId === 'files' || tabId === 'shell')) {
      if (tabId === 'files') {
        return dockLayout.rightDockActive === tabId && !dockLayout.rightDockCollapsed;
      }

      return (
        (dockLayout.bottomDockActive === 'terminal' && !dockLayout.bottomDockCollapsed)
        || dockLayout.rightDockSplitBottom === 'terminal'
      );
    }

    return tabId === activeTab;
  };

  const handleTabClick = (tabId: AppTab) => {
    if (tabId === 'chat') {
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
        const label = t(tab.labelKey);

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
              title={label}
              data-testid={`tab-${tab.id}`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
