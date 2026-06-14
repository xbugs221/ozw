import type { ComponentType } from 'react';

/**
 * PURPOSE: Shared types for file-tree rendering, operations, and feedback state.
 */
export type FileTreeViewMode = 'simple' | 'compact' | 'detailed';

export type FileTreeItemType = 'file' | 'directory';

export interface FileTreeNode {
  name: string;
  type: FileTreeItemType;
  path: string;
  relativePath?: string;
  hasChildren?: boolean;
  size?: number;
  modified?: string;
  permissionsRwx?: string;
  children?: FileTreeNode[];
  [key: string]: unknown;
}

export interface FileTreeImageSelection {
  name: string;
  path: string;
  projectPath?: string;
  projectName: string;
}

export interface FileIconData {
  icon: ComponentType<{ className?: string }>;
  color: string;
}

export type FileIconMap = Record<string, FileIconData>;

export interface FileTreeMutationResponse {
  success: true;
  path: string;
  relativePath: string;
  type: FileTreeItemType;
  message: string;
}

export interface FileTreeUploadResponse {
  success: true;
  uploadedCount: number;
  message: string;
}

export interface FileTreeFeedbackState {
  kind: 'success' | 'error';
  message: string;
}

export interface FileTreeContextMenuAction {
  key: string;
  label: string;
  onSelect: () => void;
}
