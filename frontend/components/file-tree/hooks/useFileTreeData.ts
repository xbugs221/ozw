/**
 * PURPOSE: Load and normalize file-tree data for a selected project, with a
 * refresh entrypoint for mutation workflows.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../utils/api';
import type { Project } from '../../../types/app';
import type { FileTreeNode } from '../types/types';

type UseFileTreeDataResult = {
  files: FileTreeNode[];
  loading: boolean;
  refreshFiles: () => void;
  loadDirectoryChildren: (directoryPath: string) => Promise<void>;
};

/**
 * Add stable relative paths so copy/download actions do not need to infer them repeatedly.
 */
function attachRelativePaths(nodes: FileTreeNode[], projectRoot: string): FileTreeNode[] {
  return nodes.map((node) => {
    const relativePath = node.path.startsWith(projectRoot)
      ? node.path.slice(projectRoot.length).replace(/^[/\\]+/, '').replace(/\\/g, '/')
      : (node.relativePath || '').replace(/\\/g, '/');

    return {
      ...node,
      relativePath,
      children: Array.isArray(node.children) ? attachRelativePaths(node.children, projectRoot) : node.children,
    };
  });
}

/**
 * Treat an explicit children array as a loaded branch, even when it is empty.
 */
function hasLoadedChildren(node: FileTreeNode): boolean {
  return Array.isArray(node.children);
}

/**
 * Merge a child list into a known directory node while keeping existing
 * object identity for other branches.
 */
function attachChildrenToPath(
  nodes: FileTreeNode[],
  targetPath: string,
  children: FileTreeNode[],
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path !== targetPath || node.type !== 'directory') {
      if (!node.children) {
        return node;
      }

      return {
        ...node,
        children: attachChildrenToPath(node.children, targetPath, children),
      };
    }

    return {
      ...node,
      children,
    };
  });
}

function findNodeByPath(nodes: FileTreeNode[], targetPath: string): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node;
    }

    if (node.children) {
      const found = findNodeByPath(node.children, targetPath);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

export function useFileTreeData(selectedProject: Project | null): UseFileTreeDataResult {
  const [files, setFiles] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const projectName = selectedProject?.name;
    const projectPath = selectedProject?.fullPath || selectedProject?.path || '';

    if (!projectName) {
      setFiles([]);
      setLoading(false);
      return;
    }

    const abortController = new AbortController();
    // Track mount state so aborted or late responses do not enqueue stale state updates.
    let isActive = true;

    const fetchFiles = async () => {
      if (isActive) {
        setLoading(true);
      }
      try {
        const response = await api.getFiles(projectName, {
          depth: 0,
          projectPath,
          signal: abortController.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('File fetch failed:', response.status, errorText);
          if (isActive) {
            setFiles([]);
          }
          return;
        }

        const data = (await response.json()) as FileTreeNode[];
        if (isActive) {
          setFiles(projectPath ? attachRelativePaths(data, projectPath) : data);
        }
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') {
          return;
        }

        console.error('Error fetching files:', error);
        if (isActive) {
          setFiles([]);
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void fetchFiles();

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [refreshKey, selectedProject?.fullPath, selectedProject?.name, selectedProject?.path]);

  const loadDirectoryChildren = useCallback(async (directoryPath: string) => {
    const projectName = selectedProject?.name;
    if (!projectName) {
      return;
    }

    const projectRoot = selectedProject?.fullPath || selectedProject?.path || '';
    const targetNode = findNodeByPath(files, directoryPath);
    if (!targetNode || targetNode.type !== 'directory') {
      return;
    }

    if (targetNode.hasChildren === false || hasLoadedChildren(targetNode)) {
      return;
    }

    try {
      const response = await api.getFiles(projectName, {
        path: targetNode.relativePath || directoryPath,
        depth: 1,
        projectPath: projectRoot,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Directory file fetch failed:', response.status, errorText);
        return;
      }

      const data = (await response.json()) as FileTreeNode[];
      const normalized = projectRoot ? attachRelativePaths(data, projectRoot) : data;
      setFiles((current) => attachChildrenToPath(current, directoryPath, normalized));
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        return;
      }

      console.error('Error loading directory files:', error);
    }
  }, [files, selectedProject?.fullPath, selectedProject?.path, selectedProject?.name]);

  return {
    files,
    loading,
    refreshFiles: () => setRefreshKey((value) => value + 1),
    loadDirectoryChildren,
  };
}
