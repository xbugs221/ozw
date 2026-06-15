#!/usr/bin/env node
// Load environment variables before other imports execute
import '../load-env.js';
import fs from 'fs';
import path from 'path';
import { resolvePackageRoot } from '../utils/package-root.js';

const PKG_ROOT = resolvePackageRoot();

const installMode = fs.existsSync(path.join(PKG_ROOT, '.git')) ? 'git' : 'npm';

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    dim: '\x1b[2m',
};

const c = {
    info: (text: string) => `${colors.cyan}${text}${colors.reset}`,
    ok: (text: string) => `${colors.green}${text}${colors.reset}`,
    warn: (text: string) => `${colors.yellow}${text}${colors.reset}`,
    tip: (text: string) => `${colors.blue}${text}${colors.reset}`,
    bright: (text: string) => `${colors.bright}${text}${colors.reset}`,
    dim: (text: string) => `${colors.dim}${text}${colors.reset}`,
};

console.log('PORT from env:', process.env.PORT);

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import http from 'http';
import cors from 'cors';
import { promises as fsPromises } from 'fs';
import { spawn } from 'child_process';
import pty from 'node-pty';
import fetch from 'node-fetch';
import mime from 'mime-types';

import {
    getProjects,
    getSessions,
    getSessionMessages,
    getCodexSessions,
    getPiSessions,
    getCodexSessionMessages,
    searchChatHistory,
    renameProject,
    updateSessionUiState,
    getSessionModelState,
    updateSessionModelState,
    renameSession,
    createManualSessionDraft,
    initManualSessionRoute,
    bindManualSessionProvider,
    getManualSessionRouteRuntime,
    finalizeManualSessionRoute,
    deleteSession,
    deleteProject,
    addProjectManually,
    loadProjectConfig,
    findProjectChatRecord,
    extractProjectDirectory,
    clearProjectDirectoryCache,
    refreshMissingProjectPathCache,
    indexProviderSessionFile,
    deleteProviderSessionIndexFile,
} from '../projects.js';
import {
    buildProjectOverviewReadModel,
    summarizeProjectForList,
} from '../domains/projects/project-overview-read-model.js';
import { resolveProviderSessionChange } from '../provider-session-change.js';
import {
    sendNativeMessage,
    abortNativeSession,
    getNativeSessionStatus,
    getActiveNativeSessions,
    PROVIDER_CAPABILITIES,
} from '../native-agent-runtime.js';
import { handleGetSessionMessages } from '../session-messages-handler.js';
import { removeLegacyCoState } from '../legacy-co-cleanup.js';
import { resolveChatProjectOptions } from '../chat-project-path.js';
import { getUsageRemaining } from '../usage-remaining.js';
import {
    getCodexSessionTokenUsage,
} from '../session-token-usage.js';
import authRoutes from '../routes/auth.js';
import mcpRoutes from '../routes/mcp.js';
import mcpUtilsRoutes from '../routes/mcp-utils.js';
import commandsRoutes from '../routes/commands.js';
import settingsRoutes from '../routes/settings.js';
import agentRoutes from '../routes/agent.js';
import projectsRoutes, { WORKSPACES_ROOT, validateWorkspacePath } from '../routes/projects.js';
import cliAuthRoutes, { checkCodexCredentials } from '../routes/cli-auth.js';
import userRoutes from '../routes/user.js';
import codexRoutes from '../routes/codex.js';
import { initializeDatabase } from '../database/db.js';
import { validateApiKey, authenticateToken, authenticateWebSocket } from '../middleware/auth.js';
import { IS_PLATFORM } from '../constants/config.js';
import {
    buildMutationResponse,
    createDirectoryArchive,
    joinProjectChildPath,
    resolveProjectPath,
    resolveReadableProjectPath,
    resolveProjectRoot,
    resolveProjectRootWithHint,
    resolveProjectTarget,
    sanitizeEntryName,
    sanitizeUploadRelativePath,
    sendDownload,
} from '../project-file-operations.js';
import {
    CHAT_UPLOAD_ROOT,
    persistChatUploads,
    sanitizeFilename,
} from '../chat-attachments.js';
import {
    attachWorkflowMetadata,
    abortWorkflowRun,
    createProjectWorkflow,
    findProjectByName,
    getProjectWorkflow,
    listProjectAdoptableOpenSpecChanges,
    listProjectWorkflows,
    resumeWorkflowRun,
    summarizeWorkflowForProjectList,
} from '../workflows.js';
import {
    checkRequiredRuntimeDependencies,
} from '../runtime-dependencies.js';
import { buildRuntimeReadinessReport } from '../runtime-readiness.js';
import { getCodexModelCatalog } from '../codex-models.js';
import { getPiModelCatalog } from '../pi-models.js';
import { resolveCodexCliPath } from '../codex-cli.js';
import { ensureGoRunnerWatchersForProjects } from '../domains/workflows/go-runner-watchers.js';
import { shouldServeSpaIndex } from '../utils/spaFallback.js';
import { getWebSocketAuthToken } from '../websocket-auth.js';
import { createScopedAsyncCoalescer } from '../utils/scopedAsyncCoalescer.js';
import { configureAppMiddleware, createBackendApp, registerSpaFallback, registerStaticAssets } from './app-factory.js';
import { handleChatConnection } from './chat-websocket.js';
import { registerFileRoutes } from './file-routes.js';
import { createProviderWatcherController } from './provider-watchers.js';
import { createServerRuntimeContext, type ServerRuntimeContext } from './server-runtime-context.js';
import { closeShellPtySessions, handleShellConnection } from './shell-websocket.js';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const TEXT_SAMPLE_BYTES = 8192;
const CC_ROUTE_SESSION_PATTERN = /^c\d+$/;
type LooseRecord = Record<string, any>;
type RuntimeClient = { readyState?: number; send(payload: string): void };
type RuntimeWriter = { send(data: unknown): void; setSessionId?(sessionId: string): void; setSessionIndexContext?(context: unknown): void };

const nativeActiveSessions = new Map<string, any>();
const heavyReadCoalescer = createScopedAsyncCoalescer({ label: 'server-heavy-read' });
const PROJECT_INVALIDATION_DEBOUNCE_MS = 100;
const pendingProjectListInvalidations = new Map<string, NodeJS.Timeout>();

/**
 * Resolve the project path for a single-project detail request.
 */
async function resolveProjectOverviewTarget(projectName: string, projectPathHint: unknown) {
    /**
     * PURPOSE: Let the lightweight list pass an explicit path while still
     * supporting legacy encoded project names and provider-only route names.
     */
    const requestedProjectPath = typeof projectPathHint === 'string'
        ? projectPathHint.trim()
        : '';
    if (requestedProjectPath) {
        try {
            const stat = await fsPromises.stat(requestedProjectPath);
            if (stat.isDirectory()) {
                return {
                    name: projectName,
                    path: requestedProjectPath,
                    fullPath: requestedProjectPath,
                };
            }
        } catch {
            return null;
        }
    }

    const extractedPath = await extractProjectDirectory(projectName);
    try {
        const stat = await fsPromises.stat(extractedPath);
        if (stat.isDirectory()) {
            return {
                name: projectName,
                path: extractedPath,
                fullPath: extractedPath,
            };
        }
    } catch {
        // Fall through to the project list mapping for live provider-only names.
    }

    const project = (await getProjects()).find((candidate) => (
        candidate.name === projectName
        || candidate.routePath === projectName
        || candidate.fullPath === projectName
        || candidate.path === projectName
    ));
    if (!project) {
        return null;
    }
    return project;
}

/**
 * Return a fallback value while logging optional filesystem probe failures.
 */
async function withLoggedFallback<T>(operation: Promise<T>, fallback: T, context: string): Promise<T> {
    try {
        return await operation;
    } catch (error: any) {
        console.warn(`[server-main] ${context}:`, error instanceof Error ? error.message : error);
        return fallback;
    }
}

/**
 * Return the first non-empty string from mixed websocket protocol fields.
 */
function pickString(...values: unknown[]): string {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return '';
}

/**
 * Detect WebUI route-only manual session ids that must not be used as provider resume ids.
 */
function isCbwRouteSessionId(sessionId: unknown): boolean {
    return typeof sessionId === 'string' && CC_ROUTE_SESSION_PATTERN.test(sessionId.trim());
}

/**
 * Accept only providers supported by manual chat turns.
 */
function normalizeManualProvider(provider: unknown): "codex" | "pi" {
    if (provider === 'codex' || provider === 'pi') {
        return provider;
    }
    throw new Error('provider must be "codex" or "pi"');
}

/**
 * Extract the manual-session first-message contract from websocket payloads.
 */
function resolveCbwSessionStartContext(data: LooseRecord = {}, resolvedOptions: LooseRecord = {}) {
    const options = data && typeof data.options === 'object' && data.options !== null ? data.options : {};
    const explicitCbwSessionId = pickString(
        data.ozwSessionId,
        data.ozw_session_id,
        options.ozwSessionId,
        options.ozw_session_id,
    );
    const fallbackRouteSessionId = isCbwRouteSessionId(resolvedOptions?.sessionId)
        ? resolvedOptions.sessionId
        : '';
    const ozwSessionId = isCbwRouteSessionId(explicitCbwSessionId)
        ? explicitCbwSessionId
        : fallbackRouteSessionId;

    return {
        ozwSessionId,
        routeInitToken: pickString(
            data.routeInitToken,
            data.start_request_id,
            data.clientRequestId,
            options.routeInitToken,
            options.start_request_id,
            options.clientRequestId,
        ),
        clientRef: pickString(data.clientRef, data.client_ref, options.clientRef, options.client_ref, data.command),
    };
}

/**
 * Build the WebUI cN route id from a persisted chat route index.
 */
function buildCbwRouteSessionId(routeIndex: unknown): string {
    /**
     * PURPOSE: Keep provider UUIDs out of the browser route identity.
     */
    const parsed = Number(routeIndex);
    return Number.isInteger(parsed) && parsed > 0 ? `c${parsed}` : '';
}

/**
 * Recover a manual cN route when the browser sends only a provider session id.
 */
async function resolveCbwRouteSessionIdFromProviderSession(provider: "codex" | "pi", data: LooseRecord = {}, resolvedOptions: LooseRecord = {}): Promise<string> {
    /**
     * PURPOSE: Preserve manual-session persistence after provider-created events
     * update the selected frontend session to a Codex/Pi transcript UUID.
     */
    const options = data && typeof data.options === 'object' && data.options !== null ? data.options : {};
    const providerSessionId = pickString(
        data.sessionId,
        options.sessionId,
        resolvedOptions?.sessionId,
    );
    if (!providerSessionId || isCbwRouteSessionId(providerSessionId)) {
        return '';
    }

    const projectPath = pickString(
        resolvedOptions?.projectPath,
        resolvedOptions?.cwd,
        options.projectPath,
        options.cwd,
    );
    const projectName = pickString(resolvedOptions?.projectName, options.projectName);
    const config = await loadProjectConfig(projectPath || await extractProjectDirectory(projectName));
    const providerMatches = (record: LooseRecord | undefined) => !record?.provider || record.provider === provider;
    const isManualBacked = (record: LooseRecord | undefined) => record?.origin === 'manual'
        || record?.origin === 'workflow'
        || Array.isArray(record?.routePendingMessages);

    const located = (findProjectChatRecord as any)(config, providerSessionId, provider);
    if (located?.scope === 'chat' && isManualBacked(located.record as LooseRecord)) {
        return buildCbwRouteSessionId(located.routeIndex);
    }

    for (const [routeIndex, record] of Object.entries(config?.chat || {})) {
        if (
            providerMatches(record)
            && isManualBacked(record)
            && record?.providerSessionId === providerSessionId
        ) {
            return buildCbwRouteSessionId(routeIndex);
        }
    }

    return '';
}

/**
 * Resolve the stable co conversation_id for a chat or abort request.
 *
 * Priority:
 * 1. Explicit ozwSessionId (cN)
 * 2. current sessionId if it is already cN
 * 3. Project chat config lookup by provider session id → routeIndex → cN
 * 4. Co conversation state scan by provider_session_id
 * 5. Not found → error (caller must not write pending request)
 */
/**
 * Emit the user-message acceptance event once the backend has accepted a chat
 * request for a concrete visible session.
 */
function sendMessageAccepted(writer: RuntimeWriter, {
    sessionId,
    ozwSessionId,
    provider,
    clientRequestId,
    routeInitToken,
}: LooseRecord) {
    const acceptedSessionId = sessionId || ozwSessionId || null;
    if (!acceptedSessionId) {
        return;
    }

    writer.send({
        type: 'message-accepted',
        sessionId: acceptedSessionId,
        ozwSessionId: ozwSessionId || null,
        provider,
        clientRequestId,
        routeInitToken,
    });
}

/**
 * Detect whether a byte buffer should stay on the text-safe editor path.
 */
function trimIncompleteUtf8Tail(buffer: Buffer): Buffer {
    if (!buffer || buffer.length === 0) {
        return buffer;
    }

    let continuationBytes = 0;
    for (let index = buffer.length - 1; index >= 0 && continuationBytes < 3; index -= 1) {
        const byte = buffer[index];
        if ((byte & 0xc0) !== 0x80) {
            const expectedLength = (
                byte >= 0xf0 && byte <= 0xf4 ? 4
                    : byte >= 0xe0 && byte <= 0xef ? 3
                        : byte >= 0xc2 && byte <= 0xdf ? 2
                            : 1
            );

            if (expectedLength === 1 || continuationBytes + 1 >= expectedLength) {
                return buffer;
            }

            return buffer.subarray(0, index);
        }

        continuationBytes += 1;
    }

    return buffer;
}

/**
 * Detect whether a byte buffer should stay on the text-safe editor path.
 */
function isLikelyTextBuffer(buffer: Buffer): boolean {
    if (!buffer || buffer.length === 0) {
        return true;
    }

    if (buffer.includes(0)) {
        return false;
    }

    try {
        TEXT_DECODER.decode(trimIncompleteUtf8Tail(buffer));
    } catch {
        return false;
    }

    let suspiciousControlBytes = 0;
    for (const byte of buffer) {
        const isTab = byte === 9;
        const isLineBreak = byte === 10 || byte === 13;
        const isPrintableAscii = byte >= 32;
        if (!isTab && !isLineBreak && !isPrintableAscii) {
            suspiciousControlBytes += 1;
        }
    }

    return suspiciousControlBytes / buffer.length < 0.05;
}

/**
 * Classify a workspace file before routing it into editor, preview, or download flows.
 */
function classifyProjectFile(absolutePath: string, sampleBuffer: Buffer) {
    const mimeType = mime.lookup(absolutePath) || 'application/octet-stream';
    const extension = path.extname(absolutePath).toLowerCase();

    if (typeof mimeType === 'string' && mimeType.startsWith('image/')) {
        return {
            fileType: 'image',
            mimeType,
            editable: false,
        };
    }

    if (!isLikelyTextBuffer(sampleBuffer)) {
        return {
            fileType: 'binary',
            mimeType,
            editable: false,
        };
    }

    if (MARKDOWN_EXTENSIONS.has(extension)) {
        return {
            fileType: 'markdown',
            mimeType,
            editable: true,
        };
    }

    return {
        fileType: 'text',
        mimeType,
        editable: true,
    };
}

// File system watchers for provider project/session folders
const PROVIDER_WATCH_PATHS = [
    { provider: 'codex', rootPath: path.join(os.homedir(), '.codex', 'sessions') },
    { provider: 'pi', rootPath: path.join(os.homedir(), '.pi', 'agent', 'sessions') },
];
const WATCHER_IGNORED_PATTERNS = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/*.tmp',
    '**/*.swp',
    '**/.DS_Store'
];
const connectedClients = new Set<WebSocket>();
const chatClientUsers = new WeakMap<object, string | null>();
const recentChatRequestIds = new Map<string, number>();
const CHAT_REQUEST_ID_TTL_MS = 10 * 60 * 1000;

function pruneRecentChatRequestIds(now = Date.now()) {
    for (const [requestId, expiresAt] of recentChatRequestIds.entries()) {
        if (expiresAt <= now) {
            recentChatRequestIds.delete(requestId);
        }
    }
}

function acceptChatRequestId(requestId: unknown): boolean {
    if (typeof requestId !== 'string' || !requestId) {
        return true;
    }

    const now = Date.now();
    pruneRecentChatRequestIds(now);

    if (recentChatRequestIds.has(requestId)) {
        return false;
    }

    recentChatRequestIds.set(requestId, now + CHAT_REQUEST_ID_TTL_MS);
    return true;
}
let isGetProjectsRunning = false; // Flag to prevent reentrant calls
let isShuttingDown = false;

// Broadcast progress to all connected WebSocket clients
function broadcastProgress(progress: LooseRecord): void {
    const message = JSON.stringify({
        type: 'loading_progress',
        ...progress
    });
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

/**
 * Broadcast a chat-scoped event to connected clients for the same authenticated user.
 */
function broadcastChatEvent(payload: unknown, sourceUserId: string | null = null): void {
    const message = JSON.stringify(payload);
    connectedClients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) {
            return;
        }

        if (sourceUserId !== null) {
            const targetUserId = chatClientUsers.get(client);
            if (targetUserId !== sourceUserId) {
                return;
            }
        }

        client.send(message);
    });
}

/**
 * Notify clients that a session's model controls changed.
 */
function broadcastSessionModelStateUpdated({ sourceUserId = null, projectName = '', projectPath = '', sessionId = '', provider = 'codex', state = {} }: LooseRecord) {
    if (!sessionId) {
        return;
    }

    broadcastChatEvent({
        type: 'session-model-state-updated',
        provider,
        projectName,
        projectPath,
        sessionId,
        state,
        timestamp: new Date().toISOString(),
    }, sourceUserId);
}

/**
 * Broadcast a lightweight project-list invalidation so clients know they should
 * refresh their sidebar / project list from the REST API.  No full projects
 * snapshot is included — the client decides which read model to refresh.
 */
async function broadcastProjectListInvalidated({ reason = 'change', changedProjectPath = '' }: LooseRecord = {}): Promise<void> {
    /**
     * PURPOSE: Collapse watcher bursts for the same reason/project into a
     * single lightweight invalidation so clients do not start repeated refreshes.
     */
    const scopeKey = `${reason}:${changedProjectPath}`;
    const existingTimer = pendingProjectListInvalidations.get(scopeKey);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
        pendingProjectListInvalidations.delete(scopeKey);
        if (isGetProjectsRunning) {
            return;
        }

        try {
            isGetProjectsRunning = true;
            clearProjectDirectoryCache();
            const updateMessage = JSON.stringify({
                type: 'project_list_invalidated',
                scope: 'projects:list',
                version: `${Date.now()}:${scopeKey}`,
                reason,
                changedProjectPath,
                timestamp: new Date().toISOString(),
            });

            connectedClients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(updateMessage);
                }
            });
        } catch (error: any) {
            console.error('[ERROR] Error broadcasting project list invalidation:', error);
        } finally {
            isGetProjectsRunning = false;
        }
    }, PROJECT_INVALIDATION_DEBOUNCE_MS);
    pendingProjectListInvalidations.set(scopeKey, timer);
}

/**
 * Broadcast a session change so the current-chat client can incrementally
 * fetch new messages instead of re-downloading the full projects snapshot.
 */
function broadcastSessionChanged({
    provider,
    projectPath,
    sessionId,
    ozwSessionId = '',
    providerSessionId = '',
    sourceSessionId = '',
    changedFile = '',
    changeType = 'change'
}: LooseRecord) {
    const updateMessage = JSON.stringify({
        type: 'session_changed',
        provider,
        projectPath,
        sessionId,
        ozwSessionId: ozwSessionId || undefined,
        providerSessionId: providerSessionId || undefined,
        sourceSessionId: sourceSessionId || undefined,
        changedFile,
        changeType,
        timestamp: new Date().toISOString(),
    });

    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(updateMessage);
        }
    });
}

/**
 * Broadcast a workflow change for Go-runner state/log watchers so the
 * workflow detail pane can refresh without a full projects re-compute.
 */
function broadcastWorkflowChanged({ projectName, projectPath, runId, changeType = 'change' }: LooseRecord): void {
    const updateMessage = JSON.stringify({
        type: 'workflow_changed',
        projectName,
        projectPath,
        runId,
        changeType,
        timestamp: new Date().toISOString(),
    });

    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(updateMessage);
        }
    });
}

/**
 * Keep a full-project-refresh escape hatch for manual reload, error recovery
 * and non-file-watcher triggers (e.g. config changes).  Provider file-change
 * watchers must NOT use this path — they go through session_changed / workflow_changed.
 */
async function broadcastProjectsUpdated({ changeType = 'change', changedFile = '', watchProvider = 'workflow' }: LooseRecord = {}): Promise<void> {
    if (isGetProjectsRunning) {
        return;
    }

    try {
        isGetProjectsRunning = true;
        clearProjectDirectoryCache();
        const updateMessage = JSON.stringify({
            type: 'project_list_invalidated',
            reason: `manual-refresh:${watchProvider}:${changeType}`,
            changedFile,
            timestamp: new Date().toISOString(),
        });

        connectedClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(updateMessage);
            }
        });
    } catch (error: any) {
        console.error('[ERROR] Error broadcasting project changes:', error);
    } finally {
        isGetProjectsRunning = false;
    }
}

const app = createBackendApp();
const server = http.createServer(app);

const ptySessionsMap = new Map();
const runtimeContext: ServerRuntimeContext = createServerRuntimeContext({
    connectedClients,
    chatClientUsers,
    recentChatRequestIds,
    pendingProjectListInvalidations,
    ptySessionsMap,
});
const providerWatcherController = createProviderWatcherController({
    PROVIDER_WATCH_PATHS,
    WATCHER_IGNORED_PATTERNS,
    clearProjectDirectoryCache,
    deleteProviderSessionIndexFile,
    indexProviderSessionFile,
    resolveProviderSessionChange,
    broadcastSessionChanged,
    broadcastWorkflowChanged,
    attachWorkflowMetadata,
    getProjects,
    ensureGoRunnerWatchersForProjects,
});
const watchGoWorkflowRun = providerWatcherController.watchGoWorkflowRun;
const setupProjectsWatcher = providerWatcherController.setupProjectsWatcher;
const setupGoRunnerWatchers = providerWatcherController.setupGoRunnerWatchers;
const closeProjectsWatchers = providerWatcherController.closeProjectsWatchers;
const closeGoRunnerWatchers = providerWatcherController.closeGoRunnerWatchers;
let sessionPathScanIntervalHandle: NodeJS.Timeout | null = null;
const PTY_SESSION_TIMEOUT = 30 * 60 * 1000;
const SHELL_URL_PARSE_BUFFER_LIMIT = 32768;
const ANSI_ESCAPE_SEQUENCE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const TRAILING_URL_PUNCTUATION_REGEX = /[)\]}>.,;:!?]+$/;

const TRUSTED_CORS_ORIGINS = new Set(
  (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((entry) => String(entry).trim())
    .filter(Boolean)
);

const isAllowedCorsOrigin = (origin: string | undefined) => {
  if (!origin) {
    return true;
  }

  const normalized = String(origin).trim();
  if (!normalized) {
    return false;
  }

  if (TRUSTED_CORS_ORIGINS.has(normalized)) {
    return true;
  }

  const loopbackOrigin = /^https?:\/\/(localhost|127\\.0\\.0\\.1)(:\d+)?$/i;
  return loopbackOrigin.test(normalized);
};

function stripAnsiSequences(value = ''): string {
    return value.replace(ANSI_ESCAPE_SEQUENCE_REGEX, '');
}

function normalizeDetectedUrl(url: string): string | null {
    if (!url || typeof url !== 'string') return null;

    const cleaned = url.trim().replace(TRAILING_URL_PUNCTUATION_REGEX, '');
    if (!cleaned) return null;

    try {
        const parsed = new URL(cleaned);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

function extractUrlsFromText(value = ''): string[] {
    const directMatches = value.match(/https?:\/\/[^\s<>"'`\\\x1b\x07]+/gi) || [];

    // Handle wrapped terminal URLs split across lines by terminal width.
    const wrappedMatches: string[] = [];
    const continuationRegex = /^[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/;
    const lines = value.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const startMatch = line.match(/https?:\/\/[^\s<>"'`\\\x1b\x07]+/i);
        if (!startMatch) continue;

        let combined = startMatch[0];
        let j = i + 1;
        while (j < lines.length) {
            const continuation = lines[j].trim();
            if (!continuation) break;
            if (!continuationRegex.test(continuation)) break;
            combined += continuation;
            j++;
        }

        wrappedMatches.push(combined.replace(/\r?\n\s*/g, ''));
    }

    return Array.from(new Set([...directMatches, ...wrappedMatches]));
}

function shouldAutoOpenUrlFromOutput(value = '') {
    const normalized = value.toLowerCase();
    return (
        normalized.includes('browser didn\'t open') ||
        normalized.includes('open this url') ||
        normalized.includes('continue in your browser') ||
        normalized.includes('press enter to open') ||
        normalized.includes('open_url:')
    );
}

// Single WebSocket server that handles both paths
const chatWebSocketDeps = {
    connectedClients: runtimeContext.connectedClients,
    chatClientUsers: runtimeContext.chatClientUsers,
    broadcastChatEvent,
    bindManualSessionProvider,
    finalizeManualSessionRoute,
    getManualSessionRouteRuntime,
    initManualSessionRoute,
    acceptChatRequestId,
    resolveChatProjectOptions,
    extractProjectDirectory,
    resolveCbwSessionStartContext,
    resolveCbwRouteSessionIdFromProviderSession,
    getSessionModelState,
    sendNativeMessage,
    sendMessageAccepted,
    abortNativeSession,
    broadcastSessionModelStateUpdated,
    isCbwRouteSessionId,
    normalizeManualProvider,
    getNativeSessionStatus,
    getActiveNativeSessions,
};
const shellWebSocketDeps = {
    ptySessionsMap: runtimeContext.ptySessionsMap,
    PTY_SESSION_TIMEOUT,
    SHELL_URL_PARSE_BUFFER_LIMIT,
    stripAnsiSequences,
    normalizeDetectedUrl,
    extractUrlsFromText,
    shouldAutoOpenUrlFromOutput,
    os,
    pty,
    WebSocket,
};

const wss = new WebSocketServer({
    server,
    verifyClient: (info: any) => {
        console.log('WebSocket connection attempt to:', info.req.url);

        // Platform mode: always allow connection
        if (IS_PLATFORM) {
            const user = authenticateWebSocket(undefined, info.req); // Will return first user
            if (!user) {
                console.log('[WARN] Platform mode: No user found in database');
                return false;
            }
            info.req.user = user;
            console.log('[OK] Platform mode WebSocket authenticated for user:', user.username);
            return true;
        }

        // Normal mode: verify token
        const token = getWebSocketAuthToken(info.req);

        // Verify token
        const user = authenticateWebSocket(token || undefined, info.req);
        if (!user) {
            console.log('[WARN] WebSocket authentication failed');
            return false;
        }

        // Store user info in the request for later use
        info.req.user = user;
        console.log('[OK] WebSocket authenticated for user:', user.username);
        return true;
    }
});

// Make WebSocket server available to routes
app.locals.wss = wss;

configureAppMiddleware({ app, cors, express, installMode, isAllowedCorsOrigin, validateApiKey });

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// Projects API Routes (protected)
app.use('/api/projects', authenticateToken, projectsRoutes);

// MCP API Routes (protected)
app.use('/api/mcp', authenticateToken, mcpRoutes);

// MCP utilities
app.use('/api/mcp-utils', authenticateToken, mcpUtilsRoutes);

// Commands API Routes (protected)
app.use('/api/commands', authenticateToken, commandsRoutes);

// Settings API Routes (protected)
app.use('/api/settings', authenticateToken, settingsRoutes);

app.get('/api/diagnostics/runtime-dependencies', authenticateToken, async (req, res) => {
    /**
     * PURPOSE: Expose one runtime readiness report for workflow and agent CLIs
     * without allowing request-time PATH overrides.
     */
    const diagnostics = await buildRuntimeReadinessReport();
    res.json(diagnostics);
});

/**
 * Resolve Codex CLI path for agent status checks.
 */
function getCodexCliPath() {
    try {
        return resolveCodexCliPath();
    } catch {
        return '';
    }
}

app.get('/api/agents/status', authenticateToken, async (_req, res) => {
    /**
     * PURPOSE: Return account/auth/model status for each agent provider so
     * the agents settings tab can show real diagnostics instead of static text.
     */
    const codexStatus: LooseRecord = { authenticated: false, defaultModel: '', modelSource: '', apiKeySet: false, cliAvailable: false };
    const piStatus: LooseRecord & { providers: string[] } = { authenticated: false, defaultModel: '', defaultProvider: '', providers: [], cliAvailable: false };

    // --- Codex ---
    // 优先检测账号登录（OAuth token），其次检测 API Key
    const codexAuth = await checkCodexCredentials();
    codexStatus.authenticated = codexAuth.authenticated;
    codexStatus.email = codexAuth.email || '';
    codexStatus.loginMethod = codexAuth.authenticated
        ? (codexAuth.email === 'API Key Auth' ? 'api_key' : 'oauth')
        : null;

    const codexApiKey = (process.env.OPENAI_API_KEY || '').trim();
    codexStatus.apiKeySet = Boolean(codexApiKey);

    // 如果 OAuth 未登录但有 API Key，也视为已认证
    if (!codexStatus.authenticated && codexStatus.apiKeySet) {
        codexStatus.authenticated = true;
        codexStatus.loginMethod = 'api_key';
        codexStatus.email = 'API Key Auth';
    }

    try {
        const codexCliPath = getCodexCliPath();
        codexStatus.cliAvailable = Boolean(codexCliPath) && codexCliPath !== 'codex';
    } catch {
        codexStatus.cliAvailable = false;
    }

    // 获取默认模型（无论通过 OAuth 还是 API Key 认证）
    try {
        const catalog = await getCodexModelCatalog();
        if (catalog?.defaultModel) {
            codexStatus.defaultModel = catalog.defaultModel;
            codexStatus.modelSource = catalog.source || '';
        }
    } catch {
        // model discovery failed
    }

    // --- Pi ---
    const piSettingsPath = path.join(os.homedir(), '.pi', 'agent', 'settings.json');
    const piAuthPath = path.join(os.homedir(), '.pi', 'agent', 'auth.json');
    try {
        const settingsRaw = await fsPromises.readFile(piSettingsPath, 'utf8');
        const settings = JSON.parse(settingsRaw);
        piStatus.defaultModel = settings.defaultModel || '';
        piStatus.defaultProvider = settings.defaultProvider || '';
    } catch {
        // settings.json not found or invalid
    }

    try {
        const authRaw = await fsPromises.readFile(piAuthPath, 'utf8');
        const auth = JSON.parse(authRaw);
        piStatus.providers = Object.keys(auth).filter((k) => auth[k]?.type === 'api_key');
        piStatus.authenticated = piStatus.providers.length > 0;
    } catch {
        // auth.json not found or invalid
    }

    piStatus.cliAvailable = piStatus.authenticated;

    res.json({ codex: codexStatus, pi: piStatus });
});

// CLI Authentication API Routes (protected)
app.use('/api/cli', authenticateToken, cliAuthRoutes);

// User API Routes (protected)
app.use('/api/user', authenticateToken, userRoutes);

// Codex API Routes (protected)
app.use('/api/codex', authenticateToken, codexRoutes);

app.get('/api/pi/models', authenticateToken, async (req, res) => {
    try {
        const catalog = await getPiModelCatalog();
        res.json({ success: true, models: catalog.models });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Agent API Routes (uses API key authentication)
app.use('/api/agent', agentRoutes);

registerStaticAssets({ app, express, path, PKG_ROOT });

// API Routes (protected)
// /api/config endpoint removed - no longer needed
// Frontend now uses window.location for WebSocket URLs

// System update endpoint
app.post('/api/system/update', authenticateToken, async (req, res) => {
    try {
        // Get the project root directory (parent of server directory)
        const projectRoot = PKG_ROOT;

        console.log('Starting system update from directory:', projectRoot);

        // Run the update command based on install mode
        const updateCommand = installMode === 'git'
            ? 'git checkout main && git pull && pnpm install'
            : 'npm install -g ozw@latest';

        const child = spawn('sh', ['-c', updateCommand], {
            cwd: installMode === 'git' ? projectRoot : os.homedir(),
            env: process.env
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            console.log('Update output:', text);
        });

        child.stderr.on('data', (data) => {
            const text = data.toString();
            errorOutput += text;
            console.error('Update error:', text);
        });

        child.on('close', (code) => {
            if (code === 0) {
                res.json({
                    success: true,
                    output: output || 'Update completed successfully',
                    message: 'Update completed. Please restart the server to apply changes.'
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Update command failed',
                    output: output,
                    errorOutput: errorOutput
                });
            }
        });

        child.on('error', (error) => {
            console.error('Update process error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        });

    } catch (error: any) {
        console.error('System update error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const projectSummaries = await heavyReadCoalescer.run('projects:list', async () => {
            const projects = await getProjects(broadcastProgress, { lightweightList: true });
            return projects.map(summarizeProjectForList);
        });
        res.json(projectSummaries);

        void ensureGoRunnerWatchersForProjects(projectSummaries, watchGoWorkflowRun).catch((error: any) => {
            console.warn('[projects] Background watcher registration failed:', error?.message || error);
        });
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/overview', authenticateToken, async (req, res) => {
    try {
        const scopeProjectPath = typeof req.query?.projectPath === 'string' ? req.query.projectPath.trim() : '';
        const overview = await heavyReadCoalescer.run(`projects:overview:${scopeProjectPath || req.params.projectName}`, async () => {
            const project = await resolveProjectOverviewTarget(
                String(req.params.projectName || ''),
                req.query?.projectPath,
            );
            if (!project) {
                return null;
            }

            return buildProjectOverviewReadModel(project, {
                summarizeProjectForList,
                attachWorkflowMetadata,
                getCodexSessions,
                getPiSessions,
            });
        });
        if (!overview) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json(overview);

        void ensureGoRunnerWatchersForProjects([overview], watchGoWorkflowRun).catch((error: any) => {
            console.warn('[projects:overview] Background watcher registration failed:', error?.message || error);
        });
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/workflows', authenticateToken, async (req, res) => {
    try {
        const workflows = await heavyReadCoalescer.run(`projects:workflows:${req.params.projectName}`, async () => {
            // Resolve only the requested project; the sidebar summary endpoint
            // already watches all discovered projects after /api/projects.
            const projectPath = await extractProjectDirectory(req.params.projectName);
            try {
                const stat = await fsPromises.stat(projectPath);
                if (!stat.isDirectory()) {
                    return null;
                }
            } catch {
                return null;
            }
            return (await listProjectWorkflows(projectPath)).map(summarizeWorkflowForProjectList);
        });
        if (!workflows) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json(workflows);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Resolve a project-scoped workflow request to an existing project directory.
 */
async function resolveExistingWorkflowProjectPath(projectName: string, requestedProjectPath = '') {
    /**
     * PURPOSE: Support both reversible legacy project names and live-only
     * project route identifiers whose synthetic names cannot be decoded.
     */
    const normalizedRequestedPath = typeof requestedProjectPath === 'string' ? requestedProjectPath.trim() : '';
    if (normalizedRequestedPath) {
        try {
            const stat = await fsPromises.stat(normalizedRequestedPath);
            if (stat.isDirectory()) {
                return normalizedRequestedPath;
            }
        } catch {
            // Fall through to legacy name resolution and project-list lookup.
        }
    }

    const extractedPath = await extractProjectDirectory(projectName);
    try {
        const stat = await fsPromises.stat(extractedPath);
        if (stat.isDirectory()) {
            return extractedPath;
        }
    } catch {
        // Fall through to the authoritative project list mapping.
    }

    const projects = await getProjects();
    const matchedProject = projects.find((project) => (
        project.name === projectName
        || project.routePath === projectName
        || project.fullPath === projectName
        || project.path === projectName
    ));
    const projectPath = matchedProject?.fullPath || matchedProject?.path || '';
    if (!projectPath) {
        return '';
    }
    try {
        const stat = await fsPromises.stat(projectPath);
        return stat.isDirectory() ? projectPath : '';
    } catch {
        return '';
    }
}

app.post('/api/projects/:projectName/workflows', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const workflow = await createProjectWorkflow(project, {
            title: req.body?.title,
            objective: req.body?.objective,
            openspecChangeName: req.body?.openspecChangeName,
        });
        await watchGoWorkflowRun(project, workflow);
        void broadcastProjectListInvalidated({ reason: 'workflow-create', changedProjectPath: project.fullPath || project.path || '' });
        res.status(201).json(workflow);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/openspec/changes', authenticateToken, async (req, res) => {
    try {
        // Lightweight path resolution: avoid full getProjects() + attachWorkflowMetadata()
        // which scans all provider sessions across every project (~2.7s overhead).
        const requestedProjectPath = typeof req.query?.projectPath === 'string'
            ? req.query.projectPath.trim()
            : '';
        const projectPath = requestedProjectPath || await extractProjectDirectory(req.params.projectName);
        // Validate the resolved path points to a real project directory.
        // extractProjectDirectory can map arbitrary strings to paths via the
        // dash-to-slash fallback; unknown project names must still return 404.
        try {
            const stat = await fsPromises.stat(projectPath);
            if (!stat.isDirectory()) {
                return res.status(404).json({ error: 'Project not found' });
            }
        } catch {
            return res.status(404).json({ error: 'Project not found' });
        }
        const changes = await listProjectAdoptableOpenSpecChanges({ fullPath: projectPath, name: req.params.projectName });
        res.json({ changes });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/workflows/:workflowId', authenticateToken, async (req, res) => {
    try {
        const workflow = await heavyReadCoalescer.run(
            `projects:workflow:${req.params.projectName}:${req.params.workflowId}`,
            async () => {
                const projectPath = await resolveExistingWorkflowProjectPath(
                    String(req.params.projectName),
                    typeof req.query?.projectPath === 'string' ? req.query.projectPath : '',
                );
                if (!projectPath) {
                    return { missingProject: true };
                }

                const project = { name: req.params.projectName, fullPath: projectPath, path: projectPath };
                return getProjectWorkflow(project, req.params.workflowId);
            },
        );
        if ((workflow as LooseRecord)?.missingProject) {
            return res.status(404).json({ error: 'Project not found' });
        }
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json(workflow);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/workflows/:workflowId/resume-run', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const workflow = await resumeWorkflowRun(project, req.params.workflowId);
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        await watchGoWorkflowRun(project, workflow);
        res.json({ success: true, workflow });
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/workflows/:workflowId/abort-run', authenticateToken, async (req, res) => {
    try {
        const projects = await attachWorkflowMetadata(await getProjects());
        const project = findProjectByName(projects, req.params.projectName);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const workflow = await abortWorkflowRun(project, req.params.workflowId);
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json({ success: true, workflow });
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/sessions', authenticateToken, async (req, res) => {
    res.status(410).json({ error: 'Claude sessions are no longer supported' });
});

// Get messages for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/messages', authenticateToken, handleGetSessionMessages);

// Search across visible chat history messages for supported provider sessions.
app.get('/api/chat/search', authenticateToken, async (req, res) => {
    try {
        const query = typeof req.query.q === 'string' ? req.query.q : '';
        const mode = req.query.mode === 'jsonl' ? 'jsonl' : 'content';
        const results = await heavyReadCoalescer.run(
            `search:chat:${mode}:${query.trim()}`,
            async () => searchChatHistory(query, mode),
        );
        res.json({ success: true, results });
    } catch (error: any) {
        console.error('Error searching chat history:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rename project endpoint
app.put('/api/projects/:projectName/rename', authenticateToken, async (req, res) => {
    try {
        const { displayName, projectPath } = req.body;
        const oldProjectPath = await extractProjectDirectory(req.params.projectName);
        await renameProject(req.params.projectName, displayName, projectPath);
        void broadcastProjectListInvalidated({ reason: 'project-rename', changedProjectPath: oldProjectPath });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Rename chat session endpoint
app.put('/api/projects/:projectName/sessions/:sessionId/rename', authenticateToken, async (req, res) => {
    try {
        const { summary, projectPath } = req.body;
        if (typeof summary !== 'string' || !summary.trim()) {
            return res.status(400).json({ error: 'Session summary is required' });
        }

        await renameSession(req.params.projectName, req.params.sessionId, summary, typeof projectPath === 'string' ? projectPath : '');
        void broadcastProjectListInvalidated({ reason: 'session-rename', changedProjectPath: await extractProjectDirectory(req.params.projectName) });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/projects/:projectName/sessions/:sessionId/ui-state', authenticateToken, async (req, res) => {
    try {
        const provider = normalizeManualProvider(req.body?.provider || 'codex');
        const projectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath.trim() : '';
        const state = await updateSessionUiState(req.params.projectName, req.params.sessionId, provider, {
            favorite: req.body?.favorite === true,
            pending: req.body?.pending === true,
            hidden: req.body?.hidden === true,
        }, projectPath);
        void broadcastProjectListInvalidated({
            reason: 'session-ui-state',
            changedProjectPath: projectPath || await extractProjectDirectory(req.params.projectName),
        });
        res.json({ success: true, state });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Resolve the project config path used for session-scoped control state.
 */
async function resolveSessionModelProjectPath(projectName: string, candidatePath = '') {
    if (typeof candidatePath === 'string' && candidatePath.trim()) {
        return candidatePath.trim();
    }
    return extractProjectDirectory(projectName);
}

app.get('/api/projects/:projectName/sessions/:sessionId/model-state', authenticateToken, async (req, res) => {
    try {
        const projectPath = await resolveSessionModelProjectPath(
            String(req.params.projectName),
            typeof req.query?.projectPath === 'string' ? req.query.projectPath : '',
        );
        const state = await (getSessionModelState as any)(projectPath, String(req.params.sessionId));
        res.json({ success: true, state });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/projects/:projectName/sessions/:sessionId/model-state', authenticateToken, async (req, res) => {
    try {
        const projectPath = await resolveSessionModelProjectPath(
            String(req.params.projectName),
            typeof req.body?.projectPath === 'string' ? req.body.projectPath : '',
        );
        const state = await (updateSessionModelState as any)(projectPath, String(req.params.sessionId), {
            model: typeof req.body?.model === 'string' ? req.body.model : '',
            reasoningEffort: typeof req.body?.reasoningEffort === 'string' ? req.body.reasoningEffort : '',
            thinkingLevel: typeof req.body?.thinkingLevel === 'string' ? req.body.thinkingLevel : '',
            thinkingMode: typeof req.body?.thinkingMode === 'string' ? req.body.thinkingMode : '',
        });
        broadcastSessionModelStateUpdated({
            sourceUserId: req.user?.id || null,
            projectName: req.params.projectName,
            projectPath,
            sessionId: req.params.sessionId,
            provider: normalizeManualProvider(req.body?.provider || 'codex'),
            state,
        });
        res.json({ success: true, state });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/manual-sessions', authenticateToken, async (req, res) => {
    try {
        const provider = normalizeManualProvider(req.body?.provider);
        const label = typeof req.body?.label === 'string' ? req.body.label : '';
        const projectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath : '';
        const workflowId = typeof req.body?.workflowId === 'string' ? req.body.workflowId : '';
        const stageKey = typeof req.body?.stageKey === 'string' ? req.body.stageKey : '';
        const routeIndex = Number(req.body?.routeIndex);

        if (!label.trim()) {
            return res.status(400).json({ error: 'Session label is required' });
        }

        const session = await createManualSessionDraft(req.params.projectName, projectPath, provider, label, {
            workflowId,
            stageKey,
            routeIndex: Number.isInteger(routeIndex) && routeIndex > 0 ? routeIndex : undefined,
        });
        res.json({ success: true, session });
    } catch (error: any) {
        const status = /provider must/.test(error.message) ? 400 : 500;
        res.status(status).json({ error: error.message });
    }
});

app.post('/api/projects/:projectName/manual-sessions/:sessionId/finalize', authenticateToken, async (req, res) => {
    try {
        const provider = normalizeManualProvider(req.body?.provider);
        const actualSessionId = typeof req.body?.actualSessionId === 'string' ? req.body.actualSessionId : '';

        if (!actualSessionId.trim()) {
            return res.status(400).json({ error: 'Actual session ID is required' });
        }

        const finalized = await finalizeManualSessionRoute(
            req.params.projectName,
            req.params.sessionId,
            actualSessionId,
            provider,
            typeof req.body?.projectPath === 'string' ? req.body.projectPath : '',
        );
        res.json({ success: true, finalized });
    } catch (error: any) {
        const status = /provider must/.test(error.message) ? 400 : 500;
        res.status(status).json({ error: error.message });
    }
});

// Get provider-level usage remaining metrics for UI status display.
app.get('/api/usage/remaining', authenticateToken, async (req, res) => {
    try {
        const provider = normalizeManualProvider(req.query.provider || 'codex');
        const usageRemaining = await getUsageRemaining(provider);
        res.json(usageRemaining);
    } catch (error: any) {
        console.error('Error reading usage remaining:', error);
        res.status(500).json({ error: 'Failed to read usage remaining' });
    }
});

// Delete session endpoint
app.delete('/api/projects/:projectName/sessions/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const provider = req.query.provider ? normalizeManualProvider(req.query.provider) : null;
        console.log(`[API] Deleting session: ${sessionId} from project: ${projectName}`);
        const sessionProjectPath = await extractProjectDirectory(projectName);
        await (deleteSession as any)(projectName, sessionId, provider);
        console.log(`[API] Session ${sessionId} deleted successfully`);
        void broadcastProjectListInvalidated({ reason: 'session-delete', changedProjectPath: sessionProjectPath });
        res.json({ success: true });
    } catch (error: any) {
        console.error(`[API] Error deleting session ${req.params.sessionId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Delete project endpoint (force=true to delete with sessions)
app.delete('/api/projects/:projectName', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const force = req.query.force === 'true';
        const deletedProjectPath = await extractProjectDirectory(projectName);
        await deleteProject(projectName, force);
        void broadcastProjectListInvalidated({ reason: 'project-delete', changedProjectPath: deletedProjectPath });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Create project endpoint
app.post('/api/projects/create', authenticateToken, async (req, res) => {
    try {
        const { path: projectPath } = req.body;

        if (!projectPath || !projectPath.trim()) {
            return res.status(400).json({ error: 'Project path is required' });
        }

        const project = await addProjectManually(projectPath.trim());
        void broadcastProjectListInvalidated({ reason: 'project-create', changedProjectPath: projectPath.trim() });
        res.json({ success: true, project });
    } catch (error: any) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: error.message });
    }
});

registerFileRoutes({
    app, authenticateToken, path, fs, fsPromises, WORKSPACES_ROOT, validateWorkspacePath,
    resolveProjectRootWithHint, resolveReadableProjectPath, resolveProjectPath, buildMutationResponse,
    joinProjectChildPath, sanitizeEntryName, sanitizeUploadRelativePath, createDirectoryArchive,
    sendDownload, withLoggedFallback, classifyProjectFile, TEXT_SAMPLE_BYTES, mime,
});

// WebSocket connection handler that routes based on URL path
wss.on('connection', (ws, request) => {
    const url = request.url;
    console.log('[INFO] Client connected to:', url);

    // Parse URL to get pathname without query parameters
    const urlObj = new URL(url || '/', 'http://localhost');
    const pathname = urlObj.pathname;

    if (pathname === '/shell') {
        handleShellConnection(shellWebSocketDeps, ws);
    } else if (pathname === '/ws') {
        handleChatConnection(chatWebSocketDeps, ws, request);
    } else {
        console.log('[WARN] Unknown WebSocket path:', pathname);
        ws.close();
    }
});




// Audio transcription endpoint
app.post('/api/transcribe', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const upload = multer({ storage: multer.memoryStorage() });

        // Handle multipart form data
        upload.single('audio')(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: 'Failed to process audio file' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'No audio file provided' });
            }

            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                return res.status(500).json({ error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in server environment.' });
            }

            try {
                // Create form data for OpenAI
                const FormData = (await (Function('return import(\'form-data\')')() as Promise<any>)).default;
                const formData = new FormData();
                formData.append('file', req.file.buffer, {
                    filename: req.file.originalname,
                    contentType: req.file.mimetype
                });
                formData.append('model', 'whisper-1');
                formData.append('response_format', 'json');
                formData.append('language', 'en');

                // Make request to OpenAI
                const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        ...formData.getHeaders()
                    },
                    body: formData
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error?.message || `Whisper API error: ${response.status}`);
                }

                const data = await response.json();
                let transcribedText = data.text || '';

                // Check if enhancement mode is enabled
                const mode = req.body.mode || 'default';

                // If no transcribed text, return empty
                if (!transcribedText) {
                    return res.json({ text: '' });
                }

                // If default mode, return transcribed text without enhancement
                if (mode === 'default') {
                    return res.json({ text: transcribedText });
                }

                // Handle different enhancement modes
                try {
                    const OpenAI = (await (Function('return import(\'openai\')')() as Promise<any>)).default;
                    const openai = new OpenAI({ apiKey });

                    let prompt, systemMessage, temperature = 0.7, maxTokens = 800;

                    switch (mode) {
                        case 'prompt':
                            systemMessage = 'You are an expert prompt engineer who creates clear, detailed, and effective prompts.';
                            prompt = `You are an expert prompt engineer. Transform the following rough instruction into a clear, detailed, and context-aware AI prompt.

Your enhanced prompt should:
1. Be specific and unambiguous
2. Include relevant context and constraints
3. Specify the desired output format
4. Use clear, actionable language
5. Include examples where helpful
6. Consider edge cases and potential ambiguities

Transform this rough instruction into a well-crafted prompt:
"${transcribedText}"

Enhanced prompt:`;
                            break;

                        case 'vibe':
                        case 'instructions':
                        case 'architect':
                            systemMessage = 'You are a helpful assistant that formats ideas into clear, actionable instructions for AI agents.';
                            temperature = 0.5; // Lower temperature for more controlled output
                            prompt = `Transform the following idea into clear, well-structured instructions that an AI agent can easily understand and execute.

IMPORTANT RULES:
- Format as clear, step-by-step instructions
- Add reasonable implementation details based on common patterns
- Only include details directly related to what was asked
- Do NOT add features or functionality not mentioned
- Keep the original intent and scope intact
- Use clear, actionable language an agent can follow

Transform this idea into agent-friendly instructions:
"${transcribedText}"

Agent instructions:`;
                            break;

                        default:
                            // No enhancement needed
                            break;
                    }

                    // Only make GPT call if we have a prompt
                    if (prompt) {
                        const completion = await openai.chat.completions.create({
                            model: 'gpt-4o-mini',
                            messages: [
                                { role: 'system', content: systemMessage },
                                { role: 'user', content: prompt }
                            ],
                            temperature: temperature,
                            max_tokens: maxTokens
                        });

                        transcribedText = completion.choices[0].message.content || transcribedText;
                    }

                } catch (gptError: any) {
                    console.error('GPT processing error:', gptError);
                    // Fall back to original transcription if GPT fails
                }

                res.json({ text: transcribedText });

            } catch (error: any) {
                console.error('Transcription error:', error);
                res.status(500).json({ error: error.message });
            }
        });
    } catch (error: any) {
        console.error('Endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Chat attachment upload endpoint
app.post('/api/projects/:projectName/upload-attachments', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const uploadRoot = path.join(CHAT_UPLOAD_ROOT, String((req.user as any).id), '.incoming');

        await fsPromises.mkdir(uploadRoot, { recursive: true });

        /**
         * PURPOSE: Stage raw browser uploads in a temporary directory before we
         * move them into the final per-message batch tree under ~/ozw-uploads.
         */
        const storage = multer.diskStorage({
            destination: async (_request, _file, cb) => {
                cb(null, uploadRoot);
            },
            filename: (_request, file, cb) => {
                const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
                cb(null, `${uniqueSuffix}-${sanitizeFilename(file.originalname)}`);
            }
        });

        const upload = multer({
            storage,
            limits: {
                fileSize: 25 * 1024 * 1024,
                files: 100
            }
        });

        upload.array('attachments', 100)(req, res, async (err) => {
            let uploadedFiles: any[] = [];
            if (err) {
                return res.status(400).json({ error: err.message });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No attachment files provided' });
            }

            try {
                let parsedRelativePaths = null;
                if (typeof req.body.relativePaths === 'string' && req.body.relativePaths) {
                    parsedRelativePaths = JSON.parse(req.body.relativePaths);
                    if (!Array.isArray(parsedRelativePaths) || parsedRelativePaths.length !== req.files.length) {
                        return res.status(400).json({ error: 'relativePaths must match uploaded files' });
                    }
                }

                uploadedFiles = Array.isArray(req.files) ? req.files : [];
                const persistedBatch = await persistChatUploads(uploadedFiles, {
                    relativePaths: parsedRelativePaths,
                    userId: (req.user as any).id,
                });

                res.json({
                    rootPath: persistedBatch.rootPath,
                    attachments: persistedBatch.attachments,
                });
            } catch (error: any) {
                console.error('Error processing chat attachments:', error);
                await Promise.all(uploadedFiles.map((file: any) => withLoggedFallback(fsPromises.unlink(file.path), undefined, 'cleanup failed chat attachment upload')));
                res.status(500).json({ error: 'Failed to process chat attachments' });
            }
        });
    } catch (error: any) {
        console.error('Error in chat attachment upload endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get token usage for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/token-usage', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const { provider = 'codex' } = req.query;
        const homeDir = os.homedir();

        // Allow only safe characters in sessionId
        const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
        if (!safeSessionId) {
            return res.status(400).json({ error: 'Invalid sessionId' });
        }

        const parsedContextWindow = parseInt(process.env.CONTEXT_WINDOW || '', 10);
        const contextWindow = Number.isFinite(parsedContextWindow) ? parsedContextWindow : 160000;

        if (provider === 'codex') {
            const tokenUsage = await getCodexSessionTokenUsage(safeSessionId, { homeDir });
            if (!tokenUsage) {
                return res.status(204).send();
            }
            return res.json(tokenUsage);
        }

        res.status(410).json({ error: 'Claude sessions are no longer supported' });
    } catch (error: any) {
        console.error('Error reading session token usage:', error);
        res.status(500).json({ error: 'Failed to read session token usage' });
    }
});

registerSpaFallback({ app, fs, path, PKG_ROOT, shouldServeSpaIndex });

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
// Show localhost in URL when binding to all interfaces (0.0.0.0 isn't a connectable address)
const DISPLAY_HOST = HOST === '0.0.0.0' ? 'localhost' : HOST;

function clearSessionScanInterval() {
    if (sessionPathScanIntervalHandle) {
        clearInterval(sessionPathScanIntervalHandle);
        sessionPathScanIntervalHandle = null;
    }
}

/**
 * Terminate cached PTY sessions so no shell children survive service shutdown.
 */
function closePtySessions() {
    closeShellPtySessions(runtimeContext);
}

/**
 * Close all live WebSocket clients and stop accepting new upgrade requests.
 */
async function closeWebSocketServer() {
    connectedClients.forEach((client) => {
        try {
            if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
                client.close(1001, 'Server shutting down');
            }
        } catch (error: any) {
            console.error('[WARN] Failed to close chat WebSocket client:', error);
        }
    });

    for (const client of wss.clients) {
        try {
            if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
                client.close(1001, 'Server shutting down');
            }
        } catch (error: any) {
            console.error('[WARN] Failed to close WebSocket client:', error);
        }
    }

    await new Promise<void>((resolve) => {
        wss.close(() => resolve());
    });
}

/**
 * Stop the HTTP server, WebSocket server, watchers, timers, and cached PTYs.
 */
async function shutdownServer(signal = 'SIGTERM') {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    console.log(`[INFO] Received ${signal}, starting graceful shutdown`);

    clearSessionScanInterval();
    await closeProjectsWatchers();
    await closeGoRunnerWatchers();
    closePtySessions();
    await closeWebSocketServer();

    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });

    console.log('[INFO] Graceful shutdown complete');
}

process.on('SIGINT', async () => {
    try {
        await shutdownServer('SIGINT');
        process.exit(0);
    } catch (error: any) {
        console.error('[ERROR] Graceful shutdown failed:', error);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    try {
        await shutdownServer('SIGTERM');
        process.exit(0);
    } catch (error: any) {
        console.error('[ERROR] Graceful shutdown failed:', error);
        process.exit(1);
    }
});

// Initialize database and start server
async function startServer() {
    try {
        // Ensure required external binaries are available in PATH
        checkRequiredRuntimeDependencies();

        // Initialize authentication database
        await initializeDatabase();

        // Clean up legacy co state on startup
        try {
            const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
            const result = await removeLegacyCoState({ stateHome });
            if (result.removed) {
                console.log(`${c.info('[INFO]')} Removed legacy co state: ${c.dim(result.path)}`);
            }
        } catch (cleanupError: any) {
            console.warn(`${c.warn('[WARN]')} Legacy co cleanup failed:`, cleanupError.message);
        }

        // Check if running in production mode (dist folder exists)
        const distIndexPath = path.join(PKG_ROOT, 'dist/index.html');
        const isProduction = fs.existsSync(distIndexPath);

        console.log(`${c.info('[INFO]')} Native agent runtime ready (Codex SDK + Pi SDK)`);
        console.log(`${c.info('[INFO]')} Running in ${c.bright(isProduction ? 'PRODUCTION' : 'DEVELOPMENT')} mode`);

        if (!isProduction) {
            console.log(`${c.warn('[WARN]')} Note: Requests will be proxied to Vite dev server at ${c.dim('http://localhost:' + (process.env.VITE_PORT || 5173))}`);
        }

        server.listen(PORT, HOST, async () => {
            const appInstallPath = PKG_ROOT;

            console.log('');
            console.log(c.dim('═'.repeat(63)));
            console.log(`  ${c.bright('ozw Server - Ready')}`);
            console.log(c.dim('═'.repeat(63)));
            console.log('');
            console.log(`${c.info('[INFO]')} Server URL:  ${c.bright('http://' + DISPLAY_HOST + ':' + PORT)}`);
            console.log(`${c.info('[INFO]')} Installed at: ${c.dim(appInstallPath)}`);
            console.log(`${c.tip('[TIP]')}  Run "ozw status" for full configuration details`);
            console.log('');

            try {
                await refreshMissingProjectPathCache({ logger: console });
            } catch (scanError: any) {
                console.error('[SessionVisibility] Startup scan failed:', scanError);
            }

            const scanIntervalMs = Number.parseInt(process.env.SESSION_PATH_SCAN_INTERVAL_MS || '', 10);
            if (Number.isFinite(scanIntervalMs) && scanIntervalMs > 0) {
                sessionPathScanIntervalHandle = setInterval(async () => {
                    try {
                        await refreshMissingProjectPathCache({ logger: console });
                    } catch (scanError: any) {
                        console.error('[SessionVisibility] Periodic scan failed:', scanError);
                    }
                }, scanIntervalMs);
                console.info(`[SessionVisibility] Periodic scan enabled (${scanIntervalMs}ms)`);
            }

            console.info('[WorkflowAutoRunner] Disabled; oz flow is the workflow state machine.');

            try {
                // Start watching provider and Go runner output folders after the workflow runner is live.
                await setupProjectsWatcher();
                await setupGoRunnerWatchers();
            } catch (watcherError: any) {
                console.error('[ERROR] Failed to setup project watchers:', watcherError);
            }
        });
    } catch (error: any) {
        console.error('[ERROR] Failed to start server:', error);
        process.exit(1);
    }
}

/**
 * 启动完整 legacy 后端运行体。
 */
export async function startBackendServer() {
    await startServer();
}
