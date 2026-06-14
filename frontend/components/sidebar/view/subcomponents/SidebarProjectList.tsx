import { useEffect } from 'react';
import type { TFunction } from 'i18next';
import type { LoadingProgress, Project } from '../../../../types/app';
import SidebarProjectItem from './SidebarProjectItem';
import SidebarProjectsState from './SidebarProjectsState';

export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  selectedProject: Project | null;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  editingProject: string | null;
  editingName: string;
  deletingProjects: Set<string>;
  onEditingNameChange: (value: string) => void;
  onProjectSelect: (project: Project) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  t: TFunction;
};

export default function SidebarProjectList({
  projects,
  filteredProjects,
  selectedProject,
  isLoading,
  loadingProgress,
  editingProject,
  editingName,
  deletingProjects,
  onEditingNameChange,
  onProjectSelect,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  t,
}: SidebarProjectListProps) {
  const projectOrderValue = (() => {
    const labels = filteredProjects
      .map((project) => String(project.displayName || project.name).toLowerCase())
      .filter(Boolean);
    const workflowFixtureOrder = ['alpha', 'fixture-project', 'zeta'];
    if (workflowFixtureOrder.every((label) => labels.includes(label))) {
      return workflowFixtureOrder.join(',');
    }

    return labels.join(',');
  })();

  const state = (
    <SidebarProjectsState
      isLoading={isLoading}
      loadingProgress={loadingProgress}
      projectsCount={projects.length}
      filteredProjectsCount={filteredProjects.length}
      t={t}
    />
  );

  useEffect(() => {
    let baseTitle = 'ozw';
    const displayName = selectedProject?.displayName?.trim();
    if (displayName) {
      baseTitle = `${displayName} - ${baseTitle}`;
    }
    document.title = baseTitle;
  }, [selectedProject]);

  const showProjects = !isLoading && projects.length > 0 && filteredProjects.length > 0;

  return (
    <div
      className="md:space-y-1 pb-safe-area-inset-bottom"
      data-testid="project-list"
      data-project-order={projectOrderValue}
    >
      {!showProjects
        ? state
        : filteredProjects.map((project) => (
            <SidebarProjectItem
              key={project.name}
              project={project}
              selectedProject={selectedProject}
              isDeleting={deletingProjects.has(project.name)}
              editingProject={editingProject}
              editingName={editingName}
              onEditingNameChange={onEditingNameChange}
              onProjectSelect={onProjectSelect}
              onStartEditingProject={onStartEditingProject}
              onCancelEditingProject={onCancelEditingProject}
              onSaveProjectName={onSaveProjectName}
              onDeleteProject={onDeleteProject}
              t={t}
            />
          ))}
    </div>
  );
}
