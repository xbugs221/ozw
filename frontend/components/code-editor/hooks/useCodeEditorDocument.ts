/**
 * PURPOSE: Load editor documents with file-type classification so text, image,
 * and binary files can follow separate UI and download paths.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../utils/api';
import type { CodeEditorFile, CodeEditorFileType } from '../types/types';

type UseCodeEditorDocumentParams = {
  file: CodeEditorFile;
  projectPath?: string;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

/**
 * Derive the fallback text mode used by diff payloads that already carry text snapshots.
 */
const inferTextFileType = (fileName: string): CodeEditorFileType => {
  const extension = fileName.split('.').pop()?.toLowerCase();
  return extension === 'md' || extension === 'markdown' ? 'markdown' : 'text';
};

/**
 * Trigger a browser download from a blob while keeping bytes untouched.
 */
const startDownload = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
};

export const useCodeEditorDocument = ({ file, projectPath }: UseCodeEditorDocumentParams) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fileType, setFileType] = useState<CodeEditorFileType>(file.fileType ?? inferTextFileType(file.name));
  const [mimeType, setMimeType] = useState<string | null>(typeof file.mimeType === 'string' ? file.mimeType : null);
  const [editable, setEditable] = useState(file.editable ?? true);
  const fileProjectName = file.projectName ?? projectPath;
  const fileProjectPath = typeof file.projectPath === 'string' && file.projectPath
    ? file.projectPath
    : projectPath;
  const filePath = file.path;
  const fileName = file.name;
  const fileDiffNewString = file.diffInfo?.new_string;
  const fileDiffOldString = file.diffInfo?.old_string;

  useEffect(() => {
    const loadFileContent = async () => {
      try {
        setLoading(true);

        // Diff payload may already include full old/new snapshots, so avoid disk read.
        if (file.diffInfo && fileDiffNewString !== undefined && fileDiffOldString !== undefined) {
          setFileType(inferTextFileType(fileName));
          setEditable(true);
          setContent(fileDiffNewString);
          setLoading(false);
          return;
        }

        if (!fileProjectName) {
          throw new Error('Missing project identifier');
        }

        const response = await api.readFile(fileProjectName, filePath, { projectPath: fileProjectPath });
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const nextFileType = data.fileType ?? inferTextFileType(fileName);
        setFileType(nextFileType);
        setMimeType(typeof data.mimeType === 'string' ? data.mimeType : null);
        setEditable(
          typeof data.editable === 'boolean'
            ? data.editable
            : nextFileType === 'text' || nextFileType === 'markdown',
        );
        setContent(typeof data.content === 'string' ? data.content : '');
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('Error loading file:', error);
        setContent(`// Error loading file: ${message}\n// File: ${fileName}\n// Path: ${filePath}`);
      } finally {
        setLoading(false);
      }
    };

    loadFileContent();
  }, [fileDiffNewString, fileDiffOldString, fileName, filePath, fileProjectName, fileProjectPath]);

  const handleSave = useCallback(async () => {
    if (!editable) {
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      if (!fileProjectName) {
        throw new Error('Missing project identifier');
      }

      const response = await api.saveFile(fileProjectName, filePath, content, { projectPath: fileProjectPath });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Save failed: ${response.status}`);
        }

        const textError = await response.text();
        console.error('Non-JSON error response:', textError);
        throw new Error(`Save failed: ${response.status} ${response.statusText}`);
      }

      await response.json();

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      const message = getErrorMessage(error);
      console.error('Error saving file:', error);
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }, [content, editable, filePath, fileProjectName, fileProjectPath]);

  const handleDownload = useCallback(async () => {
    if (!fileProjectName) {
      throw new Error('Missing project identifier');
    }

    const response = await api.downloadProjectFile(fileProjectName, filePath, { projectPath: fileProjectPath });
    if (!response.ok) {
      throw new Error(response.statusText || `Download failed: ${response.status}`);
    }

    startDownload(await response.blob(), file.name);
  }, [file.name, filePath, fileProjectName, fileProjectPath]);

  return {
    content,
    setContent,
    loading,
    saving,
    saveSuccess,
    saveError,
    fileType,
    mimeType,
    editable,
    handleSave,
    handleDownload,
  };
};
