/**
 * PURPOSE: Encapsulate file-tree mutation, upload, copy, and download flows so
 * the view layer stays focused on presentation and menu orchestration.
 */
import { useCallback, useState } from 'react';
import { api } from '../../../utils/api';
import { copyTextToClipboard } from '../../../utils/clipboard';
import type { Project } from '../../../types/app';
import type {
  FileTreeFeedbackState,
  FileTreeMutationResponse,
  FileTreeNode,
  FileTreeUploadResponse,
} from '../types/types';

type UseFileTreeOperationsArgs = {
  selectedProject: Project | null;
  onRefresh: () => void;
};

type UseFileTreeOperationsResult = {
  busy: boolean;
  feedback: FileTreeFeedbackState | null;
  clearFeedback: () => void;
  renameEntry: (node: FileTreeNode, newName: string) => Promise<boolean>;
  deleteEntry: (node: FileTreeNode) => Promise<boolean>;
  copyEntryPath: (node: FileTreeNode) => Promise<boolean>;
  downloadEntry: (node: FileTreeNode) => Promise<boolean>;
  uploadEntries: (
    targetPath: string,
    files: File[] | FileList,
  ) => Promise<boolean>;
};

/**
 * Extract a human-readable error from a failed fetch response.
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: string };
    if (payload?.error) {
      return payload.error;
    }
  } catch {
    // Ignore JSON parse failures and fall back to status text.
  }

  return response.statusText || 'Request failed';
}

/**
 * Trigger a browser download from a binary fetch response.
 */
function startDownload(blob: Blob, fileName: string): void {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export function useFileTreeOperations({
  selectedProject,
  onRefresh,
}: UseFileTreeOperationsArgs): UseFileTreeOperationsResult {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<FileTreeFeedbackState | null>(null);
  const projectPath = selectedProject?.fullPath || selectedProject?.path || '';

  /**
   * Wrap async operations with consistent busy-state and inline feedback handling.
   */
  const runOperation = useCallback(async <T,>(
    operation: () => Promise<T>,
    onSuccess: (result: T) => string,
  ): Promise<T | null> => {
    if (!selectedProject?.name) {
      setFeedback({ kind: 'error', message: 'Project not selected' });
      return null;
    }

    setBusy(true);
    try {
      const result = await operation();
      const message = onSuccess(result);
      setFeedback({ kind: 'success', message });
      return result;
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Operation failed',
      });
      return null;
    } finally {
      setBusy(false);
    }
  }, [selectedProject?.name]);

  const renameEntry = useCallback(async (node: FileTreeNode, newName: string) => {
    const result = await runOperation(async () => {
      const response = await api.renameProjectEntry(selectedProject!.name, {
        oldPath: node.relativePath || node.path,
        newName,
      }, {
        projectPath,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = await response.json() as FileTreeMutationResponse;
      onRefresh();
      return payload;
    }, (payload) => payload.message);

    return Boolean(result);
  }, [onRefresh, projectPath, runOperation, selectedProject]);

  const deleteEntry = useCallback(async (node: FileTreeNode) => {
    const result = await runOperation(async () => {
      const response = await api.deleteProjectEntry(selectedProject!.name, {
        path: node.relativePath || node.path,
        type: node.type,
      }, {
        projectPath,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = await response.json() as FileTreeMutationResponse;
      onRefresh();
      return payload;
    }, (payload) => payload.message);

    return Boolean(result);
  }, [onRefresh, projectPath, runOperation, selectedProject]);

  const copyEntryPath = useCallback(async (node: FileTreeNode) => {
    const copied = await copyTextToClipboard(node.relativePath || node.path);
    if (copied) {
      setFeedback({ kind: 'success', message: 'Path copied to clipboard' });
      return true;
    }

    setFeedback({ kind: 'error', message: 'Failed to copy path' });
    return false;
  }, []);

  const downloadEntry = useCallback(async (node: FileTreeNode) => {
    const result = await runOperation(async () => {
      const requestPath = node.relativePath || node.path;
      const response = node.type === 'directory'
        ? await api.downloadProjectFolder(selectedProject!.name, requestPath, { projectPath })
        : await api.downloadProjectFile(selectedProject!.name, requestPath, { projectPath });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const blob = await response.blob();
      startDownload(blob, node.type === 'directory' ? `${node.name}.zip` : node.name);
      return node;
    }, () => 'Download started');

    return Boolean(result);
  }, [projectPath, runOperation, selectedProject]);

  const uploadEntries = useCallback(async (
    targetPath: string,
    files: File[] | FileList,
  ) => {
    const uploadFiles = Array.from(files);
    if (uploadFiles.length === 0) {
      return false;
    }

    const result = await runOperation(async () => {
      const formData = new FormData();
      formData.append('targetPath', targetPath);
      formData.append('projectPath', projectPath);

      const relativePaths = uploadFiles.map((file) => file.name);

      formData.append('relativePaths', JSON.stringify(relativePaths));
      uploadFiles.forEach((file) => {
        formData.append('files', file);
      });

      const response = await api.uploadProjectEntries(selectedProject!.name, formData, { projectPath });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = await response.json() as FileTreeUploadResponse;
      onRefresh();
      return payload;
    }, (payload) => payload.message);

    return Boolean(result);
  }, [onRefresh, projectPath, runOperation, selectedProject]);

  return {
    busy,
    feedback,
    clearFeedback: () => setFeedback(null),
    renameEntry,
    deleteEntry,
    copyEntryPath,
    downloadEntry,
    uploadEntries,
  };
}
