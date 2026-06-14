/**
 * PURPOSE: Orchestrate file-tree browsing, workspace mutation actions, upload
 * flows, context menus, and inline feedback for the selected project.
 */
import type { ChangeEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import ImageViewer from './ImageViewer';
import { ICON_SIZE_CLASS, getFileIconData } from '../constants/fileIcons';
import { useExpandedDirectories } from '../hooks/useExpandedDirectories';
import { useFileTreeData } from '../hooks/useFileTreeData';
import { useFileTreeOperations } from '../hooks/useFileTreeOperations';
import { useFileTreeSearch } from '../hooks/useFileTreeSearch';
import { useFileTreeViewMode } from '../hooks/useFileTreeViewMode';
import type { FileTreeContextMenuAction, FileTreeImageSelection, FileTreeNode } from '../types/types';
import { formatFileSize, formatRelativeTime, isImageFile } from '../utils/fileTreeUtils';
import FileTreeBody from './FileTreeBody';
import FileTreeContextMenu from './FileTreeContextMenu';
import FileTreeDetailedColumns from './FileTreeDetailedColumns';
import FileTreeHeader from './FileTreeHeader';
import FileTreeLoadingState from './FileTreeLoadingState';
import { Project } from '../../../types/app';

type FileTreeProps =  {
  selectedProject: Project | null;
  onFileOpen?: (filePath: string) => void;
  revealDirectoryRequest?: { path: string; requestId: number } | null;
  showHeaderTitle?: boolean;
  showViewControls?: boolean;
}

function findTreeNodeByPath(nodes: FileTreeNode[], targetPath: string): FileTreeNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node;
    }

    if (Array.isArray(node.children)) {
      const foundChild = findTreeNodeByPath(node.children, targetPath);
      if (foundChild) {
        return foundChild;
      }
    }
  }

  return null;
}

export default function FileTree({
  selectedProject,
  onFileOpen,
  revealDirectoryRequest,
  showHeaderTitle = false,
  showViewControls = true,
}: FileTreeProps) {
  const { t } = useTranslation();
  const [selectedImage, setSelectedImage] = useState<FileTreeImageSelection | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    actions: FileTreeContextMenuAction[];
    position: { x: number; y: number };
  } | null>(null);
  const fileUploadInputRef = useRef<HTMLInputElement | null>(null);

  const {
    files,
    loading,
    refreshFiles,
    loadDirectoryChildren,
  } = useFileTreeData(selectedProject);
  const { viewMode, changeViewMode } = useFileTreeViewMode();
  const { expandedDirs, toggleDirectory, expandDirectories, collapseAllDirectories } = useExpandedDirectories();
  const { searchQuery, setSearchQuery, filteredFiles } = useFileTreeSearch({
    files,
    expandDirectories,
  });
  const {
    busy,
    feedback,
    clearFeedback,
    renameEntry,
    deleteEntry,
    copyEntryPath,
    downloadEntry,
    uploadEntries,
  } = useFileTreeOperations({
    selectedProject,
    onRefresh: refreshFiles,
  });

  const renderFileIcon = useCallback((filename: string) => {
    const { icon: Icon, color } = getFileIconData(filename);
    return <Icon className={cn(ICON_SIZE_CLASS, color)} />;
  }, []);

  useEffect(() => {
    if (!revealDirectoryRequest || !selectedProject) {
      return;
    }

    const projectRoot = selectedProject.fullPath || selectedProject.path || '';
    const targetPath = revealDirectoryRequest.path;
    if (!projectRoot || !targetPath.startsWith(projectRoot)) {
      return;
    }

    const relativePath = targetPath
      .slice(projectRoot.length)
      .replace(/^[/\\]+/, '')
      .replace(/\\/g, '/');

    const segments = relativePath.split('/').filter(Boolean);
    if (segments.length === 0) {
      return;
    }

    const ancestorPaths = segments.map((_, index) => {
      const joined = segments.slice(0, index + 1).join('/');
      return `${projectRoot.replace(/[/\\]+$/, '')}/${joined}`;
    });

    const revealNextAncestor = async () => {
      for (const ancestorPath of ancestorPaths) {
        const node = findTreeNodeByPath(files, ancestorPath);
        if (!node) {
          return;
        }

        if (node.type === 'directory' && node.hasChildren !== false && !Array.isArray(node.children)) {
          await loadDirectoryChildren(ancestorPath);
          return;
        }
      }

      expandDirectories(ancestorPaths);
    };

    void revealNextAncestor();
  }, [
    expandDirectories,
    files,
    loadDirectoryChildren,
    revealDirectoryRequest,
    selectedProject,
  ]);

  /**
   * Keep rename confirmation near the action origin so users can correct mistakes before refresh.
   */
  const promptRenameEntry = useCallback(async (node: FileTreeNode) => {
    const nextName = window.prompt('Rename to', node.name);
    if (!nextName?.trim() || nextName.trim() === node.name) {
      return;
    }
    await renameEntry(node, nextName.trim());
  }, [renameEntry]);

  const confirmDeleteEntry = useCallback(async (node: FileTreeNode) => {
    const confirmed = window.confirm(`Delete ${node.name}?`);
    if (!confirmed) {
      return;
    }
    await deleteEntry(node);
  }, [deleteEntry]);

  const handleUploadFilesSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const targetPath = event.currentTarget.dataset.targetPath || '';
    const chosenFiles = event.currentTarget.files;
    if (chosenFiles) {
      await uploadEntries(targetPath, chosenFiles);
    }
    event.currentTarget.value = '';
    event.currentTarget.dataset.targetPath = '';
  }, [uploadEntries]);

  const openUploadPicker = useCallback((targetPath = '') => {
    if (!fileUploadInputRef.current) {
      return;
    }
    fileUploadInputRef.current.dataset.targetPath = targetPath;
    fileUploadInputRef.current.click();
  }, []);

  // Centralized click behavior keeps file actions identical across all presentation modes.
  const handleItemClick = useCallback(
    async (item: FileTreeNode) => {
      if (item.type === 'directory') {
        if (item.hasChildren) {
          await loadDirectoryChildren(item.path);
        }
        toggleDirectory(item.path);
        return;
      }

      if (isImageFile(item.name) && selectedProject) {
        setSelectedImage({
          name: item.name,
          path: item.path,
          projectPath: selectedProject.path,
          projectName: selectedProject.name,
        });
        return;
      }

      onFileOpen?.(item.path);
    },
    [loadDirectoryChildren, onFileOpen, selectedProject, toggleDirectory],
  );

  const openContextMenu = useCallback((event: { clientX: number; clientY: number }, actions: FileTreeContextMenuAction[]) => {
    setContextMenu({
      actions,
      position: { x: event.clientX, y: event.clientY },
    });
  }, []);

  const handleItemContextMenu = useCallback((node: FileTreeNode, event: ReactMouseEvent<HTMLDivElement>) => {
    const actions: FileTreeContextMenuAction[] = [];

    if (node.type === 'directory') {
      actions.push(
        { key: 'upload', label: 'Upload', onSelect: () => openUploadPicker(node.relativePath || node.path) },
      );
    }

    actions.push(
      { key: 'rename', label: 'Rename', onSelect: () => void promptRenameEntry(node) },
      { key: 'delete', label: 'Delete', onSelect: () => void confirmDeleteEntry(node) },
      { key: 'copy-path', label: 'Copy Path', onSelect: () => void copyEntryPath(node) },
      { key: 'download', label: 'Download', onSelect: () => void downloadEntry(node) },
    );

    openContextMenu(event, actions);
  }, [
    confirmDeleteEntry,
    copyEntryPath,
    downloadEntry,
    openContextMenu,
    openUploadPicker,
    promptRenameEntry,
  ]);

  const rootMenuActions = useMemo<FileTreeContextMenuAction[]>(() => ([
    { key: 'upload', label: 'Upload', onSelect: () => openUploadPicker('') },
    { key: 'refresh', label: 'Refresh', onSelect: refreshFiles },
  ]), [openUploadPicker, refreshFiles]);

  const handleBackgroundContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[role="menu"]')) {
      return;
    }
    event.preventDefault();
    openContextMenu(event, rootMenuActions);
  }, [openContextMenu, rootMenuActions]);

  const formatRelativeTimeLabel = useCallback(
    (date?: string) => formatRelativeTime(date, t),
    [t],
  );

  if (loading) {
    return <FileTreeLoadingState />;
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <FileTreeHeader
        viewMode={viewMode}
        onViewModeChange={changeViewMode}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onRefresh={refreshFiles}
        onCollapseAll={collapseAllDirectories}
        onUpload={() => openUploadPicker('')}
        showTitle={showHeaderTitle}
        showViewControls={showViewControls}
        disabled={busy}
      />

      {viewMode === 'detailed' && filteredFiles.length > 0 && <FileTreeDetailedColumns />}

      <FileTreeBody
        files={files}
        filteredFiles={filteredFiles}
        searchQuery={searchQuery}
        viewMode={viewMode}
        expandedDirs={expandedDirs}
        onItemClick={handleItemClick}
        renderFileIcon={renderFileIcon}
        formatFileSize={formatFileSize}
        formatRelativeTime={formatRelativeTimeLabel}
        feedback={feedback}
        onDismissFeedback={clearFeedback}
        onBackgroundContextMenu={handleBackgroundContextMenu}
        onItemContextMenu={handleItemContextMenu}
      />

      <input
        ref={fileUploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => void handleUploadFilesSelected(event)}
      />

      {selectedImage && (
        <ImageViewer
          file={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}

      {contextMenu && (
        <FileTreeContextMenu
          actions={contextMenu.actions}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
