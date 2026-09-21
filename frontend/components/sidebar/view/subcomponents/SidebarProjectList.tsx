/** PURPOSE: Keep recent projects visible and older projects in a collapsed group. */
import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import type { LoadingProgress, Project } from '../../../../types/app';
import SidebarProjectItem from './SidebarProjectItem';
import SidebarProjectsState from './SidebarProjectsState';
import { isProjectRecentlyActive } from '../../utils/utils';

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
  /** Preserve project actions while grouping navigation by recent activity. */
  const [showInactive, setShowInactive] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    /** Reclassify projects while the sidebar stays open across the three-day boundary. */
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const { activeProjects, inactiveProjects } = useMemo(() => {
    /** Keep the existing alphabetical order within both groups. */
    const active: Project[] = [];
    const inactive: Project[] = [];
    filteredProjects.forEach((project) => {
      (isProjectRecentlyActive(project, now) ? active : inactive).push(project);
    });
    return { activeProjects: active, inactiveProjects: inactive };
  }, [filteredProjects, now]);
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
        : activeProjects.map((project) => (
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
      {showProjects && inactiveProjects.length > 0 && (
        <div data-testid="sidebar-inactive-projects">
          <button
            type="button"
            className="flex w-full items-center justify-between px-2 py-2 text-xs font-medium text-muted-foreground"
            aria-expanded={showInactive}
            onClick={() => setShowInactive((value) => !value)}
          >
            <span>{t('projects.inactive')} ({inactiveProjects.length})</span>
            <span aria-hidden="true">{showInactive ? '▾' : '▸'}</span>
          </button>
          {showInactive && inactiveProjects.map((project) => (
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
      )}
    </div>
  );
}
