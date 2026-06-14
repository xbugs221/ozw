/**
 * PURPOSE: Render the full project sidebar, including header controls,
 * scrollable project navigation, and desktop resize affordance.
 */
import { ScrollArea } from '../../../ui/scroll-area';
import type { TFunction } from 'i18next';
import type { Project } from '../../../../types/app';
import SidebarHeader from './SidebarHeader';
import SidebarFooter from './SidebarFooter';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projects: Project[];
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  onShowSettings: () => void;
  onOpenChatHistorySearch: () => void;
  projectListProps: SidebarProjectListProps;
  t: TFunction;
};

export default function SidebarContent({
  isPWA,
  isMobile,
  isLoading,
  projects,
  onCreateProject,
  onCollapseSidebar,
  onShowSettings,
  onOpenChatHistorySearch,
  projectListProps,
  t,
}: SidebarContentProps) {
  /**
   * PURPOSE: Let project navigation size itself without enforcing a fixed
   * minimum width; project rows still own their text truncation behavior.
   */

  return (
    <div
      className="relative flex h-full w-max max-w-[min(80vw,32rem)] flex-col bg-background/80 backdrop-blur-sm md:max-w-[min(45vw,32rem)] md:select-none"
    >
      <SidebarHeader
        isPWA={isPWA}
        isMobile={isMobile}
        onCollapseSidebar={onCollapseSidebar}
        t={t}
      />

      <ScrollArea className="flex-1 md:px-1.5 md:py-2 overflow-y-auto overscroll-contain">
        <SidebarProjectList {...projectListProps} />
      </ScrollArea>
      <SidebarFooter
        onCreateProject={onCreateProject}
        onShowSettings={onShowSettings}
        onOpenChatHistorySearch={onOpenChatHistorySearch}
        t={t}
      />
    </div>
  );
}
