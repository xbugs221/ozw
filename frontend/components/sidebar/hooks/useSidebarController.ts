/**
 * PURPOSE: Drive left-navigation project actions without owning session or workflow child lists.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type { TFunction } from 'i18next';
import { api } from '../../../utils/api';
import { OZW_SETTINGS_KEY } from '../../../utils/settingsStorage';
import type { Project } from '../../../types/app';
import type {
  DeleteProjectConfirmation,
  ProjectSortOrder,
} from '../types/types';
import {
  getAllSessions,
  readProjectSortOrder,
  sortProjects,
} from '../utils/utils';

type UseSidebarControllerArgs = {
  projects: Project[];
  selectedProject: Project | null;
  isLoading: boolean;
  isMobile: boolean;
  t: TFunction;
  onRefresh: () => Promise<void> | void;
  onProjectSelect: (project: Project) => void;
  onProjectDelete?: (projectName: string) => void;
  setCurrentProject?: (project: Project) => void;
};

export function useSidebarController({
  projects,
  selectedProject: _selectedProject,
  isLoading: _isLoading,
  isMobile: _isMobile,
  t,
  onRefresh,
  onProjectSelect,
  onProjectDelete,
  setCurrentProject,
}: UseSidebarControllerArgs) {
  /**
   * PURPOSE: Coordinate project navigation, project mutation, and left-nav shell state.
   */
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>('name');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deletingProjects, setDeletingProjects] = useState<Set<string>>(new Set());
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteProjectConfirmation | null>(null);
  const [showVersionModal, setShowVersionModal] = useState(false);

  useEffect(() => {
    const loadSortOrder = () => {
      setProjectSortOrder(readProjectSortOrder());
    };

    loadSortOrder();

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === OZW_SETTINGS_KEY) {
        loadSortOrder();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    const interval = setInterval(() => {
      if (document.hasFocus()) {
        loadSortOrder();
      }
    }, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  const handleTouchClick = useCallback(
    (callback: () => void) =>
      (event: React.TouchEvent<HTMLElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('.overflow-y-auto') || target.closest('[data-scroll-container]')) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        callback();
      },
    [],
  );

  /**
   * PURPOSE: Count every session tied to a project, including hidden ones,
   * so destructive actions stay aligned with backend delete rules.
   */
  const getProjectSessionCount = useCallback(
    (project: Project) => getAllSessions(project, {}).length,
    [],
  );

  const sortedProjects = useMemo(
    () => sortProjects(projects, projectSortOrder, {}),
    [projectSortOrder, projects],
  );

  const filteredProjects = sortedProjects;

  const startEditing = useCallback((project: Project) => {
    setEditingProject(project.name);
    setEditingName(project.displayName);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingProject(null);
    setEditingName('');
  }, []);

  const saveProjectName = useCallback(
    async (projectName: string) => {
      try {
        const matchedProject = projects.find((project) => project.name === projectName);
        const projectPath = matchedProject?.fullPath || matchedProject?.path || null;
        const response = await api.renameProject(projectName, editingName, projectPath);
        if (response.ok) {
          await onRefresh();
        } else {
          console.error('Failed to rename project');
        }
      } catch (error) {
        console.error('Error renaming project:', error);
      } finally {
        setEditingProject(null);
        setEditingName('');
      }
    },
    [editingName, onRefresh, projects],
  );

  const requestProjectDelete = useCallback(
    (project: Project) => {
      setDeleteConfirmation({
        project,
        sessionCount: getProjectSessionCount(project),
      });
    },
    [getProjectSessionCount],
  );

  const confirmDeleteProject = useCallback(async () => {
    if (!deleteConfirmation) {
      return;
    }

    const { project } = deleteConfirmation;

    setDeleteConfirmation(null);
    setDeletingProjects((prev) => new Set([...prev, project.name]));

    try {
      const response = await api.deleteProject(project.name, true, project.fullPath || project.path || '');

      if (response.ok) {
        onProjectDelete?.(project.name);
      } else {
        const error = (await response.json()) as { error?: string };
        alert(error.error || t('messages.deleteProjectFailed'));
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      alert(t('messages.deleteProjectError'));
    } finally {
      setDeletingProjects((prev) => {
        const next = new Set(prev);
        next.delete(project.name);
        return next;
      });
    }
  }, [deleteConfirmation, onProjectDelete, t]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      onProjectSelect(project);
      setCurrentProject?.(project);
    },
    [onProjectSelect, setCurrentProject],
  );

  const refreshProjects = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh]);

  return {
    editingProject,
    showNewProject,
    editingName,
    projectSortOrder,
    isRefreshing,
    deletingProjects,
    deleteConfirmation,
    showVersionModal,
    filteredProjects,
    handleTouchClick,
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
  };
}
