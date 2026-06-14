/**
 * PURPOSE: Render file-tree content, empty states, and inline operation
 * feedback while exposing blank-space context-menu handling.
 */
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
const Folder = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
const Search = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '../../ui/scroll-area';
import type { FileTreeFeedbackState, FileTreeNode, FileTreeViewMode } from '../types/types';
import FileTreeEmptyState from './FileTreeEmptyState';
import FileTreeList from './FileTreeList';

type FileTreeBodyProps = {
  files: FileTreeNode[];
  filteredFiles: FileTreeNode[];
  searchQuery: string;
  viewMode: FileTreeViewMode;
  expandedDirs: Set<string>;
  onItemClick: (item: FileTreeNode) => void;
  renderFileIcon: (filename: string) => ReactNode;
  formatFileSize: (bytes?: number) => string;
  formatRelativeTime: (date?: string) => string;
  feedback: FileTreeFeedbackState | null;
  onDismissFeedback: () => void;
  onBackgroundContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onItemContextMenu: (item: FileTreeNode, event: ReactMouseEvent<HTMLDivElement>) => void;
};

export default function FileTreeBody({
  files,
  filteredFiles,
  searchQuery,
  viewMode,
  expandedDirs,
  onItemClick,
  renderFileIcon,
  formatFileSize,
  formatRelativeTime,
  feedback,
  onDismissFeedback,
  onBackgroundContextMenu,
  onItemContextMenu,
}: FileTreeBodyProps) {
  const { t } = useTranslation();

  return (
    <ScrollArea className="flex-1 px-2 py-1">
      <div className="space-y-2 pb-2" onContextMenu={onBackgroundContextMenu}>
        {feedback && (
          <div className={`flex items-center justify-between rounded border px-2 py-1 text-sm ${
            feedback.kind === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}>
            <span>{feedback.message}</span>
            <button type="button" className="text-xs underline underline-offset-2" onClick={onDismissFeedback}>
              Dismiss
            </button>
          </div>
        )}

        {files.length === 0 ? (
        <FileTreeEmptyState
          icon={Folder}
          title={t('fileTree.noFilesFound')}
          description={t('fileTree.checkProjectPath')}
        />
      ) : filteredFiles.length === 0 && searchQuery ? (
        <FileTreeEmptyState
          icon={Search}
          title={t('fileTree.noMatchesFound')}
          description={t('fileTree.tryDifferentSearch')}
        />
      ) : (
        <FileTreeList
          items={filteredFiles}
          viewMode={viewMode}
          expandedDirs={expandedDirs}
          onItemClick={onItemClick}
          onItemContextMenu={onItemContextMenu}
          renderFileIcon={renderFileIcon}
          formatFileSize={formatFileSize}
          formatRelativeTime={formatRelativeTime}
        />
        )}
      </div>
    </ScrollArea>
  );
}
