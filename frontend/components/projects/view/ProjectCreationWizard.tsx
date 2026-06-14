/**
 * PURPOSE: Guide users through adding an existing workspace or creating a new
 * project folder, including mobile-safe filesystem folder browsing.
 */
// @ts-nocheck -- Migration baseline: JS-to-TS rename complete. Types will be tightened incrementally.
import React, { useState, useEffect } from 'react';
const X = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const FolderPlus = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>;
const GitBranch = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>;
const Key = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-7.58 7.58"/><path d="m21 2-3.5 3.5"/><path d="m17 6 3.5 3.5"/></svg>;
const ChevronRight = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>;
const ChevronLeft = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>;
const Check = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>;
const AlertCircle = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
const FolderOpen = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>;
const Eye = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const EyeOff = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
const Plus = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const Loader2 = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>;
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { api, getAuthToken } from '../../../utils/api';
import { useTranslation } from 'react-i18next';

function normalizeComparablePath(value) {
  /**
   * PURPOSE: Compare filesystem suggestions without changing the path shown to
   * users or submitted to the backend.
   */
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function splitInputPath(inputPath) {
  /**
   * PURPOSE: Split user-entered paths for suggestion browsing while supporting
   * Unix absolute paths, Windows paths, and home-relative `~` paths.
   */
  const trimmedPath = String(inputPath || '').trim();
  const lastSlash = Math.max(trimmedPath.lastIndexOf('/'), trimmedPath.lastIndexOf('\\'));

  if (lastSlash < 0) {
    return { parentPath: '~', leafPrefix: trimmedPath };
  }

  if (lastSlash === 0) {
    return { parentPath: '/', leafPrefix: trimmedPath.slice(1) };
  }

  if (lastSlash === 1 && trimmedPath.startsWith('~')) {
    return { parentPath: '~', leafPrefix: trimmedPath.slice(2) };
  }

  if (lastSlash === 2 && /^[A-Za-z]:/.test(trimmedPath)) {
    return { parentPath: trimmedPath.slice(0, 3), leafPrefix: trimmedPath.slice(3) };
  }

  return {
    parentPath: trimmedPath.slice(0, lastSlash),
    leafPrefix: trimmedPath.slice(lastSlash + 1),
  };
}

function joinSuggestionPrefix(browsedPath, leafPrefix) {
  /**
   * PURPOSE: Build the absolute prefix used to match server-side suggestions
   * after the backend has resolved the browsed parent directory.
   */
  const basePath = String(browsedPath || '').replace(/[\\/]+$/, '');
  if (!leafPrefix) {
    return basePath;
  }
  const separator = basePath.includes('\\') ? '\\' : '/';
  return `${basePath}${separator}${leafPrefix}`;
}

const ProjectCreationWizard = ({ onClose, onProjectCreated }) => {
  /**
   * PURPOSE: Collect a project workspace path and optionally browse server-side
   * folders before creating or registering the project.
   */
  const { t } = useTranslation();
  // Wizard state
  const [step, setStep] = useState(1); // 1: Choose type, 2: Configure, 3: Confirm
  const [workspaceType, setWorkspaceType] = useState('existing'); // 'existing' or 'new' - default to 'existing'

  // Form state
  const [workspacePath, setWorkspacePath] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [tokenMode, setTokenMode] = useState('none'); // 'new' | 'none'
  const [newGithubToken, setNewGithubToken] = useState('');

  // UI state
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);
  const [pathSuggestions, setPathSuggestions] = useState([]);
  const [showPathDropdown, setShowPathDropdown] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [browserCurrentPath, setBrowserCurrentPath] = useState('~');
  const [browserFolders, setBrowserFolders] = useState([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [showHiddenFolders, setShowHiddenFolders] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [cloneProgress, setCloneProgress] = useState('');

  // Load path suggestions
  useEffect(() => {
    if (workspacePath.length > 2) {
      loadPathSuggestions(workspacePath);
    } else {
      setPathSuggestions([]);
      setShowPathDropdown(false);
    }
  }, [workspacePath]);

  const loadPathSuggestions = async (inputPath) => {
    try {
      const { parentPath, leafPrefix } = splitInputPath(inputPath);

      const response = await api.browseFilesystem(parentPath);
      const data = await response.json();

      if (data.suggestions) {
        const suggestionPrefix = normalizeComparablePath(joinSuggestionPrefix(data.path || parentPath, leafPrefix));
        const filtered = data.suggestions.filter(s =>
          normalizeComparablePath(s.path).startsWith(suggestionPrefix) &&
          normalizeComparablePath(s.path) !== suggestionPrefix
        );
        setPathSuggestions(filtered.slice(0, 5));
        setShowPathDropdown(filtered.length > 0);
      }
    } catch (error) {
      console.error('Error loading path suggestions:', error);
    }
  };

  const handleNext = () => {
    setError(null);

    if (step === 1) {
      if (!workspaceType) {
        setError(t('projectWizard.errors.selectType'));
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!workspacePath.trim()) {
        setError(t('projectWizard.errors.providePath'));
        return;
      }

      // No validation for GitHub token - it's optional (only needed for private repos)
      setStep(3);
    }
  };

  const handleBack = () => {
    setError(null);
    setStep(step - 1);
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);
    setCloneProgress('');

    const parseSseMessage = (line: string) => {
      const match = line.match(/^data:\s*(\{.*\})$/);
      if (!match) {
        return null;
      }

      try {
        return JSON.parse(match[1]);
      } catch (error) {
        console.error('Error parsing SSE event:', error);
        return null;
      }
    };

    try {
      if (workspaceType === 'new' && githubUrl) {
        const cloneJobPayload = {
          path: workspacePath.trim(),
          githubUrl: githubUrl.trim(),
        };

        if (tokenMode === 'new' && newGithubToken) {
          cloneJobPayload.newGithubToken = newGithubToken.trim();
        }

        const createCloneJob = async () => {
          /**
           * PURPOSE: Recreate the server-side handoff without ever putting clone
           * credentials in the SSE URL.
           */
          const token = getAuthToken();
          const headers: HeadersInit = {
            'Content-Type': 'application/json',
          };
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }

          const cloneJobResponse = await fetch('/api/projects/clone-progress/jobs', {
            method: 'POST',
            headers,
            body: JSON.stringify(cloneJobPayload),
          });

          if (!cloneJobResponse.ok) {
            const payload = await cloneJobResponse.text();
            throw new Error(payload || t('projectWizard.errors.failedToCreate'));
          }

          return cloneJobResponse.json();
        };

        const runCloneProgressStream = async (jobId) => {
          /**
           * PURPOSE: Consume one clone-progress job and surface whether the
           * one-time handoff expired before the stream could start.
           */
          const params = new URLSearchParams({ jobId });
          const token = getAuthToken();
          const streamHeaders: HeadersInit = {};
          if (token) {
            streamHeaders.Authorization = `Bearer ${token}`;
          }

          const response = await fetch(`/api/projects/clone-progress?${params}`, {
            headers: streamHeaders,
          });

          if (!response.ok) {
            const payload = await response.text();
            throw new Error(payload || t('projectWizard.errors.failedToCreate'));
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('Clone progress stream unavailable');
          }

          const decoder = new TextDecoder();
          let buffer = '';

          return new Promise((resolve, reject) => {
            const handleSseEvent = (event): boolean | null => {
              if (!event) {
                return null;
              }

              if (event.type === 'progress') {
                setCloneProgress(event.message);
                return null;
              }

              if (event.type === 'complete') {
                if (onProjectCreated) {
                  onProjectCreated(event.project);
                }
                onClose();
                resolve({ completed: true, retryable: false });
                return true;
              }

              if (event.type === 'error') {
                const message = event.message || t('projectWizard.errors.failedToCreate');
                resolve({
                  completed: false,
                  retryable: /job not found or expired/i.test(message),
                  message,
                });
                return true;
              }

              return null;
            };

          const pump = async () => {
            const { value, done } = await reader.read();
            if (done) {
              const finalEvent = parseSseMessage(buffer.trim().split('\n')[0]);
              const stopped = finalEvent ? handleSseEvent(finalEvent) : false;
              if (stopped) {
                return;
              }
              return resolve({ completed: false, retryable: false });
            }

            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split('\n\n');
            buffer = chunks.pop() || '';

            for (const chunk of chunks) {
              const parsed = parseSseMessage(chunk.trim().split('\n')[0]);
              const stopped = handleSseEvent(parsed);
              if (stopped) {
                return stopped;
              }
            }

            return pump();
          };

          pump().catch((error) => {
            reject(error instanceof Error ? error : new Error('Clone stream failed'));
          });
        });

          };

        let cloneJob = await createCloneJob();
        let result = await runCloneProgressStream(cloneJob.jobId);
        if (!result.completed && result.retryable) {
          cloneJob = await createCloneJob();
          result = await runCloneProgressStream(cloneJob.jobId);
        }
        if (!result.completed) {
          throw new Error(result.message || t('projectWizard.errors.failedToCreate'));
        }
        return;
      }

      const payload = {
        workspaceType,
        path: workspacePath.trim(),
      };

      const response = await api.createWorkspace(payload);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.details || data.error || t('projectWizard.errors.failedToCreate'));
      }

      if (onProjectCreated) {
        onProjectCreated(data.project);
      }

      onClose();
    } catch (error) {
      console.error('Error creating workspace:', error);
      setError(error.message || t('projectWizard.errors.failedToCreate'));
    } finally {
      setIsCreating(false);
    }
  };

  const selectPathSuggestion = (suggestion) => {
    setWorkspacePath(suggestion.path);
    setShowPathDropdown(false);
  };

  const openFolderBrowser = async () => {
    setShowFolderBrowser(true);
    await loadBrowserFolders('~');
  };

  const loadBrowserFolders = async (path) => {
    try {
      setLoadingFolders(true);
      const response = await api.browseFilesystem(path);
      const data = await response.json();
      setBrowserCurrentPath(data.path || path);
      setBrowserFolders(data.suggestions || []);
    } catch (error) {
      console.error('Error loading folders:', error);
    } finally {
      setLoadingFolders(false);
    }
  };

  const selectFolder = (folderPath, advanceToConfirm = false) => {
    setWorkspacePath(folderPath);
    setShowFolderBrowser(false);
    if (advanceToConfirm) {
      setStep(3);
    }
  };

  const navigateToFolder = async (folderPath) => {
    await loadBrowserFolders(folderPath);
  };

  const createNewFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    setError(null);
    try {
      const separator = browserCurrentPath.includes('\\') ? '\\' : '/';
      const folderPath = `${browserCurrentPath}${separator}${newFolderName.trim()}`;
      const response = await api.createFolder(folderPath);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || t('projectWizard.errors.failedToCreateFolder', 'Failed to create folder'));
      }
      setNewFolderName('');
      setShowNewFolderInput(false);
      await loadBrowserFolders(data.path || folderPath);
    } catch (error) {
      console.error('Error creating folder:', error);
      setError(error.message || t('projectWizard.errors.failedToCreateFolder', 'Failed to create folder'));
    } finally {
      setCreatingFolder(false);
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 bottom-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-none sm:rounded-lg shadow-xl w-full h-full sm:h-auto sm:max-w-2xl border-0 sm:border border-gray-200 dark:border-gray-700 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
              <FolderPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('projectWizard.title')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            disabled={isCreating}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Indicator */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center justify-between">
            {[1, 2, 3].map((s) => (
              <React.Fragment key={s}>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-medium text-sm ${
                      s < step
                        ? 'bg-green-500 text-white'
                        : s === step
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                    }`}
                  >
                    {s < step ? <Check className="w-4 h-4" /> : s}
                  </div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 hidden sm:inline">
                    {s === 1 ? t('projectWizard.steps.type') : s === 2 ? t('projectWizard.steps.configure') : t('projectWizard.steps.confirm')}
                  </span>
                </div>
                {s < 3 && (
                  <div
                    className={`flex-1 h-1 mx-2 rounded ${
                      s < step ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 min-h-[300px]">
          {/* Error Display */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            </div>
          )}

          {/* Step 1: Choose workspace type */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  {t('projectWizard.step1.question')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Existing Workspace */}
                  <button
                    onClick={() => setWorkspaceType('existing')}
                    className={`p-4 border-2 rounded-lg text-left transition-all ${
                      workspaceType === 'existing'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-green-100 dark:bg-green-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FolderPlus className="w-5 h-5 text-green-600 dark:text-green-400" />
                      </div>
                      <div className="flex-1">
                        <h5 className="font-semibold text-gray-900 dark:text-white mb-1">
                          {t('projectWizard.step1.existing.title')}
                        </h5>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {t('projectWizard.step1.existing.description')}
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* New Workspace */}
                  <button
                    onClick={() => setWorkspaceType('new')}
                    className={`p-4 border-2 rounded-lg text-left transition-all ${
                      workspaceType === 'new'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <GitBranch className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div className="flex-1">
                        <h5 className="font-semibold text-gray-900 dark:text-white mb-1">
                          {t('projectWizard.step1.new.title')}
                        </h5>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {t('projectWizard.step1.new.description')}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Configure workspace */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Workspace Path */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {workspaceType === 'existing' ? t('projectWizard.step2.existingPath') : t('projectWizard.step2.newPath')}
                </label>
                <div className="relative flex gap-2">
                  <div className="flex-1 relative">
                    <Input
                      type="text"
                      value={workspacePath}
                      onChange={(e) => setWorkspacePath(e.target.value)}
                      placeholder={workspaceType === 'existing' ? '/path/to/existing/workspace' : '/path/to/new/workspace'}
                      className="w-full"
                    />
                    {showPathDropdown && pathSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {pathSuggestions.map((suggestion, index) => (
                          <button
                            key={index}
                            onClick={() => selectPathSuggestion(suggestion)}
                            className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 text-sm"
                          >
                            <div className="font-medium text-gray-900 dark:text-white">{suggestion.name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{suggestion.path}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openFolderBrowser}
                    className="px-3"
                    title="Browse folders"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </Button>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {workspaceType === 'existing'
                    ? t('projectWizard.step2.existingHelp')
                    : t('projectWizard.step2.newHelp')}
                </p>
              </div>

              {/* GitHub URL (only for new workspace) */}
              {workspaceType === 'new' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('projectWizard.step2.githubUrl')}
                    </label>
                    <Input
                      type="text"
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      placeholder="https://github.com/username/repository"
                      className="w-full"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {t('projectWizard.step2.githubHelp')}
                    </p>
                  </div>

                  {/* GitHub Token (only for HTTPS URLs - SSH uses SSH keys) */}
                  {githubUrl && !githubUrl.startsWith('git@') && !githubUrl.startsWith('ssh://') && (
                    <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                      <div className="flex items-start gap-3 mb-4">
                        <Key className="w-5 h-5 text-gray-600 dark:text-gray-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <h5 className="font-medium text-gray-900 dark:text-white mb-1">
                            {t('projectWizard.step2.githubAuth')}
                          </h5>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {t('projectWizard.step2.githubAuthHelp')}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mb-4">
                        <button
                          onClick={() => setTokenMode('new')}
                          className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                            tokenMode === 'new'
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {t('projectWizard.step2.newToken')}
                        </button>
                        <button
                          onClick={() => {
                            setTokenMode('none');
                            setNewGithubToken('');
                          }}
                          className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                            tokenMode === 'none'
                              ? 'bg-green-500 text-white'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {t('projectWizard.step2.nonePublic')}
                        </button>
                      </div>

                      {tokenMode === 'new' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {t('projectWizard.step2.optionalTokenPublic')}
                          </label>
                          <Input
                            type="password"
                            value={newGithubToken}
                            onChange={(e) => setNewGithubToken(e.target.value)}
                            placeholder={t('projectWizard.step2.tokenPublicPlaceholder')}
                            className="w-full"
                          />
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {t('projectWizard.step2.tokenHelp')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                  {t('projectWizard.step3.reviewConfig')}
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{t('projectWizard.step3.workspaceType')}</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {workspaceType === 'existing' ? t('projectWizard.step3.existingWorkspace') : t('projectWizard.step3.newWorkspace')}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{t('projectWizard.step3.path')}</span>
                    <span className="font-mono text-xs text-gray-900 dark:text-white break-all">
                      {workspacePath}
                    </span>
                  </div>
                  {workspaceType === 'new' && githubUrl && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">{t('projectWizard.step3.cloneFrom')}</span>
                        <span className="font-mono text-xs text-gray-900 dark:text-white break-all">
                          {githubUrl}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">{t('projectWizard.step3.authentication')}</span>
                        <span className="text-xs text-gray-900 dark:text-white">
                          {tokenMode === 'new' && newGithubToken
                            ? t('projectWizard.step3.usingProvidedToken')
                            : (githubUrl.startsWith('git@') || githubUrl.startsWith('ssh://'))
                            ? t('projectWizard.step3.sshKey', 'SSH Key')
                            : t('projectWizard.step3.noAuthentication')}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                {isCreating && cloneProgress ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-200">{t('projectWizard.step3.cloningRepository', 'Cloning repository...')}</p>
                    <code className="block text-xs font-mono text-blue-700 dark:text-blue-300 whitespace-pre-wrap break-all">
                      {cloneProgress}
                    </code>
                  </div>
                ) : (
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    {workspaceType === 'existing'
                      ? t('projectWizard.step3.existingInfo')
                      : githubUrl
                      ? t('projectWizard.step3.newWithClone')
                      : t('projectWizard.step3.newEmpty')}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
          <Button
            variant="outline"
            onClick={step === 1 ? onClose : handleBack}
            disabled={isCreating}
          >
            {step === 1 ? (
              t('projectWizard.buttons.cancel')
            ) : (
              <>
                <ChevronLeft className="w-4 h-4 mr-1" />
                {t('projectWizard.buttons.back')}
              </>
            )}
          </Button>

          <Button
            onClick={step === 3 ? handleCreate : handleNext}
            disabled={isCreating || (step === 1 && !workspaceType)}
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {githubUrl ? t('projectWizard.buttons.cloning', 'Cloning...') : t('projectWizard.buttons.creating')}
              </>
            ) : step === 3 ? (
              <>
                <Check className="w-4 h-4 mr-1" />
                {t('projectWizard.buttons.createProject')}
              </>
            ) : (
              <>
                {t('projectWizard.buttons.next')}
                <ChevronRight className="w-4 h-4 ml-1" />
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Folder Browser Modal */}
      {showFolderBrowser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] border border-gray-200 dark:border-gray-700 flex flex-col">
            {/* Browser Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
                  <FolderOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Select Folder
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowHiddenFolders(!showHiddenFolders)}
                  className={`p-2 rounded-md transition-colors ${
                    showHiddenFolders
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title={showHiddenFolders ? 'Hide hidden folders' : 'Show hidden folders'}
                >
                  {showHiddenFolders ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                </button>
                <button
                  onClick={() => setShowNewFolderInput(!showNewFolderInput)}
                  className={`p-2 rounded-md transition-colors ${
                    showNewFolderInput
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title="Create new folder"
                >
                  <Plus className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setShowFolderBrowser(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* New Folder Input */}
            {showNewFolderInput && (
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="New folder name"
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createNewFolder();
                      if (e.key === 'Escape') {
                        setShowNewFolderInput(false);
                        setNewFolderName('');
                      }
                    }}
                    autoFocus
                  />
                  <Button
                    size="sm"
                    onClick={createNewFolder}
                    disabled={!newFolderName.trim() || creatingFolder}
                  >
                    {creatingFolder ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowNewFolderInput(false);
                      setNewFolderName('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Folder List */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingFolders ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <div className="space-y-1">
                  {/* Parent Directory - check for Windows root (e.g., C:\) and Unix root */}
                  {browserCurrentPath !== '~' && browserCurrentPath !== '/' && !/^[A-Za-z]:\\?$/.test(browserCurrentPath) && (
                    <button
                      onClick={() => {
                        const lastSlash = Math.max(browserCurrentPath.lastIndexOf('/'), browserCurrentPath.lastIndexOf('\\'));
                        let parentPath;
                        if (lastSlash <= 0) {
                          parentPath = '/';
                        } else if (lastSlash === 2 && /^[A-Za-z]:/.test(browserCurrentPath)) {
                          parentPath = browserCurrentPath.substring(0, 3);
                        } else {
                          parentPath = browserCurrentPath.substring(0, lastSlash);
                        }
                        navigateToFolder(parentPath);
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-3"
                    >
                      <FolderOpen className="w-5 h-5 text-gray-400" />
                      <span className="font-medium text-gray-700 dark:text-gray-300">..</span>
                    </button>
                  )}

                  {/* Folders */}
                  {browserFolders.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      No subfolders found
                    </div>
                  ) : (
                    browserFolders
                      .filter(folder => showHiddenFolders || !folder.name.startsWith('.'))
                      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
                      .map((folder, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <button
                          onClick={() => navigateToFolder(folder.path)}
                          className="flex-1 px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-3"
                        >
                          <FolderPlus className="w-5 h-5 text-blue-500" />
                          <span className="font-medium text-gray-900 dark:text-white">{folder.name}</span>
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => selectFolder(folder.path, workspaceType === 'existing')}
                          className="text-xs px-3"
                        >
                          Select
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Browser Footer with Current Path */}
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">Path:</span>
                <code className="text-sm font-mono text-gray-900 dark:text-white flex-1 truncate">
                  {browserCurrentPath}
                </code>
              </div>
              <div className="flex items-center justify-end gap-2 p-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowFolderBrowser(false);
                    setShowNewFolderInput(false);
                    setNewFolderName('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => selectFolder(browserCurrentPath, workspaceType === 'existing')}
                >
                  Use this folder
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectCreationWizard;
