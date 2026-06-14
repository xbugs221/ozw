import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useVersionCheck } from '../../../hooks/useVersionCheck';
import { useSidebarController } from '../hooks/useSidebarController';
import SidebarContent from './subcomponents/SidebarContent';
import SidebarModals from './subcomponents/SidebarModals';
import type { SidebarProjectListProps } from './subcomponents/SidebarProjectList';
import type { SidebarProps } from '../types/types';

function Sidebar({
  projects,
  selectedProject,
  onProjectSelect,
  onProjectDelete,
  isLoading,
  loadingProgress,
  onRefresh,
  onShowSettings,
  onCollapseSidebar,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  isMobile,
}: SidebarProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { currentVersion, installMode } = useVersionCheck();

  const {
    editingProject,
    showNewProject,
    editingName,
    deletingProjects,
    deleteConfirmation,
    showVersionModal,
    filteredProjects,
    startEditing,
    cancelEditing,
    saveProjectName,
    requestProjectDelete,
    confirmDeleteProject,
    handleProjectSelect,
    refreshProjects,
    setShowNewProject,
    setEditingName,
    setDeleteConfirmation,
    setShowVersionModal,
  } = useSidebarController({
    projects,
    selectedProject,
    isLoading,
    isMobile,
    t,
    onRefresh,
    onProjectSelect,
    onProjectDelete,
  });
  const handleRequestedCollapseSidebar = onCollapseSidebar || (() => {});

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);

  const handleProjectCreated = () => {
    /**
     * Project creation only needs to refresh the shared project read model.
     * Reloading the whole app can reset an unrelated open session.
     */
    if (window.refreshProjects) {
      void window.refreshProjects();
      return;
    }

    void refreshProjects();
  };

  const projectListProps: SidebarProjectListProps = {
    projects,
    filteredProjects,
    selectedProject,
    isLoading,
    loadingProgress,
    editingProject,
    editingName,
    deletingProjects,
    onEditingNameChange: setEditingName,
    onProjectSelect: handleProjectSelect,
    onStartEditingProject: startEditing,
    onCancelEditingProject: cancelEditing,
    onSaveProjectName: (projectName) => {
      void saveProjectName(projectName);
    },
    onDeleteProject: requestProjectDelete,
    t,
  };

  return (
    <>
      <SidebarModals
        projects={projects}
        showSettings={showSettings}
        settingsInitialTab={settingsInitialTab}
        onCloseSettings={onCloseSettings}
        showNewProject={showNewProject}
        onCloseNewProject={() => setShowNewProject(false)}
        onProjectCreated={handleProjectCreated}
        deleteConfirmation={deleteConfirmation}
        onCancelDeleteProject={() => setDeleteConfirmation(null)}
        onConfirmDeleteProject={confirmDeleteProject}
        showVersionModal={showVersionModal}
        onCloseVersionModal={() => setShowVersionModal(false)}
        currentVersion={currentVersion}
        installMode={installMode}
        t={t}
      />

      <SidebarContent
        isPWA={isPWA}
        isMobile={isMobile}
        isLoading={isLoading}
        projects={projects}
        onCreateProject={() => setShowNewProject(true)}
        onCollapseSidebar={handleRequestedCollapseSidebar}
        onShowSettings={onShowSettings}
        onOpenChatHistorySearch={() => window.openChatHistorySearch?.()}
        projectListProps={projectListProps}
        t={t}
      />

    </>
  );
}

export default Sidebar;
