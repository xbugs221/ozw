/**
 * PURPOSE: Render one sidebar project card that opens the project overview and
 * keeps project-level rename/delete actions available.
 */
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Button } from '../../../ui/button';
const Check = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>;
const Edit3 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>;
const Trash2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
const X = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import { getMobileProjectLabel } from '../../utils/projectLabel';

const PROJECT_ACTION_LONG_PRESS_MS = 450;

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  isDeleting: boolean;
  editingProject: string | null;
  editingName: string;
  onEditingNameChange: (name: string) => void;
  onProjectSelect: (project: Project) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  t: TFunction;
};

export default function SidebarProjectItem({
  project,
  selectedProject,
  isDeleting,
  editingProject,
  editingName,
  onEditingNameChange,
  onProjectSelect,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  t,
}: SidebarProjectItemProps) {
  const readOnlyProviderCollection = project.readOnlyProviderCollection === true;
  const isSelected = selectedProject?.name === project.name;
  const isEditing = !readOnlyProviderCollection && editingProject === project.name;
  const hasProjectActivity = project.hasUnreadActivity === true;
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);
  const [projectActionMenu, setProjectActionMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
  });
  const fullProjectLabel = String(project.displayName || project.name);
  const mobileProjectLabel = getMobileProjectLabel(fullProjectLabel);
  const normalizedProjectLabel = fullProjectLabel.toLowerCase().trim();
  const projectTestId = `project-list-item-${normalizedProjectLabel
    .replace(/^\./, 'dot-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;

  const saveProjectName = () => {
    if (readOnlyProviderCollection) {
      return;
    }
    onSaveProjectName(project.name);
  };

  const selectProject = () => {
    onProjectSelect(project);
  };

  /**
   * Dismiss the contextual action menu when focus moves away.
   */
  useEffect(() => {
    if (!projectActionMenu.isOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (actionMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setProjectActionMenu((current) => (current.isOpen ? { ...current, isOpen: false } : current));
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProjectActionMenu((current) => (current.isOpen ? { ...current, isOpen: false } : current));
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    const handleScroll = () => {
      setProjectActionMenu((current) => (current.isOpen ? { ...current, isOpen: false } : current));
    };

    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [projectActionMenu.isOpen]);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  /**
   * Open the project action menu near the user's interaction point.
   */
  const openProjectActionMenu = (x: number, y: number) => {
    setProjectActionMenu({
      isOpen: true,
      x,
      y,
    });
  };

  const closeProjectActionMenu = () => {
    setProjectActionMenu((current) => (current.isOpen ? { ...current, isOpen: false } : current));
  };

  const handleStartEditingProject = () => {
    closeProjectActionMenu();
    if (readOnlyProviderCollection) {
      return;
    }
    onStartEditingProject(project);
  };

  const handleDeleteProject = () => {
    closeProjectActionMenu();
    if (readOnlyProviderCollection) {
      return;
    }
    onDeleteProject(project);
  };

  /**
   * On desktop, project actions live behind the native right-click gesture.
   */
  const handleDesktopContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (
      readOnlyProviderCollection
      || (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openProjectActionMenu(event.clientX, event.clientY);
  };

  /**
   * On mobile, a long press reveals project actions without selecting the project.
   */
  const handleMobileTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (readOnlyProviderCollection || isEditing) {
      return;
    }

    const touch = event.touches[0];
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = touch?.clientX ?? bounds.left + bounds.width / 2;
    const y = touch?.clientY ?? bounds.top + bounds.height / 2;

    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      suppressNextClickRef.current = true;
      openProjectActionMenu(x, y);
      clearLongPressTimer();
    }, PROJECT_ACTION_LONG_PRESS_MS);
  };

  const handleMobileTouchEnd = () => {
    clearLongPressTimer();
  };

  const handleMobileProjectClick = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    selectProject();
  };

  return (
    <div
      className={cn('px-2 py-1', isDeleting && 'opacity-50 pointer-events-none')}
      data-testid={projectTestId}
    >
      <div className="group">
        <div className="md:hidden">
          <div
            className={cn(
              'rounded-md border bg-card px-2.5 py-2 shadow-sm transition-all duration-150 active:scale-[0.98]',
              'border-border/70 hover:border-foreground/20 hover:shadow-md',
              isSelected && 'border-primary/40 bg-primary/5 shadow-md ring-1 ring-primary/15',
              !isSelected && hasProjectActivity && 'border-emerald-500/35 bg-emerald-50/20 dark:bg-emerald-950/10',
            )}
            data-testid={`${projectTestId}-mobile-surface`}
            role="button"
            tabIndex={0}
            onClick={handleMobileProjectClick}
            onTouchStart={handleMobileTouchStart}
            onTouchEnd={handleMobileTouchEnd}
            onTouchCancel={handleMobileTouchEnd}
            onTouchMove={handleMobileTouchEnd}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleMobileProjectClick();
              }
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {isEditing && (
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      className="w-8 h-8 rounded-lg bg-green-500 dark:bg-green-600 flex items-center justify-center active:scale-90 transition-all duration-150 shadow-sm active:shadow-none"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveProjectName();
                      }}
                    >
                      <Check className="w-4 h-4 text-white" />
                    </button>
                    <button
                      className="w-8 h-8 rounded-lg bg-gray-500 dark:bg-gray-600 flex items-center justify-center active:scale-90 transition-all duration-150 shadow-sm active:shadow-none"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelEditingProject();
                      }}
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(event) => onEditingNameChange(event.target.value)}
                      className="w-full px-3 py-2 text-sm border-2 border-primary/40 focus:border-primary rounded-lg bg-background text-foreground shadow-sm focus:shadow-md transition-all duration-200 focus:outline-none"
                      placeholder={t('projects.projectNamePlaceholder')}
                      autoFocus
                      autoComplete="off"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          saveProjectName();
                        }

                        if (event.key === 'Escape') {
                          onCancelEditingProject();
                        }
                      }}
                      style={{
                        fontSize: '16px',
                        WebkitAppearance: 'none',
                        borderRadius: '8px',
                      }}
                    />
                  ) : (
                    <div className="flex min-w-0 items-center gap-2">
                      <h3 className="whitespace-nowrap text-sm font-medium leading-5 text-foreground">
                        {mobileProjectLabel}
                      </h3>
                      {project.hasUnreadActivity && (
                        <span
                          className="inline-flex h-2 w-2 flex-shrink-0 rounded-full bg-green-500"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          className={cn(
            'hidden h-10 w-full justify-start gap-2 rounded-md border bg-card px-2.5 py-0 text-left font-normal shadow-sm transition-all duration-150 md:flex',
            'border-border/70 hover:border-foreground/20 hover:bg-card hover:shadow-md',
            isSelected && 'border-primary/40 bg-primary/5 text-accent-foreground shadow-md ring-1 ring-primary/15',
            !isSelected && hasProjectActivity && 'border-emerald-500/35 bg-emerald-50/20 dark:bg-emerald-950/10',
          )}
          onClick={selectProject}
          onContextMenu={handleDesktopContextMenu}
          data-testid={`${projectTestId}-desktop-surface`}
        >
          {isEditing && (
            <div className="flex flex-shrink-0 items-center gap-2">
              <div
                className="w-6 h-6 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20 flex items-center justify-center rounded cursor-pointer transition-colors"
                onClick={(event) => {
                  event.stopPropagation();
                  saveProjectName();
                }}
              >
                <Check className="w-3 h-3" />
              </div>
              <div
                className="w-6 h-6 text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-center rounded cursor-pointer transition-colors"
                onClick={(event) => {
                  event.stopPropagation();
                  onCancelEditingProject();
                }}
              >
                <X className="w-3 h-3" />
              </div>
            </div>
          )}

          <div className="min-w-0 flex-1 text-left leading-none">
            {isEditing ? (
              <div className="space-y-1">
                <input
                  type="text"
                  value={editingName}
                  onChange={(event) => onEditingNameChange(event.target.value)}
                  className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:ring-2 focus:ring-primary/20"
                  placeholder={t('projects.projectNamePlaceholder')}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      saveProjectName();
                    }
                    if (event.key === 'Escape') {
                      onCancelEditingProject();
                    }
                  }}
                />
              </div>
            ) : (
              <div className="min-w-0" title={fullProjectLabel}>
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium leading-5 text-foreground">
                  <span>{fullProjectLabel}</span>
                  {project.hasUnreadActivity && (
                    <span
                      data-testid={`${projectTestId}-unread-dot`}
                      className="inline-flex h-2 w-2 flex-shrink-0 rounded-full bg-green-500"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </Button>

        {projectActionMenu.isOpen && !isEditing && !readOnlyProviderCollection && (
          <div
            ref={actionMenuRef}
            className="fixed z-[80] min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-lg"
            style={{ left: projectActionMenu.x, top: projectActionMenu.y }}
            data-testid={`${projectTestId}-context-menu`}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={handleStartEditingProject}
              data-testid={`${projectTestId}-rename-action`}
            >
              <Edit3 className="h-4 w-4" />
              {t('actions.rename')}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              onClick={handleDeleteProject}
              data-testid={`${projectTestId}-delete-action`}
            >
              <Trash2 className="h-4 w-4" />
              {t('actions.delete')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
