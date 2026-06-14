const Folder = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
const Search = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
import type { TFunction } from 'i18next';
import type { LoadingProgress } from '../../../../types/app';

type SidebarProjectsStateProps = {
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  projectsCount: number;
  filteredProjectsCount: number;
  t: TFunction;
};

export default function SidebarProjectsState({
  isLoading,
  loadingProgress,
  projectsCount,
  filteredProjectsCount,
  t,
}: SidebarProjectsStateProps) {
  if (isLoading) {
    return (
      <div className="text-center py-12 md:py-8 px-4">
        <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4 md:mb-3">
          <div className="w-6 h-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
        <h3 className="text-base font-medium text-foreground mb-2 md:mb-1">{t('projects.loadingProjects')}</h3>
        {loadingProgress && loadingProgress.total > 0 ? (
          <div className="space-y-2">
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300 ease-out"
                style={{ width: `${(loadingProgress.current / loadingProgress.total) * 100}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {loadingProgress.current}/{loadingProgress.total} {t('projects.projects')}
            </p>
            {loadingProgress.currentProject && (
              <p
                className="text-xs text-muted-foreground/70 truncate max-w-[200px] mx-auto"
                title={loadingProgress.currentProject}
              >
                {loadingProgress.currentProject.split('-').slice(-2).join('/')}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('projects.fetchingProjects')}</p>
        )}
      </div>
    );
  }

  if (projectsCount === 0) {
    return (
      <div className="text-center py-12 md:py-8 px-4">
        <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4 md:mb-3">
          <Folder className="w-6 h-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-medium text-foreground mb-2 md:mb-1">{t('projects.noProjects')}</h3>
        <p className="text-sm text-muted-foreground">{t('projects.runAgentCli')}</p>
      </div>
    );
  }

  if (filteredProjectsCount === 0) {
    return (
      <div className="text-center py-12 md:py-8 px-4">
        <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4 md:mb-3">
          <Search className="w-6 h-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-medium text-foreground mb-2 md:mb-1">{t('projects.noMatchingProjects')}</h3>
        <p className="text-sm text-muted-foreground">{t('projects.tryDifferentSearch')}</p>
      </div>
    );
  }

  return null;
}
