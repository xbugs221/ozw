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
import { WebSocket } from 'ws';
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
    getProviderSessionProjectPathForFile,
    countProviderSessionsForProject,
    getSessionMessages,
    getCodexSessions,
    getPiSessions,
    getCodexSessionMessages,
    searchChatHistory,
    renameProject,
    resolveSessionProviderId,
    updateSessionUiState,
    getSessionModelState,
    updateSessionModelState,
    renameSession,
    createManualSessionDraft,
    initManualSessionRoute,
    bindManualSessionProvider,
    getManualSessionRouteRuntime,
    finalizeManualSessionRoute,
    updateManualSessionTitleFromFirstRequest,
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
    getClaudeSessions,
} from '../projects.js';
import {
    buildProjectOverviewReadModel,
    summarizeProjectForList,
} from '../domains/projects/project-overview-read-model.js';
import { listUnscopedHermesSessions } from '../domains/projects/hermes-session-read-model.js';
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
import { db, initializeDatabase } from '../database/db.js';
import { validateApiKey, authenticateToken } from '../middleware/auth.js';
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
    attachIndexedWorkflowMetadata,
    attachWorkflowMetadata,
    abortWorkflowRun,
    createProjectWorkflow,
    findProjectByName,
    getProjectWorkflow,
    listProjectAdoptableOpenSpecChanges,
    listProjectWorkflows,
    resumeWorkflowRun,
    syncProjectWorkflowOverviewIndex,
    syncWorkflowOverviewIndexesForProjects,
    summarizeWorkflowForProjectList,
} from '../workflows.js';
import { buildRuntimeReadinessReport } from '../runtime-readiness.js';
import { getCodexModelCatalog } from '../codex-models.js';
import { getPiModelCatalog } from '../pi-models.js';
import { resolveCodexCliPath } from '../codex-cli.js';
import { ensureGoRunnerWatchersForProjects } from '../domains/workflows/go-runner-watchers.js';
import { shouldServeSpaIndex } from '../utils/spaFallback.js';
import { createScopedAsyncCoalescer } from '../utils/scopedAsyncCoalescer.js';
import { configureAppMiddleware, createBackendApp, registerSpaFallback, registerStaticAssets } from './app-factory.js';
import { registerBackendHttpRoutes } from './backend-http-routes.js';
import { registerDiagnosticsRoutes } from './http/diagnostics-routes.js';
import { registerSystemRoutes } from './http/system-routes.js';
import { createProviderWatcherController } from './provider-watchers.js';
import {
    backfillProjectIndex,
    hideProviderProjectIndex,
    reconcileHermesSessionIndex,
    upsertProjectIndexFromProviderSession,
} from '../domains/projects/project-index-sync-service.js';
import { createBroadcastRegistry } from './realtime/broadcast-registry.js';
import { createProjectInvalidationBus } from './realtime/project-invalidation-bus.js';
import { createRuntimeWriterAdapter } from './realtime/runtime-writer-adapter.js';
import { createSessionSubscriptionRegistry } from './realtime/session-subscription-registry.js';
import { createServerRuntimeContext, type ServerRuntimeContext } from './server-runtime-context.js';
import { closeShellPtySessions } from './shell-websocket.js';
import { printStartupBanner } from './startup-banner.js';
import { createWebSocketGateway } from './websocket-gateway.js';

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

    const project = (await getProjects()).find((candidate: any) => (
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
function normalizeManualProvider(provider: unknown): "codex" | "pi" | "claude" {
    if (provider === 'codex' || provider === 'pi' || provider === 'claude') {
        return provider;
    }
    throw new Error('provider must be "codex", "pi" or "claude"');
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
        const chatRecord = record as LooseRecord | undefined;
        if (
            providerMatches(chatRecord)
            && isManualBacked(chatRecord)
            && chatRecord?.providerSessionId === providerSessionId
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
    { provider: 'claude', rootPath: path.join(os.homedir(), '.claude', 'projects') },
    { provider: 'hermes', rootPath: process.env.HERMES_HOME || path.join(os.homedir(), '.hermes') },
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

let broadcastRegistry: any;
let projectInvalidationBus: any;
let sessionSubscriptionRegistry: any;

// Broadcast progress to all connected WebSocket clients
function broadcastProgress(progress: LooseRecord): void {
    broadcastRegistry.broadcastProgress(progress);
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
    projectInvalidationBus.invalidate({ reason, changedProjectPath });
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
    broadcastRegistry.broadcastSessionChanged({
        provider,
        projectPath,
        sessionId,
        ozwSessionId: ozwSessionId || undefined,
        providerSessionId: providerSessionId || undefined,
        sourceSessionId: sourceSessionId || undefined,
        changedFile,
        changeType,
    });
}

/**
 * Broadcast a workflow change for Go-runner state/log watchers so the
 * workflow detail pane can refresh without a full projects re-compute.
 */
function broadcastWorkflowChanged({ projectName, projectPath, runId, changeType = 'change' }: LooseRecord): void {
    broadcastRegistry.broadcastWorkflowChanged({
        projectName,
        projectPath,
        runId,
        changeType,
    });
}

/**
 * Keep a full-project-refresh escape hatch for manual reload, error recovery
 * and non-file-watcher triggers (e.g. config changes).  Provider file-change
 * watchers must NOT use this path — they go through session_changed / workflow_changed.
 */
async function broadcastProjectsUpdated({ changeType = 'change', changedFile = '', watchProvider = 'workflow' }: LooseRecord = {}): Promise<void> {
    await broadcastRegistry.broadcastProjectsUpdated({ changeType, changedFile, watchProvider });
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
sessionSubscriptionRegistry = createSessionSubscriptionRegistry();
const adaptRuntimeWriter = (writer: RuntimeWriter) => createRuntimeWriterAdapter(writer);
broadcastRegistry = createBroadcastRegistry({
    connectedClients,
    WebSocket,
    clearProjectDirectoryCache,
    isGetProjectsRunningRef: {
        get value() {
            return isGetProjectsRunning;
        },
        set value(nextValue: boolean) {
            isGetProjectsRunning = nextValue;
        },
    },
});
projectInvalidationBus = createProjectInvalidationBus({
    pendingProjectListInvalidations,
    debounceMs: PROJECT_INVALIDATION_DEBOUNCE_MS,
    publish: ({ reason = 'change', changedProjectPath = '' } = {}) => {
        if (isGetProjectsRunning) {
            return;
        }
        try {
            isGetProjectsRunning = true;
            clearProjectDirectoryCache();
            const scopeKey = `${reason}:${changedProjectPath}`;
            const updateMessage = {
                type: 'project_list_invalidated',
                scope: 'projects:list',
                version: `${Date.now()}:${scopeKey}`,
                reason,
                changedProjectPath,
                timestamp: new Date().toISOString(),
            };
            broadcastRegistry.broadcastProjectsUpdated({
                watchProvider: 'project-invalidation',
                changeType: reason,
                changedFile: changedProjectPath,
            });
            connectedClients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(updateMessage));
                }
            });
        } catch (error: any) {
            console.error('[ERROR] Error broadcasting project list invalidation:', error);
        } finally {
            isGetProjectsRunning = false;
        }
    },
});
const providerWatcherController = createProviderWatcherController({
    PROVIDER_WATCH_PATHS,
    WATCHER_IGNORED_PATTERNS,
    clearProjectDirectoryCache,
    deleteProviderSessionIndexFile,
    indexProviderSessionFile,
    getProviderSessionProjectPathForFile,
    countProviderSessionsForProject,
    upsertProjectIndexFromProviderSession,
    reconcileHermesSessionIndex,
    hideProviderProjectIndex,
    resolveProviderSessionChange,
    broadcastSessionChanged,
    broadcastWorkflowChanged,
    broadcastProjectListInvalidated,
    attachWorkflowMetadata,
    syncProjectWorkflowOverviewIndex,
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
    updateManualSessionTitleFromFirstRequest,
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
    createRuntimeWriterAdapter: adaptRuntimeWriter,
    sessionSubscriptionRegistry,
    broadcastProjectListInvalidated,
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

const wss = createWebSocketGateway({
    server,
    app,
    chatWebSocketDeps,
    shellWebSocketDeps,
});

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

// CLI Authentication API Routes (protected)
app.use('/api/cli', authenticateToken, cliAuthRoutes);

// User API Routes (protected)
app.use('/api/user', authenticateToken, userRoutes);

// Codex API Routes (protected)
app.use('/api/codex', authenticateToken, codexRoutes);

// Agent API Routes (uses API key authentication)
app.use('/api/agent', agentRoutes);

registerStaticAssets({ app, express, path, PKG_ROOT });

// API Routes (protected)
// /api/config endpoint removed - no longer needed
// Frontend now uses window.location for WebSocket URLs

registerBackendHttpRoutes({
    app, authenticateToken, db, path, fs, fsPromises, WORKSPACES_ROOT, validateWorkspacePath,
    resolveProjectRootWithHint, resolveReadableProjectPath, resolveProjectPath, buildMutationResponse,
    joinProjectChildPath, sanitizeEntryName, sanitizeUploadRelativePath, createDirectoryArchive,
    sendDownload, withLoggedFallback, classifyProjectFile, TEXT_SAMPLE_BYTES, mime,
    heavyReadCoalescer, getProjects, broadcastProgress, summarizeProjectForList,
    ensureGoRunnerWatchersForProjects, watchGoWorkflowRun, resolveProjectOverviewTarget,
    buildProjectOverviewReadModel, attachWorkflowMetadata, attachProjectOverviewWorkflowMetadata: attachIndexedWorkflowMetadata, syncProjectWorkflowOverviewIndex,
    getCodexSessions, getPiSessions, getClaudeSessions,
    extractProjectDirectory, listProjectWorkflows, summarizeWorkflowForProjectList, getProjectWorkflow,
    createProjectWorkflow, listProjectAdoptableOpenSpecChanges, resumeWorkflowRun, abortWorkflowRun,
    findProjectByName, handleGetSessionMessages, searchChatHistory, renameProject, renameSession,
    updateSessionUiState, resolveSessionProviderId, getSessionModelState, updateSessionModelState, broadcastSessionModelStateUpdated,
    normalizeManualProvider, createManualSessionDraft, finalizeManualSessionRoute, getUsageRemaining,
    deleteSession, broadcastProjectListInvalidated, deleteProject, addProjectManually, fetch,
    listUnscopedHermesSessions,
    CHAT_UPLOAD_ROOT, sanitizeFilename, persistChatUploads, os, getCodexSessionTokenUsage,
    installMode, PKG_ROOT, spawn,
    buildRuntimeReadinessReport, checkCodexCredentials, getCodexModelCatalog, getPiModelCatalog, resolveCodexCliPath,
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

        console.log(`${c.info('[INFO]')} Native agent runtime ready (Codex app-server + Pi SDK)`);
        console.log(`${c.info('[INFO]')} Running in ${c.bright(isProduction ? 'PRODUCTION' : 'DEVELOPMENT')} mode`);

        if (!isProduction) {
            console.log(`${c.warn('[WARN]')} Note: Requests will be proxied to Vite dev server at ${c.dim('http://localhost:' + (process.env.VITE_PORT || 5173))}`);
        }

        try {
            await setupProjectsWatcher();
        } catch (watcherError: any) {
            console.error('[ERROR] Failed to setup provider transcript watchers:', watcherError);
        }

        server.listen(PORT, HOST, async () => {
            const appInstallPath = PKG_ROOT;

            printStartupBanner({
                c,
                appInstallPath,
                displayHost: DISPLAY_HOST,
                port: PORT,
            });

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

            console.info('[WorkflowRuntime] oz flow is the workflow state machine.');

            try {
                const backfillResult = await backfillProjectIndex();
                if (backfillResult.manualCount > 0 || backfillResult.providerCount > 0 || backfillResult.hiddenCount > 0) {
                    void broadcastProjectListInvalidated({ reason: 'project-index-backfill' });
                }
                void getProjects(null, { lightweightList: true })
                    .then((projects) => syncWorkflowOverviewIndexesForProjects(projects))
                    .then((workflowIndexResult) => {
                        if (workflowIndexResult.workflowCount > 0) {
                            void broadcastProjectListInvalidated({ reason: 'workflow-index-backfill' });
                        }
                    })
                    .catch((workflowIndexError: any) => {
                        console.error('[WorkflowIndex] Startup sync failed:', workflowIndexError);
                    });
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
