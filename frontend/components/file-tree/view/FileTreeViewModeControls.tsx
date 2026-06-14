/**
 * PURPOSE: Render the file-tree desktop view-mode switcher for simple,
 * compact, and detailed file presentations.
 */
const Eye = ({ className: cls }: { className?: string }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const List = ({ className: cls }: { className?: string }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>;
const TableProperties = ({ className: cls }: { className?: string }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M12 3v18"/></svg>;
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { useFileTreeViewMode } from '../hooks/useFileTreeViewMode';
import type { FileTreeViewMode } from '../types/types';

type FileTreeViewModeControlsProps = {
  viewMode: FileTreeViewMode;
  onViewModeChange: (mode: FileTreeViewMode) => void;
};

/**
 * Render controlled view-mode buttons so header and dock callers share one UI.
 */
export function FileTreeViewModeControls({
  viewMode,
  onViewModeChange,
}: FileTreeViewModeControlsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex gap-0.5">
      <Button
        variant={viewMode === 'simple' ? 'default' : 'ghost'}
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onViewModeChange('simple')}
        title={t('fileTree.simpleView')}
      >
        <List className="w-3.5 h-3.5" />
      </Button>
      <Button
        variant={viewMode === 'compact' ? 'default' : 'ghost'}
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onViewModeChange('compact')}
        title={t('fileTree.compactView')}
      >
        <Eye className="w-3.5 h-3.5" />
      </Button>
      <Button
        variant={viewMode === 'detailed' ? 'default' : 'ghost'}
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onViewModeChange('detailed')}
        title={t('fileTree.detailedView')}
      >
        <TableProperties className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

/**
 * Bind dock-level controls to the persisted file-tree view-mode state.
 */
export function FileTreeDockViewModeControls() {
  const { viewMode, changeViewMode } = useFileTreeViewMode();

  return (
    <FileTreeViewModeControls
      viewMode={viewMode}
      onViewModeChange={changeViewMode}
    />
  );
}
