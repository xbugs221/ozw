/**
 * PURPOSE: Load project files, fuzzy-search mentionable paths, and insert selected file references into chat input.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import { api } from '../../../utils/api';
import { escapeRegExp } from '../utils/chatFormatting';
import { filterMentionableFiles, type MentionableFile } from '../utils/fileMentionSearch';
import { buildFileTree, flattenFileTree, type FileTreeItem, type ProjectFileNode } from '../utils/fileMentionTree';
import type { Project } from '../../../types/app';

export type { FileTreeItem, ProjectFileNode };

interface UseFileMentionsOptions {
  selectedProject: Project | null;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement>;
}

/**
 * Manage project file mention state for the chat composer.
 */
export function useFileMentions({ selectedProject, input, setInput, textareaRef }: UseFileMentionsOptions) {
  const [fileList, setFileList] = useState<MentionableFile[]>([]);
  const [fileTree, setFileTree] = useState<FileTreeItem[]>([]);
  const [fileMentions, setFileMentions] = useState<string[]>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [selectedFileIndex, setSelectedFileIndex] = useState(-1);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [expandedFileTreePaths, setExpandedFileTreePaths] = useState<Set<string>>(new Set());
  const [isFilesLoaded, setIsFilesLoaded] = useState(false);

  // Fetch project files on-demand only when the user opens the file mention dropdown.
  const fetchProjectFilesRef = useRef(false);
  useEffect(() => {
    if (!showFileDropdown || !selectedProject?.name) {
      return;
    }

    if (fetchProjectFilesRef.current) {
      return;
    }
    fetchProjectFilesRef.current = true;

    const abortController = new AbortController();
    const projectName = selectedProject.name;
    const projectPath = selectedProject.fullPath || selectedProject.path || '';

    const doFetch = async () => {
      try {
        const response = await api.getFiles(projectName, {
          projectPath,
          depth: 2,
          showHidden: false,
          signal: abortController.signal,
        });
        if (!response.ok) {
          return;
        }

        const files = (await response.json()) as ProjectFileNode[];
        setFileList(flattenFileTree(files));
        setFileTree(buildFileTree(files));
        setIsFilesLoaded(true);
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') {
          return;
        }
        console.error('Error fetching files:', error);
      }
    };

    doFetch();
    return () => {
      abortController.abort();
      fetchProjectFilesRef.current = false;
    };
  }, [selectedProject?.name, selectedProject?.path, selectedProject?.fullPath, showFileDropdown]);

  // Reset file data when project changes so the next dropdown-open triggers a fresh fetch.
  useEffect(() => {
    setFileList([]);
    setFileTree([]);
    setFileSearchQuery('');
    setExpandedFileTreePaths(new Set());
    setIsFilesLoaded(false);
    fetchProjectFilesRef.current = false;
  }, [selectedProject?.name, selectedProject?.path]);

  const filteredFiles = useMemo(
    () => filterMentionableFiles(fileList, fileSearchQuery),
    [fileList, fileSearchQuery],
  );

  useEffect(() => {
    if (!showFileDropdown) {
      setSelectedFileIndex(-1);
      return;
    }

    setSelectedFileIndex(filteredFiles.length > 0 ? 0 : -1);
  }, [filteredFiles.length, fileSearchQuery, showFileDropdown]);

  const openFileDropdown = useCallback(() => {
    if (showFileDropdown) {
      setShowFileDropdown(false);
      setSelectedFileIndex(-1);
      setFileSearchQuery('');
      return;
    }

    const selectionStart = textareaRef.current?.selectionStart ?? input.length;
    setCursorPosition(selectionStart);
    setFileSearchQuery('');
    setSelectedFileIndex(fileList.length > 0 ? 0 : -1);
    setShowFileDropdown(true);
  }, [fileList, input.length, showFileDropdown, textareaRef]);

  const activeFileMentions = useMemo(() => {
    if (!input || fileMentions.length === 0) {
      return [];
    }
    return fileMentions.filter((path) => input.includes(path));
  }, [fileMentions, input]);

  const sortedFileMentions = useMemo(() => {
    if (activeFileMentions.length === 0) {
      return [];
    }
    const uniqueMentions = Array.from(new Set(activeFileMentions));
    return uniqueMentions.sort((mentionA, mentionB) => mentionB.length - mentionA.length);
  }, [activeFileMentions]);

  const fileMentionRegex = useMemo(() => {
    if (sortedFileMentions.length === 0) {
      return null;
    }
    const pattern = sortedFileMentions.map(escapeRegExp).join('|');
    return new RegExp(`(${pattern})`, 'g');
  }, [sortedFileMentions]);

  const fileMentionSet = useMemo(() => new Set(sortedFileMentions), [sortedFileMentions]);

  const renderInputWithMentions = useCallback(
    (text: string) => {
      if (!text) {
        return '';
      }
      if (!fileMentionRegex) {
        return text;
      }

      const parts = text.split(fileMentionRegex);
      return parts.map((part, index) =>
        fileMentionSet.has(part) ? (
          <span
            key={`mention-${index}`}
            className="bg-blue-200/70 -ml-0.5 dark:bg-blue-300/40 px-0.5 rounded-md box-decoration-clone text-transparent"
          >
            {part}
          </span>
        ) : (
          <span key={`text-${index}`}>{part}</span>
        ),
      );
    },
    [fileMentionRegex, fileMentionSet],
  );

  const selectFile = useCallback(
    (file: MentionableFile) => {
      const textBeforeCursor = input.slice(0, cursorPosition);
      const textAfterCursor = input.slice(cursorPosition);
      const separatorBefore = textBeforeCursor && !textBeforeCursor.endsWith(' ') ? ' ' : '';
      const separatorAfter = textAfterCursor && !textAfterCursor.startsWith(' ') ? ' ' : '';
      const newInput = `${textBeforeCursor}${separatorBefore}${file.path}${separatorAfter}${textAfterCursor}`;
      const newCursorPosition = textBeforeCursor.length + separatorBefore.length + file.path.length + separatorAfter.length;

      setInput(newInput);
      setCursorPosition(newCursorPosition);
      setFileMentions((previousMentions) =>
        previousMentions.includes(file.path) ? previousMentions : [...previousMentions, file.path],
      );

      setShowFileDropdown(false);
      setFileSearchQuery('');
      window.setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition);
      }, 0);
    },
    [cursorPosition, input, setInput, textareaRef],
  );

  const toggleFileTreeDirectory = useCallback((directoryPath: string) => {
    /**
     * Expand or collapse one directory without forcing the whole tree to render.
     */
    setExpandedFileTreePaths((previousPaths) => {
      const nextPaths = new Set(previousPaths);
      if (nextPaths.has(directoryPath)) {
        nextPaths.delete(directoryPath);
      } else {
        nextPaths.add(directoryPath);
      }
      return nextPaths;
    });
  }, []);

  const handleFileMentionsKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): boolean => {
      if (!showFileDropdown) {
        return false;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (filteredFiles.length === 0) {
          return true;
        }
        setSelectedFileIndex((previousIndex) =>
          previousIndex < filteredFiles.length - 1 ? previousIndex + 1 : 0,
        );
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (filteredFiles.length === 0) {
          return true;
        }
        setSelectedFileIndex((previousIndex) =>
          previousIndex > 0 ? previousIndex - 1 : filteredFiles.length - 1,
        );
        return true;
      }

      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        if (filteredFiles.length === 0) {
          return true;
        }
        if (selectedFileIndex >= 0) {
          selectFile(filteredFiles[selectedFileIndex]);
        } else if (filteredFiles.length > 0) {
          selectFile(filteredFiles[0]);
        }
        return true;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setShowFileDropdown(false);
        setFileSearchQuery('');
        return true;
      }

      return false;
    },
    [showFileDropdown, filteredFiles, selectedFileIndex, selectFile],
  );

  return {
    showFileDropdown,
    fileSearchQuery,
    setFileSearchQuery,
    fileTree,
    expandedFileTreePaths,
    toggleFileTreeDirectory,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    openFileDropdown,
    setCursorPosition,
    handleFileMentionsKeyDown,
  };
}
