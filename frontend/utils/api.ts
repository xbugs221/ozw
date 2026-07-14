/**
 * PURPOSE: Centralize authenticated HTTP calls used by the web client.
 */
import { IS_PLATFORM } from "../constants/config";

export const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  return localStorage.getItem('auth-token');
};

// Utility function for authenticated API calls
export const authenticatedFetch = (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = getAuthToken();

  const defaultHeaders: Record<string, string> = {};

  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (!IS_PLATFORM && token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers as Record<string, string>,
    },
  });
};

/**
 * PURPOSE: Encode dynamic route segments so project-scoped requests keep
 * working when a derived project name contains URL-sensitive characters.
 */
const encodeRouteSegment = (value: string): string => encodeURIComponent(String(value));

/**
 * Build the common base path for project-scoped API routes.
 */
const projectApiPath = (projectName: string): string => `/api/projects/${encodeRouteSegment(projectName)}`;

interface SaveFileOptions {
  projectPath?: string;
}

interface GetFilesOptions extends RequestInit {
  path?: string;
  depth?: number;
  showHidden?: boolean;
  projectPath?: string;
}

interface RenameProjectEntryOptions {
  projectPath?: string;
}

interface DeleteProjectEntryOptions {
  projectPath?: string;
}

interface UploadProjectEntriesOptions {
  projectPath?: string;
}

interface DownloadFileOptions {
  projectPath?: string;
}

interface DownloadFolderOptions {
  projectPath?: string;
}

// API endpoints
export const api = {
  // Auth endpoints (no token required)
  auth: {
    status: (): Promise<Response> => fetch('/api/auth/status'),
    login: (username: string, password: string): Promise<Response> => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    register: (username: string, password: string): Promise<Response> => fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    user: (): Promise<Response> => authenticatedFetch('/api/auth/user'),
    logout: (): Promise<Response> => authenticatedFetch('/api/auth/logout', { method: 'POST' }),
  },
  settings: {
    timeContext: (): Promise<Response> => authenticatedFetch('/api/settings/time-context'),
  },
  diagnostics: {
    runtimeDependencies: (): Promise<Response> => authenticatedFetch('/api/diagnostics/runtime-dependencies'),
    codexSharedRuntime: (): Promise<Response> => authenticatedFetch('/api/diagnostics/codex-shared-runtime'),
  },
  agents: {
    status: (): Promise<Response> => authenticatedFetch('/api/agents/status'),
  },

  // Protected endpoints
  projects: (): Promise<Response> => authenticatedFetch('/api/projects'),
  projectOverview: (projectName: string, projectPath?: string): Promise<Response> => {
    const query = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';
    return authenticatedFetch(`${projectApiPath(projectName)}/overview${query}`);
  },
  projectWorkflows: (projectName: string, projectPath?: string): Promise<Response> => {
    const query = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';
    return authenticatedFetch(`${projectApiPath(projectName)}/workflows${query}`);
  },
  projectWorkflow: (projectName: string, workflowId: string, projectPath?: string): Promise<Response> => {
    const query = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';
    return authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}${query}`);
  },
  projectOpenSpecChanges: (projectName: string, projectPath?: string): Promise<Response> => {
    const query = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';
    return authenticatedFetch(`${projectApiPath(projectName)}/openspec/changes${query}`);
  },
  createProjectWorkflow: (projectName: string, payload: Record<string, unknown>, projectPath = ''): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows`, {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        projectPath,
      }),
    }),
  resumeProjectWorkflowRun: (projectName: string, workflowId: string, projectPath = ''): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}/resume-run`, {
      method: 'POST',
      body: JSON.stringify({ projectPath }),
    }),
  abortProjectWorkflowRun: (projectName: string, workflowId: string, projectPath = ''): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}/abort-run`, {
      method: 'POST',
      body: JSON.stringify({ projectPath }),
    }),
  sessions: (projectName: string, limit = 5, offset = 0): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/sessions?limit=${limit}&offset=${offset}`),
  chatSearch: (query: string, mode = 'content'): Promise<Response> =>
    authenticatedFetch(`/api/chat/search?q=${encodeURIComponent(String(query || ''))}&mode=${encodeURIComponent(String(mode || 'content'))}`),
  sessionMessages: (
    projectName: string,
    sessionId: string,
    limit: number | null = null,
    offset = 0,
    provider = 'codex',
    afterLine: number | null = null,
    afterCursor: string | null = null,
    projectPath = '',
  ): Promise<Response> => {
    const params = new URLSearchParams();
    // Always pass provider so the server doesn't fall into provider-guessing
    // by scanning codexSessions/piSessions indexes (which exclude workflow child sessions).
    params.append('provider', String(provider || 'codex'));
    if (typeof afterCursor === 'string' && afterCursor) {
      params.append('afterCursor', afterCursor);
    }
    if (typeof projectPath === 'string' && projectPath) {
      params.append('projectPath', projectPath);
    }
    if (typeof afterLine === 'number') {
      params.append('afterLine', String(afterLine));
    } else if (limit !== null && !afterCursor) {
      params.append('limit', String(limit));
      params.append('offset', String(offset));
    }
    const queryString = params.toString();

    let url: string;
    if (provider === 'codex' && !/^c\d+$/.test(String(sessionId || ''))) {
      url = `/api/codex/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    } else {
      url = `${projectApiPath(projectName)}/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    }
    return authenticatedFetch(url);
  },
  renameProject: (projectName: string, displayName: string, projectPath: string | null): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/rename`, {
      method: 'PUT',
      body: JSON.stringify({
        displayName,
        projectPath: typeof projectPath === 'string' ? projectPath : null,
      }),
    }),
  renameSession: (projectName: string, sessionId: string, summary: string, projectPath = ''): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/sessions/${sessionId}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ summary, projectPath: typeof projectPath === 'string' ? projectPath : '' }),
    }),
  createManualSessionDraft: (projectName: string, payload: Record<string, unknown>): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/manual-sessions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  finalizeManualSessionDraft: (projectName: string, sessionId: string, payload: Record<string, unknown>): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/manual-sessions/${encodeRouteSegment(sessionId)}/finalize`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSessionUiState: (projectName: string, sessionId: string, payload: Record<string, unknown>): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/sessions/${sessionId}/ui-state`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  sessionModelState: (projectName: string, sessionId: string, projectPath = ''): Promise<Response> => {
    const params = new URLSearchParams();
    if (projectPath) {
      params.set('projectPath', projectPath);
    }
    const query = params.toString();
    return authenticatedFetch(
      `${projectApiPath(projectName)}/sessions/${encodeRouteSegment(sessionId)}/model-state${query ? `?${query}` : ''}`,
    );
  },
  updateSessionModelState: (projectName: string, sessionId: string, payload: Record<string, unknown>): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/sessions/${encodeRouteSegment(sessionId)}/model-state`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  renameCodexSession: (sessionId: string, summary: string, projectPath = ''): Promise<Response> =>
    authenticatedFetch(`/api/codex/sessions/${sessionId}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ summary, projectPath }),
    }),
  usageRemaining: (provider = 'codex'): Promise<Response> =>
    authenticatedFetch(`/api/usage/remaining?provider=${encodeURIComponent(provider)}`),
  deleteSession: (projectName: string, sessionId: string, provider = ''): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/sessions/${sessionId}${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`, {
      method: 'DELETE',
    }),
  deleteCodexSession: (sessionId: string, projectPath = ''): Promise<Response> =>
    authenticatedFetch(`/api/codex/sessions/${sessionId}`, {
      method: 'DELETE',
      body: JSON.stringify({ projectPath }),
    }),
  deleteProject: (projectName: string, force = false, projectPath = ''): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
      body: JSON.stringify({ projectPath }),
    }),
  createProject: (path: string): Promise<Response> =>
    authenticatedFetch('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  createWorkspace: (workspaceData: Record<string, unknown>): Promise<Response> =>
    authenticatedFetch('/api/projects/create-workspace', {
      method: 'POST',
      body: JSON.stringify(workspaceData),
    }),
  readFile: (projectName: string, filePath: string, options: DownloadFileOptions = {}): Promise<Response> => {
    const query = new URLSearchParams({
      filePath: String(filePath),
    });

    if (typeof options.projectPath === 'string' && options.projectPath.length > 0) {
      query.set('projectPath', options.projectPath);
    }

    return authenticatedFetch(`${projectApiPath(projectName)}/file?${query.toString()}`);
  },
  saveFile: (projectName: string, filePath: string, content: string, options: SaveFileOptions = {}): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content, projectPath: options.projectPath }),
    }),
  getFiles: (projectName: string, options: GetFilesOptions = {}): Promise<Response> => {
    const {
      path: targetPath,
      depth,
      showHidden,
      projectPath,
      ...fetchOptions
    } = options;

    const query = new URLSearchParams();

    if (typeof targetPath === 'string' && targetPath.length > 0) {
      query.set('path', targetPath);
    }

    if (Number.isInteger(depth)) {
      query.set('depth', String(depth));
    }

    if (typeof showHidden === 'boolean') {
      query.set('showHidden', String(showHidden));
    }

    if (typeof projectPath === 'string' && projectPath.length > 0) {
      query.set('projectPath', projectPath);
    }

    const queryString = query.toString();
    const url = `${projectApiPath(projectName)}/files${queryString ? `?${queryString}` : ''}`;
    return authenticatedFetch(url, fetchOptions);
  },
  renameProjectEntry: (projectName: string, payload: Record<string, unknown>, options: RenameProjectEntryOptions = {}): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/files/rename`, {
      method: 'PUT',
      body: JSON.stringify({
        ...payload,
        projectPath: options.projectPath ?? payload?.projectPath,
      }),
    }),
  deleteProjectEntry: (projectName: string, payload: Record<string, unknown>, options: DeleteProjectEntryOptions = {}): Promise<Response> =>
    authenticatedFetch(`${projectApiPath(projectName)}/files`, {
      method: 'DELETE',
      body: JSON.stringify({
        ...payload,
        projectPath: options.projectPath ?? payload?.projectPath,
      }),
    }),
  uploadProjectEntries: (projectName: string, formData: FormData, options: UploadProjectEntriesOptions = {}): Promise<Response> => {
    const hintedProjectPath = options.projectPath ?? formData.get('projectPath');
    if (typeof hintedProjectPath === 'string' && hintedProjectPath.length > 0) {
      formData.set('projectPath', hintedProjectPath);
    }

    return authenticatedFetch(`${projectApiPath(projectName)}/files/upload`, {
      method: 'POST',
      body: formData,
      headers: {},
    });
  },
  downloadProjectFile: (projectName: string, filePath: string, options: DownloadFileOptions = {}): Promise<Response> => {
    const query = new URLSearchParams({
      path: String(filePath),
    });

    if (typeof options.projectPath === 'string' && options.projectPath.length > 0) {
      query.set('projectPath', options.projectPath);
    }

    return authenticatedFetch(`${projectApiPath(projectName)}/files/download?${query.toString()}`);
  },
  downloadProjectFolder: (projectName: string, folderPath: string, options: DownloadFolderOptions = {}): Promise<Response> => {
    const query = new URLSearchParams({
      path: String(folderPath),
    });

    if (typeof options.projectPath === 'string' && options.projectPath.length > 0) {
      query.set('projectPath', options.projectPath);
    }

    return authenticatedFetch(`${projectApiPath(projectName)}/folders/download?${query.toString()}`);
  },
  browseFilesystem: (dirPath: string | null = null): Promise<Response> => {
    const params = new URLSearchParams();
    if (dirPath) params.append('path', dirPath);

    return authenticatedFetch(`/api/browse-filesystem?${params}`);
  },

  createFolder: (folderPath: string): Promise<Response> =>
    authenticatedFetch('/api/create-folder', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath }),
    }),

  user: {
    onboardingStatus: (): Promise<Response> => authenticatedFetch('/api/user/onboarding-status'),
    completeOnboarding: (): Promise<Response> =>
      authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST',
      }),
  },

  // Generic GET method for any endpoint
  get: (endpoint: string): Promise<Response> => authenticatedFetch(`/api${endpoint}`),
};
