/**
 * PURPOSE: Recursively render file-tree rows while forwarding click and
 * context-menu events to the shared operation layer.
 */
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { FileTreeNode as FileTreeNodeType, FileTreeViewMode } from '../types/types';
import FileTreeNode from './FileTreeNode';

type FileTreeListProps = {
  items: FileTreeNodeType[];
  viewMode: FileTreeViewMode;
  expandedDirs: Set<string>;
  onItemClick: (item: FileTreeNodeType) => void;
  onItemContextMenu: (item: FileTreeNodeType, event: ReactMouseEvent<HTMLDivElement>) => void;
  renderFileIcon: (filename: string) => ReactNode;
  formatFileSize: (bytes?: number) => string;
  formatRelativeTime: (date?: string) => string;
};

export default function FileTreeList({
  items,
  viewMode,
  expandedDirs,
  onItemClick,
  onItemContextMenu,
  renderFileIcon,
  formatFileSize,
  formatRelativeTime,
}: FileTreeListProps) {
  return (
    <div>
      {items.map((item) => (
        <FileTreeNode
          key={item.path}
          item={item}
          level={0}
          viewMode={viewMode}
          expandedDirs={expandedDirs}
          onItemClick={onItemClick}
          onItemContextMenu={onItemContextMenu}
          renderFileIcon={renderFileIcon}
          formatFileSize={formatFileSize}
          formatRelativeTime={formatRelativeTime}
        />
      ))}
    </div>
  );
}
