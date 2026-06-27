/**
 * 文件目的：定义聊天 WebSocket 的连接处理边界。
 * 业务意义：聊天协议和 provider runtime 交互应独立于 HTTP route 组装入口。
 */
import type { WebSocket } from 'ws';
import {
    readProviderSessionBinding,
    writeProviderSessionBinding,
} from '../../domains/provider-runtime/provider-session-binding.js';
import { createRuntimeWriterAdapter as defaultCreateRuntimeWriterAdapter } from './runtime-writer-adapter.js';
import type { ChatInboundMessage } from './chat-message-schema.js';
import { appendAttachmentNote } from '../../chat-attachments.js';
import {
    createChatClientScopeStore,
    normalizeChatClientScope,
    type ChatClientScope,
} from './chat-client-scope-store.js';
import { dispatchChatCommand as routeChatCommand } from './chat-command-router.js';

type LooseRecord = Record<string, any>;

const chatClientScopes = createChatClientScopeStore();

/**
 * Build the exact text sent to providers so native runtime paths receive the
 * same uploaded-file instructions as legacy direct provider calls.
 */
function buildProviderPromptText(command: string, attachments: unknown): string {
    const uploadedAttachments = Array.isArray(attachments)
        ? attachments as Record<string, unknown>[]
        : [];
    return appendAttachmentNote(command || '', uploadedAttachments);
}

/**
 * 记录某个浏览器窗口拥有或订阅的会话作用域。
 */
function rememberChatClientScope(ws: WebSocket, scope: LooseRecord, userId: string | null): void {
    /**
     * PURPOSE: Associate private provider events with the browser window that
     * started or explicitly subscribed to the session.
     */
    const normalized = normalizeChatClientScope(scope, userId);
    if (!normalized) {
        return;
    }

    const existingScopes = chatClientScopes.get(ws);
    const nextScopes = existingScopes.filter((existing) => {
        if (normalized.ozwSessionId && existing.ozwSessionId === normalized.ozwSessionId) {
            return false;
        }
        if (normalized.providerSessionId && existing.providerSessionId === normalized.providerSessionId) {
            return false;
        }
        if (normalized.clientRequestId && existing.clientRequestId === normalized.clientRequestId) {
            return false;
        }
        return true;
    });
    nextScopes.push(normalized);
    chatClientScopes.set(ws, nextScopes);
}

/**
 * 判断浏览器窗口是否明确拥有或订阅了私有 realtime 事件。
 */
function chatClientScopeMatches(eventScope: ChatClientScope, targetScope: ChatClientScope): boolean {
    /**
     * PURPOSE: Match by stable session identity first, with request id as a
     * fallback for events emitted before the provider session is finalized.
     */
    if (eventScope.userId !== null && targetScope.userId !== eventScope.userId) {
        return false;
    }
    if (eventScope.projectPath && targetScope.projectPath && targetScope.projectPath !== eventScope.projectPath) {
        return false;
    }
    if (eventScope.provider && targetScope.provider && targetScope.provider !== eventScope.provider) {
        return false;
    }
    if (eventScope.ozwSessionId && targetScope.ozwSessionId === eventScope.ozwSessionId) {
        return true;
    }
    if (eventScope.providerSessionId && targetScope.providerSessionId === eventScope.providerSessionId) {
        return true;
    }
    return Boolean(eventScope.clientRequestId && targetScope.clientRequestId === eventScope.clientRequestId);
}

/**
 * 记录聊天 WebSocket 客户端所属用户。
 */
export function registerChatClient(runtime: any, ws: WebSocket, userId: string | null): void {
    runtime.connectedClients.add(ws);
    runtime.chatClientUsers.set(ws, userId);
    chatClientScopes.set(ws, []);
}

/**
 * 移除聊天 WebSocket 客户端状态。
 */
export function unregisterChatClient(runtime: any, ws: WebSocket): void {
    runtime.connectedClients.delete(ws);
    runtime.chatClientUsers.delete(ws);
    chatClientScopes.clear(ws);
}

/**
 * 创建聊天协议命令分发器。
 */
export function createChatCommandDispatcher(deps: any, ws: WebSocket, request: any) {
    const { connectedClients, chatClientUsers, broadcastChatEvent, finalizeManualSessionRoute, initManualSessionRoute, updateManualSessionTitleFromFirstRequest, acceptChatRequestId, resolveChatProjectOptions, extractProjectDirectory, resolveCbwSessionStartContext, resolveCbwRouteSessionIdFromProviderSession, getSessionModelState, sendNativeMessage, sendMessageAccepted, abortNativeSession, broadcastSessionModelStateUpdated, isCbwRouteSessionId, normalizeManualProvider, getNativeSessionStatus, getActiveNativeSessions, createRuntimeWriterAdapter, sessionSubscriptionRegistry, broadcastProjectListInvalidated } = deps;
    const adaptRuntimeWriter = typeof createRuntimeWriterAdapter === 'function'
        ? createRuntimeWriterAdapter
        : defaultCreateRuntimeWriterAdapter;
    /**
     * WebSocket Writer - Wrapper for WebSocket to match SSEStreamWriter interface
     */
    class WebSocketWriter {
        ws: WebSocket;
        sendFn?: (data: unknown, sessionId: string | null, sessionIndexContext: LooseRecord | null) => void;
        sessionId: string | null;
        sessionIndexContext: LooseRecord | null;
        isWebSocketWriter: boolean;

        constructor(ws: WebSocket, sendFn?: (data: unknown, sessionId: string | null, sessionIndexContext: LooseRecord | null) => void) {
            this.ws = ws;
            this.sendFn = sendFn;
            this.sessionId = null;
            this.sessionIndexContext = null;
            this.isWebSocketWriter = true;  // Marker for transport detection
        }

        send(data: unknown) {
            this.sendWithContext(data, this.sessionId, this.sessionIndexContext);
        }

        sendWithContext(data: unknown, sessionId: string | null, sessionIndexContext: LooseRecord | null) {
            /**
             * PURPOSE: Send one WebSocket payload with the route context owned by the
             * runtime session that emitted it. This prevents concurrent sessions on
             * one browser socket from overwriting each other's cN route identity.
             */
            if (typeof this.sendFn === 'function') {
                this.sendFn(data, sessionId, sessionIndexContext);
                return;
            }

            if (this.ws.readyState === 1) { // WebSocket.OPEN
                // Providers send raw objects, we stringify for WebSocket
                this.ws.send(JSON.stringify(data));
            }
        }

        setSessionId(sessionId: string) {
            this.sessionId = sessionId;
        }

        getSessionId() {
            return this.sessionId;
        }

        setSessionIndexContext(context: LooseRecord | null) {
            /**
             * Attach the ozw route id used to mirror provider events into the index.
             */
            this.sessionIndexContext = context;
        }

        getSessionIndexContext() {
            /**
             * Return the active ozw index context for fire-and-forget event writes.
             */
            return this.sessionIndexContext;
        }

        withSessionIndexContext(context: LooseRecord) {
            /**
             * PURPOSE: Create a writer bound to one manual cN route for the lifetime
             * of a provider runtime session.
             */
            return new ScopedWebSocketWriter(this, context);
        }
    }

    class ScopedWebSocketWriter {
        parentWriter: WebSocketWriter;
        sessionIndexContext: LooseRecord | null;
        sessionId: string | null;
        isWebSocketWriter: boolean;

        constructor(parentWriter: WebSocketWriter, sessionIndexContext: LooseRecord | null) {
            this.parentWriter = parentWriter;
            this.sessionIndexContext = sessionIndexContext;
            this.sessionId = null;
            this.isWebSocketWriter = true;
        }

        send(data: unknown) {
            this.parentWriter.sendWithContext(data, this.sessionId, this.sessionIndexContext);
        }

        setSessionId(sessionId: string) {
            this.sessionId = sessionId;
        }

        getSessionId() {
            return this.sessionId;
        }

        setSessionIndexContext(context: LooseRecord | null) {
            this.sessionIndexContext = context;
        }

        getSessionIndexContext() {
            return this.sessionIndexContext;
        }
    }

    async function finalizeCbwRouteSession({
        projectName,
        projectPath,
        provider,
        ozwSessionId,
        routeInitToken,
        providerSessionId,
    }: LooseRecord) {
        /**
         * Promote a route-only manual session (cN) to the provider session id.
         */
        if (!ozwSessionId || !providerSessionId) {
            return;
        }
        if (providerSessionId === ozwSessionId) {
            return false;
        }

        await writeProviderSessionBinding({
            projectName: projectName || '',
            projectPath: projectPath || '',
            routeSessionId: ozwSessionId,
            provider: provider === 'pi' ? 'pi' : 'codex',
            providerSessionId,
        });

        let finalized = false;
        try {
            finalized = await finalizeManualSessionRoute(
                projectName || '',
                ozwSessionId,
                providerSessionId,
                provider,
                projectPath || '',
            );
        } catch (error: any) {
            console.warn('[ManualSession] Failed to finalize manual session draft:', error.message);
        }

        if (finalized && typeof broadcastProjectListInvalidated === 'function') {
            await broadcastProjectListInvalidated({
                reason: 'manual-session-provider-bound',
                changedProjectPath: projectPath || '',
            });
        }

        return finalized;
    }

    async function updateManualRouteTitleFromCommand({
        projectName,
        projectPath,
        provider,
        ozwSessionId,
        command,
    }: LooseRecord) {
        /**
         * Persist the first real user request as the visible manual cN title
         * when the route still uses its generated 会话N placeholder.
         */
        if (!ozwSessionId || !String(command || '').trim() || typeof updateManualSessionTitleFromFirstRequest !== 'function') {
            return;
        }
        try {
            const result = await updateManualSessionTitleFromFirstRequest(
                projectName || '',
                projectPath || '',
                ozwSessionId,
                provider === 'pi' ? 'pi' : 'codex',
                command,
            );
            if (result?.updated && typeof broadcastProjectListInvalidated === 'function') {
                await broadcastProjectListInvalidated({
                    reason: 'manual-session-first-request-title',
                    changedProjectPath: projectPath || '',
                });
            }
        } catch (error: any) {
            console.warn('[ManualSession] Failed to update first request title:', error.message);
        }
    }

    function resolveLifecycleProviderSessionId(payload: LooseRecord, ozwSessionId: string) {
        /**
         * PURPOSE: Extract the durable provider transcript id from lifecycle
         * events without ever treating the WebUI cN route as a native session id.
         */
        if (!payload || typeof payload !== 'object' || !ozwSessionId) {
            return '';
        }

        const eventType = payload.type;
        const candidate = eventType === 'session-created'
            ? payload.sessionId
            : eventType === 'codex-complete' || eventType === 'pi-complete'
                ? payload.actualSessionId || payload.sessionId
                : '';
        if (
            typeof candidate !== 'string'
            || !candidate.trim()
            || candidate === ozwSessionId
            || isCbwRouteSessionId(candidate)
            || /^codex-\d+$/.test(candidate.trim())
            || /^pi-\d+$/.test(candidate.trim())
        ) {
            return '';
        }
        return candidate.trim();
    }

    // Handle chat WebSocket connections
    function runChatConnection(ws: WebSocket, request: any) {
        console.log('[INFO] Chat WebSocket connected');

        // Add to connected clients for project updates
        registerChatClient({ connectedClients, chatClientUsers }, ws, request?.user?.id || null);

        const sendToChatClients = (payload: unknown, payloadSessionId?: string | null, payloadIndexContext?: LooseRecord | null) => {
            const sourceUserId = chatClientUsers.get(ws) || null;
            const indexContext = payloadIndexContext || writer.getSessionIndexContext();
            const payloadRecord = (payload && typeof payload === 'object') ? payload as LooseRecord : {};
            const indexedPayload = indexContext?.ozwSessionId
                ? {
                    ...payloadRecord,
                    projectName: indexContext.projectName || payloadRecord.projectName,
                    projectPath: indexContext.projectPath || payloadRecord.projectPath,
                    provider: indexContext.provider || payloadRecord.provider,
                    ozwSessionId: indexContext.ozwSessionId,
                    ozw_session_id: indexContext.ozwSessionId,
                }
                : payloadRecord;
            const privateScope = normalizeChatClientScope({
                ...indexedPayload,
                ozwSessionId: indexedPayload.ozwSessionId || indexedPayload.ozw_session_id || indexContext?.ozwSessionId || payloadSessionId,
                providerSessionId: indexedPayload.providerSessionId || indexedPayload.provider_session_id || indexedPayload.sessionId,
                clientRequestId: indexedPayload.clientRequestId || indexedPayload.client_request_id || indexContext?.routeInitToken,
            }, sourceUserId);
            const lifecycleProviderSessionId = resolveLifecycleProviderSessionId(payloadRecord, indexContext?.ozwSessionId || '');
            if (indexContext?.ozwSessionId && lifecycleProviderSessionId) {
                void (async () => {
                    await writeProviderSessionBinding({
                        projectName: indexContext.projectName || '',
                        projectPath: indexContext.projectPath || '',
                        routeSessionId: indexContext.ozwSessionId,
                        provider: indexContext.provider === 'pi' ? 'pi' : 'codex',
                        providerSessionId: lifecycleProviderSessionId,
                    });
                    const runtime = await readProviderSessionBinding(
                        indexContext.projectName || '',
                        indexContext.projectPath || '',
                        indexContext.ozwSessionId,
                    );
                    const runtimeProvider = runtime?.provider || payloadRecord.provider || indexContext.provider || 'codex';
                    await finalizeCbwRouteSession({
                        projectName: indexContext.projectName || '',
                        projectPath: indexContext.projectPath || '',
                        provider: runtimeProvider,
                        ozwSessionId: indexContext.ozwSessionId,
                        routeInitToken: indexContext.routeInitToken || '',
                        providerSessionId: lifecycleProviderSessionId,
                    });
                })().catch((error) => {
                    console.warn('[ManualSession] Failed to store pending provider session:', error.message);
                });
            }
            if (!privateScope) {
                broadcastChatEvent(indexedPayload, sourceUserId);
                return;
            }

            const serializedPayload = JSON.stringify(indexedPayload);
            connectedClients.forEach((client: WebSocket) => {
                if (client.readyState !== 1) {
                    return;
                }
                if (client === ws) {
                    client.send(serializedPayload);
                    return;
                }

                const targetScopes = chatClientScopes.get(client);
                if (
                    sessionSubscriptionRegistry?.clientMatchesSession(client, privateScope)
                    || targetScopes.some((targetScope) => chatClientScopeMatches(privateScope, targetScope))
                ) {
                    client.send(serializedPayload);
                }
            });
        };

        // Wrap WebSocket with writer for consistent interface with SSEStreamWriter
        const writer = new WebSocketWriter(ws, sendToChatClients);

        async function handleChatCommand(data: ChatInboundMessage): Promise<void> {
            /**
             * PURPOSE: Keep command branching and provider runtime calls outside the
             * WebSocket lifecycle handler while preserving the legacy command behavior.
             */
                console.log('📨 Chat message received:', data.type);
                if (data.type === 'claude-command') {
                    writer.send({ type: 'claude-error', error: 'Provider "claude" is no longer supported' });
                } else if (data.type === 'codex-command') {
                    if (!acceptChatRequestId(data.clientRequestId || data.options?.clientRequestId)) {
                        console.warn('[DEBUG] Ignoring duplicate Codex request:', data.clientRequestId || data.options?.clientRequestId);
                        return;
                    }
                    const resolvedOptions = await resolveChatProjectOptions(data.options, extractProjectDirectory) as LooseRecord;
                    let {
                        ozwSessionId,
                        routeInitToken,
                    } = resolveCbwSessionStartContext(data, resolvedOptions);
                    if (!ozwSessionId) {
                        ozwSessionId = await resolveCbwRouteSessionIdFromProviderSession('codex', data, resolvedOptions);
                    }
                    const codexManualRuntime = ozwSessionId
                        ? await readProviderSessionBinding(
                            resolvedOptions?.projectName || data.options?.projectName || '',
                            resolvedOptions?.projectPath || resolvedOptions?.cwd || '',
                            ozwSessionId,
                        )
                        : null;
                    const shouldStartCbwDraft = ozwSessionId && (
                        !codexManualRuntime?.providerSessionId
                        &&
                        (!resolvedOptions?.sessionId || isCbwRouteSessionId(resolvedOptions.sessionId))
                        && (!data.sessionId || isCbwRouteSessionId(data.sessionId))
                    );
                    const codexProviderOptions = shouldStartCbwDraft
                        ? { ...resolvedOptions, sessionId: undefined, resume: false }
                        : resolvedOptions;
                    const codexSessionIndexContext = ozwSessionId ? {
                        projectName: codexProviderOptions?.projectName || data.options?.projectName || '',
                        projectPath: codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                        provider: 'codex',
                        ozwSessionId,
                        routeInitToken,
                    } : null;
                    if (codexSessionIndexContext) {
                        rememberChatClientScope(ws, {
                            ...codexSessionIndexContext,
                            clientRequestId: routeInitToken || data.clientRequestId || data.options?.clientRequestId || '',
                            providerSessionId: codexManualRuntime?.providerSessionId || '',
                        }, chatClientUsers.get(ws) || null);
                    }
                    const codexRuntimeWriter = adaptRuntimeWriter(codexSessionIndexContext
                        ? writer.withSessionIndexContext(codexSessionIndexContext)
                        : writer);
                    if (shouldStartCbwDraft) {
                        const startResult = await initManualSessionRoute(
                            codexProviderOptions?.projectName || data.options?.projectName || '',
                            codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                            ozwSessionId,
                            'codex',
                        );
                        if (!startResult.started && startResult.reason !== 'already-started') {
                            writer.send({
                                type: 'session-start-rejected',
                                sessionId: ozwSessionId,
                                ozwSessionId,
                                provider: 'codex',
                                reason: startResult.reason,
                            });
                            return;
                        }
                        await updateManualRouteTitleFromCommand({
                            projectName: codexProviderOptions?.projectName || data.options?.projectName || '',
                            projectPath: codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                            provider: 'codex',
                            ozwSessionId,
                            command: data.command || '',
                        });
                    }
                    console.log('[DEBUG] Codex request:', data.command || '[Continue/Resume]');
                    console.log('📁 Project:', codexProviderOptions?.projectPath || codexProviderOptions?.cwd || 'Unknown');
                    console.log('🤖 Model:', codexProviderOptions?.model || 'default');
                    if (ozwSessionId) {
                        // User messages are no longer persisted to conf.json pending state.
                        // Live transcript is maintained by the native runtime reducer.
                    }
                    const sessionModelState: LooseRecord = codexProviderOptions?.sessionId
                        ? await getSessionModelState(
                            codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                            codexProviderOptions.sessionId,
                        ).catch(() => ({}))
                        : {};
                    const codexOptions: LooseRecord = {
                        ...codexProviderOptions,
                        reasoningEffort: sessionModelState.reasoningEffort || codexProviderOptions?.reasoningEffort,
                        serviceTier: codexProviderOptions?.serviceTier || data.options?.serviceTier || '',
                    };
                    const codexPromptText = buildProviderPromptText(
                        data.command || '',
                        codexOptions?.attachments ?? data.options?.attachments,
                    );
                    const effectiveSessionId = codexOptions?.sessionId || data.sessionId || ozwSessionId;
                    const result = await sendNativeMessage({
                        provider: 'codex',
                        sessionId: ozwSessionId || effectiveSessionId || `codex-${Date.now()}`,
                        providerSessionId: codexManualRuntime?.providerSessionId || '',
                        projectPath: codexOptions?.projectPath || codexOptions?.cwd || '',
                        text: codexPromptText,
                        runningBehavior: data.options?.runningBehavior || (data.options?.activePolicy === 'queue' ? 'queue' : undefined),
                        model: codexOptions?.model || '',
                        serviceTier: codexOptions?.serviceTier || '',
                        reasoningEffort: codexOptions?.reasoningEffort || '',
                        permissionMode: codexOptions?.permissionMode || '',
                        clientRequestId: routeInitToken || data.clientRequestId || null,
                        turnAnchorKey: data.turnAnchorKey || data.options?.turnAnchorKey || '',
                        writer: codexRuntimeWriter,
                    });
                    if (result?.accepted && ozwSessionId && result.providerSessionId && result.providerSessionId !== ozwSessionId) {
                        await finalizeCbwRouteSession({
                            projectName: codexProviderOptions?.projectName || data.options?.projectName || '',
                            projectPath: codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                            provider: 'codex',
                            ozwSessionId,
                            routeInitToken,
                            providerSessionId: result.providerSessionId,
                        });
                    }
                    // Codex accepted/rejected is handled by the runtime via
                    // message-accepted / steer-rejected / codex-error through the
                    // writer.  Do NOT duplicate accepted sends here.
                } else if (data.type === 'pi-command') {
                    if (!acceptChatRequestId(data.clientRequestId || data.options?.clientRequestId)) {
                        console.warn('[DEBUG] Ignoring duplicate Pi request:', data.clientRequestId || data.options?.clientRequestId);
                        return;
                    }
                    const resolvedOptions = await resolveChatProjectOptions(data.options, extractProjectDirectory) as LooseRecord;
                    let {
                        ozwSessionId,
                        routeInitToken,
                    } = resolveCbwSessionStartContext(data, resolvedOptions);
                    if (!ozwSessionId) {
                        ozwSessionId = await resolveCbwRouteSessionIdFromProviderSession('pi', data, resolvedOptions);
                    }
                    const piManualRuntime = ozwSessionId
                        ? await readProviderSessionBinding(
                            resolvedOptions?.projectName || data.options?.projectName || '',
                            resolvedOptions?.projectPath || resolvedOptions?.cwd || '',
                            ozwSessionId,
                        )
                        : null;
                    if (ozwSessionId) {
                        // User messages are no longer persisted to conf.json pending state.
                    }
                    const shouldStartCbwDraft = ozwSessionId && (
                        !piManualRuntime?.providerSessionId
                        &&
                        (!resolvedOptions?.sessionId || isCbwRouteSessionId(resolvedOptions.sessionId))
                        && (!data.sessionId || isCbwRouteSessionId(data.sessionId))
                    );
                    const piProviderOptions = shouldStartCbwDraft
                        ? { ...resolvedOptions, sessionId: undefined, resume: false }
                        : resolvedOptions;
                    const piSessionIndexContext = ozwSessionId ? {
                        projectName: piProviderOptions?.projectName || data.options?.projectName || '',
                        projectPath: piProviderOptions?.projectPath || piProviderOptions?.cwd || '',
                        provider: 'pi',
                        ozwSessionId,
                        routeInitToken,
                    } : null;
                    if (piSessionIndexContext) {
                        rememberChatClientScope(ws, {
                            ...piSessionIndexContext,
                            clientRequestId: routeInitToken || data.clientRequestId || data.options?.clientRequestId || '',
                            providerSessionId: piManualRuntime?.providerSessionId || '',
                        }, chatClientUsers.get(ws) || null);
                    }
                    const piRuntimeWriter = adaptRuntimeWriter(piSessionIndexContext
                        ? writer.withSessionIndexContext(piSessionIndexContext)
                        : writer);
                    if (shouldStartCbwDraft) {
                        const startResult = await initManualSessionRoute(
                            piProviderOptions?.projectName || data.options?.projectName || '',
                            piProviderOptions?.projectPath || piProviderOptions?.cwd || '',
                            ozwSessionId,
                            'pi',
                        );
                        if (!startResult.started && startResult.reason !== 'already-started') {
                            writer.send({
                                type: 'session-start-rejected',
                                sessionId: ozwSessionId,
                                ozwSessionId,
                                provider: 'pi',
                                reason: startResult.reason,
                            });
                            return;
                        }
                        await updateManualRouteTitleFromCommand({
                            projectName: piProviderOptions?.projectName || data.options?.projectName || '',
                            projectPath: piProviderOptions?.projectPath || piProviderOptions?.cwd || '',
                            provider: 'pi',
                            ozwSessionId,
                            command: data.command || '',
                        });
                    }
                    console.log('[DEBUG] Pi request:', data.command || '[Continue/Resume]');
                    console.log('📁 Project:', piProviderOptions?.projectPath || piProviderOptions?.cwd || 'Unknown');
                    if (ozwSessionId) {
                        // User messages are no longer persisted to conf.json pending state.
                    }
                    const piPromptText = buildProviderPromptText(
                        data.command || '',
                        piProviderOptions?.attachments ?? data.options?.attachments,
                    );
                    const effectiveSessionId = piProviderOptions?.sessionId || data.sessionId || ozwSessionId;
                    const result = await sendNativeMessage({
                        provider: 'pi',
                        sessionId: ozwSessionId || effectiveSessionId || `pi-${Date.now()}`,
                        providerSessionId: piManualRuntime?.providerSessionId || '',
                        projectPath: piProviderOptions?.projectPath || piProviderOptions?.cwd || '',
                        text: piPromptText,
                        runningBehavior: data.options?.runningBehavior || (data.options?.activePolicy === 'steer' ? 'steer' : data.options?.activePolicy === 'followUp' ? 'followUp' : undefined),
                        model: piProviderOptions?.model || data.options?.model || '',
                        thinkingLevel: piProviderOptions?.thinkingLevel || data.options?.thinkingLevel || '',
                        permissionMode: piProviderOptions?.permissionMode || '',
                        clientRequestId: routeInitToken || data.clientRequestId || null,
                        turnAnchorKey: data.turnAnchorKey || data.options?.turnAnchorKey || '',
                        writer: piRuntimeWriter,
                    });
                    if (result?.accepted && ozwSessionId && result.providerSessionId && result.providerSessionId !== ozwSessionId) {
                        await finalizeCbwRouteSession({
                            projectName: piProviderOptions?.projectName || data.options?.projectName || '',
                            projectPath: piProviderOptions?.projectPath || piProviderOptions?.cwd || '',
                            provider: 'pi',
                            ozwSessionId,
                            routeInitToken,
                            providerSessionId: result.providerSessionId,
                        });
                    }
                    // Pi accepted/rejected is handled by the runtime via
                    // preflightResult callback (success→message-accepted,
                    // failure→message-rejected).  Session init failures are
                    // also reported by the runtime via pi-error through the
                    // writer.  Do NOT duplicate error/accepted sends here.
                    } else if (data.type === 'abort-session') {
                    console.log('[DEBUG] Abort session request:', data.sessionId);
                    const provider = normalizeManualProvider(data.provider || 'codex');
                    const ozwSessionId = isCbwRouteSessionId(data.ozwSessionId || data.sessionId)
                        ? (data.ozwSessionId || data.sessionId)
                        : null;
                    if (ozwSessionId) {
                        // Cancel state is no longer persisted to conf.json.
                    }
                    const result = await abortNativeSession(provider, ozwSessionId || data.sessionId, data.projectPath || data.options?.projectPath || data.options?.cwd || '');
                    writer.send({
                        type: 'session-aborted',
                        sessionId: data.sessionId,
                        ozwSessionId,
                        provider,
                        projectPath: data.projectPath || data.options?.projectPath || data.options?.cwd || '',
                        success: result.aborted,
                    });} else if (data.type === 'claude-permission-response') {
                    writer.send({ type: 'claude-error', error: 'Provider "claude" is no longer supported' });
                } else if (data.type === 'subscribe-session') {
                    const provider = normalizeManualProvider(data.provider || 'codex');
                    rememberChatClientScope(ws, {
                        ...data,
                        provider,
                        projectName: data.projectName || data.options?.projectName || '',
                        projectPath: data.projectPath || data.options?.projectPath || data.options?.cwd || '',
                    }, chatClientUsers.get(ws) || null);
                    sessionSubscriptionRegistry?.setClientScope(ws, {
                        userId: chatClientUsers.get(ws) || null,
                        provider,
                        projectName: data.projectName || data.options?.projectName || '',
                        projectPath: data.projectPath || data.options?.projectPath || data.options?.cwd || '',
                        sessionId: data.sessionId || data.ozwSessionId || data.ozw_session_id || '',
                        ozwSessionId: data.ozwSessionId || data.ozw_session_id || data.sessionId || '',
                    });
                    writer.send({
                        type: 'session-subscribed',
                        provider,
                        projectName: data.projectName || data.options?.projectName || '',
                        projectPath: data.projectPath || data.options?.projectPath || data.options?.cwd || '',
                        sessionId: data.sessionId || data.ozwSessionId || data.ozw_session_id || '',
                        ozwSessionId: data.ozwSessionId || data.ozw_session_id || data.sessionId || '',
                        ozw_session_id: data.ozwSessionId || data.ozw_session_id || data.sessionId || '',
                    });
                } else if (data.type === 'check-session-status') {
                    const provider = normalizeManualProvider(data.provider || 'codex');
                    const sessionId = data.ozwSessionId || data.ozw_session_id || data.sessionId;
                    const status = getNativeSessionStatus(provider, sessionId, data.projectPath || data.options?.projectPath || data.options?.cwd || '');
                    writer.send({
                        type: 'session-status',
                        sessionId,
                        ozwSessionId: sessionId,
                        ozw_session_id: sessionId,
                        provider,
                        projectPath: data.projectPath || data.options?.projectPath || data.options?.cwd || '',
                        isProcessing: status.isProcessing,
                        turnId: status.turnId || '',
                        turn_id: status.turnId || '',
                        turnStartedAt: status.turnStartedAt || '',
                        turn_started_at: status.turnStartedAt || '',
                    });} else if (data.type === 'get-active-sessions') {
                    const activeSessions = getActiveNativeSessions();
                    writer.send({
                        type: 'active-sessions',
                        sessions: activeSessions,
                    });} else if (data.type === 'ping') {
                    writer.send({
                        type: 'pong',
                        timestamp: data.timestamp || Date.now()
                    });
                }
        }

        function sendProtocolError(data: ChatInboundMessage | null, error: any): void {
            /**
             * PURPOSE: Map parse/dispatch failures to the provider-specific legacy
             * error envelope without letting the WebSocket handler know each branch body.
             */
            console.error('[ERROR] Chat WebSocket error:', error.message);
            let errorType = 'error';
            if (data?.type === 'claude-command') {
                errorType = 'claude-error';
            } else if (data?.type === 'codex-command') {
                errorType = 'codex-error';
            } else if (data?.type === 'pi-command') {
                errorType = 'pi-error';
            }
            writer.send({
                type: errorType,
                error: error.message
            });
        }

        function close(): void {
            /**
             * PURPOSE: Release per-client realtime state when the browser socket closes.
             */
            console.log('🔌 Chat client disconnected');
            // Remove from connected clients
            unregisterChatClient({ connectedClients, chatClientUsers }, ws);
        }

        return {
            dispatchChatCommand(data: ChatInboundMessage): void {
                routeChatCommand((message) => {
                    void handleChatCommand(message as ChatInboundMessage);
                }, data);
            },
            sendProtocolError,
            close,
        };
    }
    return runChatConnection(ws, request);
}
