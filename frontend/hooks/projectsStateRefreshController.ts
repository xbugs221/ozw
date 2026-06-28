/**
 * PURPOSE: Coordinate project list refreshes and selected sidebar entity reconciliation.
 */
import type { Project, ProjectSession, ProjectWorkflow, SessionProvider } from '../types/app';
import { getProjectSessions, withSessionProjectMetadata } from './projects/projectSessionCollections';
import { findRefreshedSelectedSession, isInterruptedFetch, mergeProjectSummaries, projectsHaveChanges, serialize } from './projects/projectRefreshReducer';

type SidebarRefreshArgs = {
  fetchProjectOverview: (project: Project) => Promise<Project | null>;
  projects: Project[];
  requestCoordinatedProjectRefresh: (invalidation: Record<string, unknown>) => Promise<Project[] | null>;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  selectedWorkflow: ProjectWorkflow | null;
  setProjects: (updater: (previous: Project[]) => Project[]) => void;
  setSelectedProject: (project: Project) => void;
  setSelectedSession: (session: ProjectSession) => void;
  setSelectedWorkflow: (workflow: ProjectWorkflow | null) => void;
};

export async function refreshSidebarSelection({
  fetchProjectOverview,
  projects,
  requestCoordinatedProjectRefresh,
  selectedProject,
  selectedSession,
  selectedWorkflow,
  setProjects,
  setSelectedProject,
  setSelectedSession,
  setSelectedWorkflow,
}: SidebarRefreshArgs): Promise<void> {
  /** Refresh project snapshots and rebind the current project, workflow, or session. */
  try {
    const freshProjects = await requestCoordinatedProjectRefresh({
      type: 'project_list_invalidated',
      scope: 'projects:list',
      reason: 'manual-sidebar-refresh',
      version: String(Date.now()),
    }) || projects;
    const mergedFreshProjects = mergeProjectSummaries(projects, freshProjects);
    setProjects((prevProjects) => {
      const nextProjects = mergeProjectSummaries(prevProjects, freshProjects);
      return projectsHaveChanges(prevProjects, nextProjects, true) ? nextProjects : prevProjects;
    });
    if (!selectedProject) return;
    const refreshedProject = mergedFreshProjects.find((project) => project.name === selectedProject.name);
    if (!refreshedProject) return;
    if (serialize(refreshedProject) !== serialize(selectedProject)) setSelectedProject(refreshedProject);
    if (!selectedSession) {
      if (selectedWorkflow) {
        const overview = await fetchProjectOverview(refreshedProject);
        const workflowSource = overview || refreshedProject;
        const refreshedWorkflow = workflowSource.workflows?.find((workflow) => workflow.id === selectedWorkflow.id) || null;
        if (serialize(refreshedWorkflow) !== serialize(selectedWorkflow)) setSelectedWorkflow(refreshedWorkflow);
      }
      return;
    }
    const refreshedSession = findRefreshedSelectedSession(refreshedProject, selectedSession, getProjectSessions);
    if (!refreshedSession) return;
    const normalizedRefreshedSession = withSessionProjectMetadata(
      refreshedSession,
      refreshedProject,
      (selectedSession.__provider || 'codex') as SessionProvider,
    );
    if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
      setSelectedSession(normalizedRefreshedSession);
    }
  } catch (error) {
    if (isInterruptedFetch(error)) {
      console.warn('Sidebar refresh was interrupted:', error);
    } else {
      console.error('Error refreshing sidebar:', error);
    }
  }
}
