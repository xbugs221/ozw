/**
 * PURPOSE: Convert project file API trees into searchable and expandable file mention data.
 */
import type { MentionableFile } from './fileMentionSearch';

export interface ProjectFileNode {
  name: string;
  type: 'file' | 'directory';
  path?: string;
  children?: ProjectFileNode[];
}

export interface FileTreeItem extends ProjectFileNode {
  fullPath: string;
  children?: FileTreeItem[];
}

/**
 * Flatten the API tree so the composer can search files by display path without exposing directories as references.
 */
export const flattenFileTree = (files: ProjectFileNode[], basePath = ''): MentionableFile[] => {
  let flattened: MentionableFile[] = [];

  files.forEach((file) => {
    const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
    if (file.type === 'directory' && file.children) {
      flattened = flattened.concat(flattenFileTree(file.children, fullPath));
      return;
    }

    if (file.type === 'file') {
      flattened.push({
        name: file.name,
        path: fullPath,
        relativePath: file.path,
      });
    }
  });

  return flattened;
};

/**
 * Preserve relative paths on tree nodes so the picker can expand directories and select files.
 */
export const buildFileTree = (files: ProjectFileNode[], basePath = ''): FileTreeItem[] => files
  .map((file) => {
    const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
    return {
      ...file,
      fullPath,
      children: file.children ? buildFileTree(file.children, fullPath) : undefined,
    };
  })
  .sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
