import MobileMenuButton from './MobileMenuButton';
import MainContentTabSwitcher from './MainContentTabSwitcher';
import MainContentTitle from './MainContentTitle';
import type { MainContentHeaderProps } from '../../types/types';

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  selectedWorkflow,
  isMobile,
  isSidebarOpen,
  onMenuClick,
  leadingContent,
  dockLayout,
}: MainContentHeaderProps) {
  const showMenuButton = !isSidebarOpen;

  return (
    <div className="sticky top-0 z-30 flex-shrink-0 border-b border-border/60 bg-background/95 px-3 py-1.5 backdrop-blur-sm pwa-header-safe sm:px-4 sm:py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {showMenuButton && <MobileMenuButton onMenuClick={onMenuClick} />}
          {!isMobile && leadingContent && (
            <div className="flex-shrink-0">
              {leadingContent}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <MainContentTitle
              activeTab={activeTab}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              selectedWorkflow={selectedWorkflow}
            />
          </div>
        </div>

        <div className="flex-shrink-0">
          <MainContentTabSwitcher
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            compact={isMobile}
            dockLayout={dockLayout}
          />
        </div>
      </div>
    </div>
  );
}
