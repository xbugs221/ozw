/**
 * PURPOSE: Render the file-tree search field, view toggles, and root-scoped
 * toolbar actions for mutation workflows.
 */
const ChevronUpSquare = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 14 4-4 4 4"/></svg>;
const RefreshCw = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
const Search = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const Upload = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
const X = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import type { FileTreeViewMode } from '../types/types';
import { FileTreeViewModeControls } from './FileTreeViewModeControls';

type FileTreeHeaderProps = {
  viewMode: FileTreeViewMode;
  onViewModeChange: (mode: FileTreeViewMode) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onRefresh: () => void;
  onCollapseAll: () => void;
  onUpload: () => void;
  showTitle?: boolean;
  showViewControls?: boolean;
  disabled?: boolean;
};

export default function FileTreeHeader({
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchQueryChange,
  onRefresh,
  onCollapseAll,
  onUpload,
  showTitle = false,
  showViewControls = true,
  disabled = false,
}: FileTreeHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="px-3 pt-3 pb-2 border-b border-border space-y-2">
      <div className="flex items-center justify-between">
        {showTitle ? (
          <h3 className="text-sm font-medium text-foreground">{t('fileTree.files')}</h3>
        ) : (
          <span className="sr-only">{t('fileTree.files')}</span>
        )}
        {showViewControls && (
          <FileTreeViewModeControls
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={onUpload} disabled={disabled}>
          <Upload className="mr-1 h-3.5 w-3.5" />
          Upload
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={onRefresh} disabled={disabled}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          Reload
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={onCollapseAll} disabled={disabled}>
          <ChevronUpSquare className="mr-1 h-3.5 w-3.5" />
          Collapse All
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          type="text"
          placeholder={t('fileTree.searchPlaceholder')}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          className="pl-8 pr-8 h-8 text-sm"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0.5 top-1/2 -translate-y-1/2 h-5 w-5 p-0 hover:bg-accent"
            onClick={() => onSearchQueryChange('')}
            title={t('fileTree.clearSearch')}
          >
            <X className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
